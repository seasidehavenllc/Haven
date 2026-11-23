import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { speakInStream } from "./aivoice";
import { StreamInput, CohostModes, StreamModes } from "@haven/shared";
import { prisma } from "../db";
import { requireSeller, requireUser } from "../lib/auth";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors";
import { parse } from "../lib/validate";
import { emit, viewerCount } from "../realtime";
import { videoProvider } from "../video";
import { runText } from "../ai/gateway";
import { randomUUID } from "node:crypto";
import { notify, createNotifications, deliver } from "../notify";

const menuInclude = {
  products: {
    orderBy: { position: "asc" as const },
    include: { product: { include: { variants: { orderBy: { createdAt: "asc" as const } }, media: { orderBy: { position: "asc" as const }, take: 1 } } } },
  },
};

async function ownStream(sellerId: string, id: string) {
  const s = await prisma.livestream.findFirst({ where: { id, sellerId } });
  if (!s) throw notFound("Stream");
  return s;
}

/** Grounding facts for the AI: ONLY real catalog, inventory and policy data. */
export async function streamFacts(streamId: string) {
  const s = await prisma.livestream.findUniqueOrThrow({
    where: { id: streamId },
    include: { ...menuInclude, seller: { include: { storefront: true } } },
  });
  const pinned = s.products.find((p) => p.productId === s.pinnedProductId)?.product;
  const fmt = (p: (typeof s.products)[number]["product"]) => ({
    id: p.id,
    title: p.title,
    brand: p.brand,
    model: p.model,
    condition: p.condition,
    description: p.description.slice(0, 1500),
    variants: p.variants.map((v) => ({ name: v.name, options: v.options, price: `$${(v.priceCents / 100).toFixed(2)}`, inStock: v.quantity })),
  });
  return {
    store: s.seller.storefront?.name ?? s.seller.businessName,
    shippingPolicy: s.seller.storefront?.shippingPolicy ?? "Not provided by seller",
    returnPolicy: s.seller.storefront?.returnPolicy ?? "Not provided by seller",
    promotions: "No promotions are configured. Do not offer any discount.",
    currentProduct: pinned ? fmt(pinned) : null,
    menu: s.products.filter((p) => !p.hidden).map((p) => fmt(p.product)),
  };
}

const COHOST_SYSTEM = `You are a private sales assistant for a human livestream host. Only the host sees your replies.
Answer using ONLY the JSON facts provided (catalog, inventory, policies, chat). If the facts don't contain the answer, say you don't have that information.
Never invent specs, stock, discounts, shipping promises or policies. Never offer or authorize discounts, refunds or price changes.
Be brief: 1–4 short lines the host can glance at while live.`;

const PUBLIC_AI_SYSTEM = `You are an AI shopping assistant answering a viewer's question in a livestream chat. You are clearly labeled as AI; never claim to be human.
Use ONLY the provided facts. If unsure, say the host will follow up. Never promise discounts, refunds, shipping times or stock beyond the facts. One or two sentences.`;

export async function streamRoutes(app: FastifyInstance) {
  app.post("/seller/streams", async (req) => {
    const { seller } = await requireSeller(req);
    const input = parse(StreamInput, req.body);
    if (input.mode === "AI_HOST" && !input.aiAgentId) throw badRequest("AI-hosted streams need an AI salesperson");
    if (input.aiAgentId && !(await prisma.aiAgent.findFirst({ where: { id: input.aiAgentId, sellerId: seller.id } }))) throw badRequest("Unknown AI agent");
    // Default menu = every approved product the seller enabled for live selling.
    const productIds = input.productIds.length
      ? (await prisma.product.findMany({ where: { id: { in: input.productIds }, sellerId: seller.id, status: "ACTIVE" }, select: { id: true } })).map((p) => p.id)
      : (await prisma.product.findMany({ where: { sellerId: seller.id, status: "ACTIVE", liveMenuEnabled: true }, select: { id: true }, orderBy: { createdAt: "desc" } })).map((p) => p.id);
    const stream = await prisma.livestream.create({
      data: {
        sellerId: seller.id,
        title: input.title,
        description: input.description,
        mode: input.mode,
        cohostMode: input.cohostMode,
        aiAgentId: input.aiAgentId,
        scheduledFor: input.scheduledFor ? new Date(input.scheduledFor) : null,
        products: { create: productIds.map((productId, position) => ({ productId, position })) },
      },
      include: menuInclude,
    });
    return stream;
  });

  app.get("/seller/streams", async (req) => {
    const { seller } = await requireSeller(req);
    return prisma.livestream.findMany({ where: { sellerId: seller.id }, orderBy: { createdAt: "desc" }, include: { _count: { select: { products: true, chat: true } } } });
  });

  app.get("/streams", async () => {
    const rows = await prisma.livestream.findMany({
      where: { status: { in: ["LIVE", "PAUSED", "SCHEDULED"] }, seller: { status: "APPROVED" } },
      orderBy: [{ status: "asc" }, { scheduledFor: "asc" }],
      include: { seller: { select: { businessName: true, storefront: { select: { slug: true, logoUrl: true } } } }, products: { take: 1, include: { product: { include: { media: { take: 1 } } } } } },
      take: 50,
    });
    return rows.map((s) => ({ ...s, viewers: viewerCount(s.id) }));
  });

  app.get("/streams/:id", async (req) => {
    const { id } = req.params as { id: string };
    const s = await prisma.livestream.findUnique({
      where: { id },
      include: {
        ...menuInclude,
        seller: { select: { id: true, userId: true, businessName: true, storefront: { select: { slug: true, name: true, logoUrl: true } } } },
        aiAgent: { select: { name: true, personality: true } },
        chat: { where: { hidden: false }, orderBy: { createdAt: "desc" }, take: 50, include: { user: { select: { handle: true, displayName: true } } } },
        auctions: { where: { status: { in: ["LIVE", "SCHEDULED"] } } },
      },
    });
    if (!s) throw notFound("Stream");
    const isOwner = req.user?.sellerId === s.sellerId;
    return {
      ...s,
      products: isOwner ? s.products : s.products.filter((p) => !p.hidden),
      chat: s.chat.reverse(),
      viewers: viewerCount(s.id),
      video: { provider: videoProvider.id, configured: videoProvider.configured() },
      /** Always shown to viewers when an AI is presenting or may speak. */
      aiDisclosure: s.mode === "AI_HOST" ? "This show is hosted by an AI salesperson." : s.mode === "HUMAN_AI_COHOST" && s.aiPublicSpeech ? "An AI assistant may answer questions in this stream." : null,
    };
  });

  for (const action of ["start", "pause", "resume", "end"] as const) {
    app.post(`/seller/streams/:id/${action}`, async (req) => {
      const { seller } = await requireSeller(req);
      const s = await ownStream(seller.id, (req.params as any).id);
      const next = { start: "LIVE", pause: "PAUSED", resume: "LIVE", end: "ENDED" }[action] as "LIVE" | "PAUSED" | "ENDED";
      const allowed: Record<string, string[]> = { start: ["SCHEDULED"], pause: ["LIVE"], resume: ["PAUSED"], end: ["LIVE", "PAUSED", "SCHEDULED"] };
      if (!allowed[action]!.includes(s.status)) throw conflict(`Can't ${action} a stream that is ${s.status.toLowerCase()}`);
      const updated = await prisma.livestream.update({
        where: { id: s.id },
        data: {
          status: next,
          ...(action === "start" ? { startedAt: new Date(), videoProvider: videoProvider.id, videoRoom: s.videoRoom ?? `haven-${s.id}` } : {}),
          ...(action === "end" ? { endedAt: new Date() } : {}),
        },
      });
      emit(`stream:${s.id}`, "stream:status", { streamId: s.id, status: next });
      if (action === "start") {
        const followers = await prisma.follow.findMany({ where: { followee: { seller: { id: seller.id } } }, select: { followerId: true } });
        await notify(followers.map((f) => ({ userId: f.followerId, type: "stream.live", title: `${seller.businessName} is live`, body: s.title, link: `/live/${s.id}`, data: { streamId: s.id } })));
      }
      return { ...updated, video: { configured: videoProvider.configured() } };
    });
  }

  /** Video join token: owner can publish; viewers subscribe only. */
  app.get("/streams/:id/video-token", async (req) => {
    const u = requireUser(req);
    const s = await prisma.livestream.findUnique({ where: { id: (req.params as any).id }, include: { seller: true } });
    if (!s || !["LIVE", "PAUSED"].includes(s.status) || !s.videoRoom) throw conflict("Stream is not live");
    const isHost = s.seller.userId === u.id;
    return videoProvider.joinToken({ room: s.videoRoom, identity: u.id, name: u.id, canPublish: isHost });
  });

  // ── Live product menu ──
  app.post("/seller/streams/:id/products", async (req) => {
    const { seller } = await requireSeller(req);
    const s = await ownStream(seller.id, (req.params as any).id);
    const { productId } = parse(z.object({ productId: z.string() }), req.body);
    const p = await prisma.product.findFirst({ where: { id: productId, sellerId: seller.id, status: "ACTIVE" } });
    if (!p) throw notFound("Product");
    const position = await prisma.streamProduct.count({ where: { streamId: s.id } });
    await prisma.streamProduct.upsert({ where: { streamId_productId: { streamId: s.id, productId } }, update: { hidden: false }, create: { streamId: s.id, productId, position } });
    emit(`stream:${s.id}`, "stream:menu", { streamId: s.id });
    return { ok: true };
  });

  app.patch("/seller/streams/:id/products/:productId", async (req) => {
    const { seller } = await requireSeller(req);
    const s = await ownStream(seller.id, (req.params as any).id);
    const body = parse(z.object({ hidden: z.boolean().optional(), position: z.number().int().min(0).optional() }), req.body);
    const r = await prisma.streamProduct.updateMany({ where: { streamId: s.id, productId: (req.params as any).productId }, data: body });
    if (!r.count) throw notFound("Menu item");
    if (body.hidden && s.pinnedProductId === (req.params as any).productId) await prisma.livestream.update({ where: { id: s.id }, data: { pinnedProductId: null } });
    emit(`stream:${s.id}`, "stream:menu", { streamId: s.id });
    return { ok: true };
  });

  app.delete("/seller/streams/:id/products/:productId", async (req) => {
    const { seller } = await requireSeller(req);
    const s = await ownStream(seller.id, (req.params as any).id);
    await prisma.streamProduct.deleteMany({ where: { streamId: s.id, productId: (req.params as any).productId } });
    if (s.pinnedProductId === (req.params as any).productId) await prisma.livestream.update({ where: { id: s.id }, data: { pinnedProductId: null } });
    emit(`stream:${s.id}`, "stream:menu", { streamId: s.id });
    return { ok: true };
  });

  app.post("/seller/streams/:id/pin", async (req) => {
    const { seller } = await requireSeller(req);
    const s = await ownStream(seller.id, (req.params as any).id);
    const { productId } = parse(z.object({ productId: z.string().nullable() }), req.body);
    if (productId && !(await prisma.streamProduct.findFirst({ where: { streamId: s.id, productId, hidden: false } }))) throw badRequest("Product is not in this stream's menu");
    await prisma.livestream.update({ where: { id: s.id }, data: { pinnedProductId: productId } });
    emit(`stream:${s.id}`, "stream:pinned", { streamId: s.id, productId });
    return { ok: true };
  });

  // ── Chat ──
  app.post("/streams/:id/chat", { config: { rateLimit: { max: 20, timeWindow: "30 seconds" } } }, async (req) => {
    const u = requireUser(req);
    const { body } = parse(z.object({ body: z.string().trim().min(1).max(500) }), req.body);
    const s = await prisma.livestream.findUnique({ where: { id: (req.params as any).id } });
    if (!s || !["LIVE", "PAUSED"].includes(s.status)) throw conflict("Chat is closed");
    const msg = await prisma.streamChatMessage.create({ data: { streamId: s.id, userId: u.id, body }, include: { user: { select: { handle: true, displayName: true } } } });
    emit(`stream:${s.id}`, "stream:chat", msg);
    return msg;
  });

  app.post("/seller/streams/:id/chat/:msgId/hide", async (req) => {
    const { seller } = await requireSeller(req);
    const s = await ownStream(seller.id, (req.params as any).id);
    await prisma.streamChatMessage.updateMany({ where: { id: (req.params as any).msgId, streamId: s.id }, data: { hidden: true } });
    emit(`stream:${s.id}`, "stream:chat", { id: (req.params as any).msgId, hidden: true });
    return { ok: true };
  });

  // ── AI controls (merchant always in control) ──
  app.patch("/seller/streams/:id/ai", async (req) => {
    const { seller } = await requireSeller(req);
    const s = await ownStream(seller.id, (req.params as any).id);
    const body = parse(
      z.object({ aiPaused: z.boolean().optional(), aiPublicSpeech: z.boolean().optional(), cohostMode: z.enum(CohostModes).optional(), mode: z.enum(StreamModes).optional() }),
      req.body,
    );
    if (body.mode === "AI_HOST" && !s.aiAgentId) throw badRequest("Assign an AI salesperson before switching to AI host mode");
    const updated = await prisma.livestream.update({ where: { id: s.id }, data: body });
    await prisma.aiTranscriptEntry.create({ data: { streamId: s.id, speaker: "host", kind: "action", body: `AI settings changed: ${JSON.stringify(body)}` } });
    emit(`stream:${s.id}`, "stream:status", { streamId: s.id, status: updated.status, mode: updated.mode, aiPaused: updated.aiPaused, aiPublicSpeech: updated.aiPublicSpeech, cohostMode: updated.cohostMode });
    return updated;
  });

  /** Host pushes live transcript text (from on-device or server STT). */
  app.post("/seller/streams/:id/transcript", async (req) => {
    const { seller } = await requireSeller(req);
    const s = await ownStream(seller.id, (req.params as any).id);
    const { text } = parse(z.object({ text: z.string().min(1).max(4000) }), req.body);
    return prisma.aiTranscriptEntry.create({ data: { streamId: s.id, speaker: "host", kind: "transcript", body: text } });
  });

  app.get("/seller/streams/:id/ai-log", async (req) => {
    const { seller } = await requireSeller(req);
    const s = await ownStream(seller.id, (req.params as any).id);
    return prisma.aiTranscriptEntry.findMany({ where: { streamId: s.id }, orderBy: { createdAt: "desc" }, take: 200 });
  });

  /** Private co-host question ("AI, what sizes do we have left?"). Answer goes only to the host. */
  app.post("/seller/streams/:id/cohost/ask", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req) => {
    const { user, seller } = await requireSeller(req);
    const s = await ownStream(seller.id, (req.params as any).id);
    if (s.mode === "HUMAN") throw badRequest("Enable AI co-host mode for this stream first");
    if (s.aiPaused) throw conflict("AI is paused for this stream");
    const { question } = parse(z.object({ question: z.string().min(2).max(1000) }), req.body);
    const facts = await streamFacts(s.id);
    const chat = await prisma.streamChatMessage.findMany({ where: { streamId: s.id, hidden: false }, orderBy: { createdAt: "desc" }, take: 40, select: { body: true } });
    const transcript = await prisma.aiTranscriptEntry.findMany({ where: { streamId: s.id, kind: "transcript" }, orderBy: { createdAt: "desc" }, take: 10, select: { body: true } });
    const r = await runText<string>(
      { sellerId: seller.id, userId: user.id, feature: "COHOST_MINUTE", units: 0.25, streamId: s.id, idempotencyKey: `cohost:${randomUUID()}` },
      (a, key, model) =>
        a.chat(key, {
          model,
          system: COHOST_SYSTEM,
          messages: [{ role: "user", content: `FACTS:\n${JSON.stringify(facts)}\n\nRECENT CHAT (newest first):\n${chat.map((c) => c.body).join("\n")}\n\nRECENT HOST SPEECH:\n${transcript.map((t) => t.body).join("\n")}\n\nHOST ASKS: ${question}` }],
          maxTokens: 1500,
        }),
    );
    await prisma.aiTranscriptEntry.createMany({
      data: [
        { streamId: s.id, speaker: "host", kind: "transcript", body: question },
        { streamId: s.id, speaker: "ai", kind: "suggestion", body: r.output, meta: { provider: r.provider, model: r.model, credits: r.creditsCharged } },
      ],
    });
    emit(`seller:${seller.id}`, "cohost:suggestion", { streamId: s.id, text: r.output });
    return { answer: r.output, credits: r.creditsCharged };
  });

  /** AI answers a viewer publicly — only if the host enabled public AI speech and AI isn't paused. */
  app.post("/seller/streams/:id/ai/respond", async (req) => {
    const { user, seller } = await requireSeller(req);
    const s = await ownStream(seller.id, (req.params as any).id);
    if (s.mode === "HUMAN") throw forbidden("AI is not enabled for this stream");
    if (s.aiPaused) throw forbidden("AI is paused");
    if (!s.aiPublicSpeech && s.mode !== "AI_HOST") throw forbidden("Public AI responses are disabled. Enable them in AI controls.");
    const { messageId, speak } = parse(z.object({ messageId: z.string(), speak: z.boolean().default(false) }), req.body);
    const msg = await prisma.streamChatMessage.findFirst({ where: { id: messageId, streamId: s.id } });
    if (!msg) throw notFound("Message");
    const facts = await streamFacts(s.id);
    const r = await runText<string>(
      { sellerId: seller.id, userId: user.id, feature: "COHOST_MINUTE", units: 0.25, streamId: s.id, idempotencyKey: `ai-reply:${messageId}` },
      (a, key, model) => a.chat(key, { model, system: PUBLIC_AI_SYSTEM, messages: [{ role: "user", content: `FACTS:\n${JSON.stringify(facts)}\n\nVIEWER: ${msg.body}` }], maxTokens: 800 }),
    );
    const reply = await prisma.streamChatMessage.create({ data: { streamId: s.id, body: r.output, isAi: true } });
    await prisma.aiTranscriptEntry.create({ data: { streamId: s.id, speaker: "ai", kind: "public_response", body: r.output, meta: { inReplyTo: messageId } } });
    emit(`stream:${s.id}`, "stream:chat", reply);
    if (!speak) return reply;
    // Voice is extra: if it fails (no provider, no voice, out of credits) the text answer still stands.
    try {
      return await speakInStream({ streamId: s.id, sellerId: seller.id, userId: user.id, text: r.output, messageId: reply.id, idempotencyKey: `ai-reply-voice:${messageId}` });
    } catch (e: any) {
      return { ...reply, voiceError: e?.message ?? "Voice failed" };
    }
  });

  // ── AI salespeople (configuration; autonomous hosting runtime is Phase 6) ──
  const AgentInput = z.object({
    name: z.string().min(2).max(60),
    personality: z.string().max(200).default("friendly"),
    salesStyle: z.string().max(200).default("consultative"),
    language: z.string().max(10).default("en"),
    voiceProvider: z.string().optional(),
    voiceId: z.string().optional(),
    avatarProvider: z.string().optional(),
    avatarId: z.string().optional(),
    talkingPoints: z.array(z.string().max(300)).max(30).default([]),
    faqs: z.array(z.object({ q: z.string().max(300), a: z.string().max(1000) })).max(50).default([]),
    permissions: z.array(z.enum(["answer_questions", "present_products", "recommend_related", "announce_approved_promotions"])).default(["answer_questions", "present_products"]),
  });
  app.get("/seller/ai-agents", async (req) => {
    const { seller } = await requireSeller(req);
    return prisma.aiAgent.findMany({ where: { sellerId: seller.id }, orderBy: { createdAt: "desc" } });
  });
  app.post("/seller/ai-agents", async (req) => {
    const { seller } = await requireSeller(req);
    const input = parse(AgentInput, req.body);
    const sub = await prisma.sellerSubscription.findUnique({ where: { sellerId: seller.id }, include: { plan: true } });
    if (!sub?.plan.features.includes("AI_HOST_MINUTE")) throw forbidden("AI salespeople require the Business plan or higher");
    const max = (sub.plan.limits as any)?.maxAiAgents ?? 1;
    if ((await prisma.aiAgent.count({ where: { sellerId: seller.id } })) >= max) throw forbidden(`Your plan allows ${max} AI salesperson(s)`);
    return prisma.aiAgent.create({ data: { ...input, sellerId: seller.id } });
  });
}
