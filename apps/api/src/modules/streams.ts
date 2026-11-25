import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { blockedIds, isBlockedBetween } from "./safety";
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
import { storeUpload } from "../storage";
import { analyzeScan } from "./scanner";
import { formatMoney } from "@haven/shared";

/**
 * Pull a price out of what the host said or typed: "$45", "45 dollars", "45.50 bucks", "price 45".
 * Returns cents, or null when no price was said.
 */
export function priceFromSpeech(text: string): number | null {
  const m =
    text.match(/\$\s?(\d{1,6}(?:[.,]\d{1,2})?)/) ??
    text.match(/(\d{1,6}(?:[.,]\d{1,2})?)\s*(?:dollars?|bucks?|usd)\b/i) ??
    text.match(/\b(?:price|for|only|just)\s*(?:is\s*)?(\d{1,6}(?:[.,]\d{1,2})?)\b/i);
  if (!m) return null;
  const cents = Math.round(Number(m[1]!.replace(",", ".")) * 100);
  return cents > 0 ? cents : null;
}

/** What's left of the host's words once the price is taken out, as a fallback title. */
const titleFromSpeech = (text: string) =>
  text
    .replace(/\$\s?\d[\d.,]*/g, "")
    .replace(/\b\d[\d.,]*\s*(?:dollars?|bucks?|usd)\b/gi, "")
    .replace(/\b(?:price|for|only|just)\s*(?:is\s*)?\d[\d.,]*\b/gi, "")
    .replace(/\s+/g, " ")
    .replace(/[\s,.\-–]+$/, "")
    .trim()
    .slice(0, 160);

/** Most hearts one request may carry. The app sends a batch about once a second while someone keeps tapping. */
export const MAX_LIKE_BATCH = 50;

const menuInclude = {
  products: {
    orderBy: { position: "asc" as const },
    include: { product: { include: { variants: { orderBy: { createdAt: "asc" as const } }, media: { orderBy: { position: "asc" as const }, take: 1 } } } },
  },
};

/** A chat line as the app shows it: who wrote it, their photo, and the message it answers (if any). */
const chatInclude = {
  user: { select: { handle: true, displayName: true, avatarUrl: true } },
  replyTo: { select: { id: true, body: true, hidden: true, isAi: true, userId: true, user: { select: { handle: true, displayName: true } } } },
};

/** Drops the quoted message when it was hidden by the host or written by someone the viewer blocked. */
const cleanReply = <M extends { replyTo?: { hidden: boolean; userId: string | null } | null }>(m: M, hidden: string[] = []) =>
  m.replyTo && (m.replyTo.hidden || (m.replyTo.userId && hidden.includes(m.replyTo.userId))) ? { ...m, replyTo: null } : m;

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
      include: {
        seller: { select: { businessName: true, userId: true, storefront: { select: { slug: true, name: true, logoUrl: true } }, user: { select: { handle: true, displayName: true, avatarUrl: true } } } },
        products: { where: { hidden: false }, orderBy: { position: "asc" }, take: 1, include: { product: { include: { media: { orderBy: { position: "asc" }, take: 1 } } } } },
        _count: { select: { products: { where: { hidden: false } } } },
      },
      take: 50,
    });
    return rows.map((s) => ({ ...s, viewers: viewerCount(s.id) }));
  });

  app.get("/streams/:id", async (req) => {
    const { id } = req.params as { id: string };
    const hidden = await blockedIds(req.user?.id);
    const s = await prisma.livestream.findUnique({
      where: { id },
      include: {
        ...menuInclude,
        seller: { select: { id: true, userId: true, businessName: true, storefront: { select: { slug: true, name: true, logoUrl: true } }, user: { select: { handle: true, displayName: true, avatarUrl: true } } } },
        aiAgent: { select: { name: true, personality: true, voiceId: true } },
        chat: { where: { hidden: false, OR: [{ userId: null }, { userId: { notIn: hidden } }] }, orderBy: { createdAt: "desc" }, take: 50, include: chatInclude },
        auctions: { where: { status: { in: ["LIVE", "SCHEDULED"] } } },
      },
    });
    if (!s) throw notFound("Stream");
    const isOwner = req.user?.sellerId === s.sellerId;
    const followingHost = req.user ? !!(await prisma.follow.findUnique({ where: { followerId_followeeId: { followerId: req.user.id, followeeId: s.seller.userId } } })) : false;
    const pinnedMessage = s.pinnedMessageId
      ? await prisma.streamChatMessage.findFirst({ where: { id: s.pinnedMessageId, hidden: false }, include: { user: { select: { handle: true, displayName: true } } } })
      : null;
    const mutes = isOwner
      ? await prisma.streamMute.findMany({ where: { streamId: s.id }, select: { userId: true } })
      : req.user
        ? await prisma.streamMute.findMany({ where: { streamId: s.id, userId: req.user.id }, select: { userId: true } })
        : [];
    return {
      ...s,
      products: isOwner ? s.products : s.products.filter((p) => !p.hidden),
      chat: s.chat.reverse().map((m) => cleanReply(m, hidden)),
      pinnedMessage,
      followingHost,
      /** The host sees everyone they muted in this show; a viewer only learns whether they are muted. */
      ...(isOwner ? { mutedUserIds: mutes.map((m) => m.userId) } : { youAreMuted: mutes.length > 0 }),
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

  /**
   * Sell something new without leaving the show. The host snaps the item and says (or types) what it is and the price,
   * e.g. "Vintage denim jacket, size M, $45". The listing goes into their shop, onto the show's item list, gets pinned
   * as "showing now", and a line in chat tells viewers. With `ai` on and a photo, AI writes the title and description
   * from the photo and the host's words; the price is always the one the host said.
   * Multipart: photos (0–4 images), said (text), priceCents (overrides the spoken price), quantity, ai ("true"/"false").
   */
  app.post("/seller/streams/:id/quick-list", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req) => {
    const { user, seller } = await requireSeller(req);
    const s = await ownStream(seller.id, (req.params as any).id);
    if (!["LIVE", "PAUSED", "SCHEDULED"].includes(s.status)) throw conflict("This show has ended");
    const photos: { mime: string; bytes: Buffer; url: string; sha: string }[] = [];
    const fields: Record<string, string> = {};
    for await (const part of req.parts({ limits: { files: 4, fileSize: 15 * 1024 * 1024 } })) {
      if (part.type === "file") {
        const stored = await storeUpload(await part.toBuffer(), `scans/${seller.id}`);
        if (!stored.mime.startsWith("image/")) throw badRequest("Photos only");
        photos.push({ mime: stored.mime, bytes: stored.bytes, url: stored.url, sha: stored.sha256 });
      } else if (typeof part.value === "string") fields[part.fieldname] = part.value;
    }
    const input = parse(
      z.object({
        said: z.string().trim().max(500).default(""),
        priceCents: z.coerce.number().int().positive().max(100_000_00).optional(),
        quantity: z.coerce.number().int().min(1).max(999).default(1),
        ai: z.enum(["true", "false"]).default("true"),
      }),
      fields,
    );
    const priceCents = input.priceCents ?? priceFromSpeech(input.said);
    if (!priceCents) throw badRequest('Say or type a price, like "$25"');

    let listing = { title: titleFromSpeech(input.said), description: input.said, brand: null as string | null, model: null as string | null, categoryId: null as string | null, condition: null as string | null, tags: [] as string[] };
    let aiNote: string | null = null;
    let scanId: string | null = null;
    if (input.ai === "true" && photos.length) {
      const scan = await prisma.productScan.create({ data: { sellerId: seller.id, imageUrls: photos.map((p) => p.url), imageHash: photos[0]!.sha } });
      scanId = scan.id;
      try {
        const done = await analyzeScan(scan.id, photos, user.id, input.said || undefined);
        const d = done.draft as any;
        if (done.status === "READY" && d) {
          listing = { title: d.title || listing.title, description: d.description || listing.description, brand: d.brand, model: d.model, categoryId: d.categoryId, condition: d.condition, tags: d.tags ?? [] };
        } else aiNote = "AI couldn't read the photo, so the listing uses your words. You can edit it after the show.";
      } catch (e: any) {
        aiNote = e?.status === 402 ? "Out of AI credits, so the listing uses your words." : "AI wasn't available, so the listing uses your words.";
      }
    }
    if (listing.title.length < 3) listing.title = `Live item ${new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;

    const product = await prisma.$transaction(async (tx) => {
      const p = await tx.product.create({
        data: {
          sellerId: seller.id,
          title: listing.title.slice(0, 160),
          description: listing.description.slice(0, 10000),
          categoryId: listing.categoryId,
          brand: listing.brand,
          model: listing.model,
          condition: (listing.condition as any) ?? "GOOD",
          tags: listing.tags.slice(0, 30),
          liveMenuEnabled: true,
          sourceScanId: scanId,
          variants: { create: [{ name: "Default", priceCents, quantity: input.quantity }] },
          media: { create: photos.map((ph, i) => ({ url: ph.url, position: i })) },
        },
        include: { variants: true, media: true },
      });
      await tx.inventoryEvent.create({ data: { variantId: p.variants[0]!.id, delta: input.quantity, reason: "RESTOCK", refId: scanId ?? s.id } });
      if (scanId) await tx.productScan.update({ where: { id: scanId }, data: { status: "PUBLISHED" } });
      const position = await tx.streamProduct.count({ where: { streamId: s.id } });
      await tx.streamProduct.create({ data: { streamId: s.id, productId: p.id, position } });
      await tx.livestream.update({ where: { id: s.id }, data: { pinnedProductId: p.id } });
      return p;
    });
    const line = await prisma.streamChatMessage.create({
      data: { streamId: s.id, userId: seller.userId, body: `New item: ${product.title} for ${formatMoney(priceCents)}${input.quantity > 1 ? ` (${input.quantity} available)` : ""}. Tap Buy.` },
      include: { user: { select: { handle: true, displayName: true } } },
    });
    emit(`stream:${s.id}`, "stream:menu", { streamId: s.id, added: product.id });
    emit(`stream:${s.id}`, "stream:pinned", { streamId: s.id, productId: product.id });
    emit(`stream:${s.id}`, "stream:chat", line);
    return { product, aiNote };
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

  // ── Hearts ──
  /** Viewers tap the heart; the app sends taps in small batches. Anyone may tap, signed in or not. */
  app.post("/streams/:id/likes", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req) => {
    const { count } = parse(z.object({ count: z.number().int().min(1).max(MAX_LIKE_BATCH) }), req.body ?? {});
    const s = await prisma.livestream.findUnique({ where: { id: (req.params as any).id }, select: { id: true, status: true } });
    if (!s) throw notFound("Stream");
    if (s.status !== "LIVE") throw conflict("Hearts open when the show is live");
    const updated = await prisma.livestream.update({ where: { id: s.id }, data: { likeCount: { increment: count } }, select: { likeCount: true } });
    emit(`stream:${s.id}`, "stream:likes", { streamId: s.id, total: updated.likeCount, added: count, userId: req.user?.id ?? null });
    return { total: updated.likeCount };
  });

  // ── Chat ──
  app.post("/streams/:id/chat", { config: { rateLimit: { max: 20, timeWindow: "30 seconds" } } }, async (req) => {
    const u = requireUser(req);
    const { body, replyToId } = parse(z.object({ body: z.string().trim().min(1).max(500), replyToId: z.string().min(1).max(64).optional() }), req.body);
    const s = await prisma.livestream.findUnique({ where: { id: (req.params as any).id } });
    if (!s || !["LIVE", "PAUSED"].includes(s.status)) throw conflict("Chat is closed");
    const host = await prisma.sellerAccount.findUniqueOrThrow({ where: { id: s.sellerId }, select: { userId: true } });
    if (await isBlockedBetween(u.id, host.userId)) throw forbidden("You can't chat in this stream");
    if (await prisma.streamMute.findUnique({ where: { streamId_userId: { streamId: s.id, userId: u.id } } })) throw forbidden("The host muted you in this show. You can still watch and buy.");
    if (replyToId && !(await prisma.streamChatMessage.findFirst({ where: { id: replyToId, streamId: s.id, hidden: false }, select: { id: true } })))
      throw badRequest("That message isn't in this show anymore");
    const msg = cleanReply(await prisma.streamChatMessage.create({ data: { streamId: s.id, userId: u.id, body, replyToId: replyToId ?? null }, include: chatInclude }));
    emit(`stream:${s.id}`, "stream:chat", msg);
    return msg;
  });

  app.post("/seller/streams/:id/chat/:msgId/hide", async (req) => {
    const { seller } = await requireSeller(req);
    const s = await ownStream(seller.id, (req.params as any).id);
    const msgId = (req.params as any).msgId as string;
    await prisma.streamChatMessage.updateMany({ where: { id: msgId, streamId: s.id }, data: { hidden: true } });
    emit(`stream:${s.id}`, "stream:chat", { id: msgId, hidden: true });
    if (s.pinnedMessageId === msgId) {
      await prisma.livestream.update({ where: { id: s.id }, data: { pinnedMessageId: null } });
      emit(`stream:${s.id}`, "stream:pinnedMessage", { streamId: s.id, message: null });
    }
    return { ok: true };
  });

  /** Pin one chat message to the top of the show for everyone, or clear it with null. */
  app.post("/seller/streams/:id/pin-message", async (req) => {
    const { seller } = await requireSeller(req);
    const s = await ownStream(seller.id, (req.params as any).id);
    const { messageId } = parse(z.object({ messageId: z.string().nullable() }), req.body);
    const message = messageId
      ? await prisma.streamChatMessage.findFirst({ where: { id: messageId, streamId: s.id, hidden: false }, include: { user: { select: { handle: true, displayName: true } } } })
      : null;
    if (messageId && !message) throw notFound("Message");
    await prisma.livestream.update({ where: { id: s.id }, data: { pinnedMessageId: message?.id ?? null } });
    emit(`stream:${s.id}`, "stream:pinnedMessage", { streamId: s.id, message });
    return { ok: true, message };
  });

  /** Mute a viewer in this show only. They keep watching and buying; their chat is closed and their messages are hidden. */
  app.post("/seller/streams/:id/mutes", async (req) => {
    const { seller } = await requireSeller(req);
    const s = await ownStream(seller.id, (req.params as any).id);
    const { userId, hideMessages } = parse(z.object({ userId: z.string(), hideMessages: z.boolean().default(true) }), req.body);
    if (userId === seller.userId) throw badRequest("You can't mute yourself");
    if (!(await prisma.user.findUnique({ where: { id: userId }, select: { id: true } }))) throw notFound("User");
    await prisma.streamMute.upsert({ where: { streamId_userId: { streamId: s.id, userId } }, update: {}, create: { streamId: s.id, userId } });
    if (hideMessages) {
      const msgs = await prisma.streamChatMessage.findMany({ where: { streamId: s.id, userId, hidden: false }, select: { id: true } });
      await prisma.streamChatMessage.updateMany({ where: { id: { in: msgs.map((m) => m.id) } }, data: { hidden: true } });
      for (const m of msgs) emit(`stream:${s.id}`, "stream:chat", { id: m.id, hidden: true });
      if (s.pinnedMessageId && msgs.some((m) => m.id === s.pinnedMessageId)) {
        await prisma.livestream.update({ where: { id: s.id }, data: { pinnedMessageId: null } });
        emit(`stream:${s.id}`, "stream:pinnedMessage", { streamId: s.id, message: null });
      }
    }
    emit(`user:${userId}`, "stream:muted", { streamId: s.id, muted: true });
    return { ok: true };
  });

  app.delete("/seller/streams/:id/mutes/:userId", async (req) => {
    const { seller } = await requireSeller(req);
    const s = await ownStream(seller.id, (req.params as any).id);
    const userId = (req.params as any).userId as string;
    await prisma.streamMute.deleteMany({ where: { streamId: s.id, userId } });
    emit(`user:${userId}`, "stream:muted", { streamId: s.id, muted: false });
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
