import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db";
import { runAi } from "../ai/gateway";
import { avatarAdapters, sttAdapters, ttsAdapters, ttsUnits } from "../ai/voice";
import { requireSeller } from "../lib/auth";
import { badRequest, forbidden, notConfigured, notFound } from "../lib/errors";
import { parse } from "../lib/validate";
import { emit } from "../realtime";
import { storeUpload } from "../storage";

/**
 * AI host voice, transcription and avatar sessions. Everything goes through the metered gateway, so it
 * respects the platform kill switch, the seller's plan, spending caps and credits, and every call is
 * recorded with its provider cost. AI speech is always labelled as AI to viewers.
 */

const MAX_SPOKEN_CHARS = 1200;

async function ownStream(sellerId: string, id: string) {
  const s = await prisma.livestream.findFirst({ where: { id, sellerId }, include: { aiAgent: true } });
  if (!s) throw notFound("Stream");
  return s;
}

/** Whether AI may speak publicly in this stream right now. */
function assertPublicAi(s: { mode: string; aiPaused: boolean; aiPublicSpeech: boolean }) {
  if (s.mode === "HUMAN") throw forbidden("AI is not enabled for this stream");
  if (s.aiPaused) throw forbidden("AI is paused");
  if (!s.aiPublicSpeech && s.mode !== "AI_HOST") throw forbidden("Public AI speech is off. Turn it on in AI controls.");
}

/** The first enabled text-to-speech provider that has its key set, for listing voices. */
async function activeTtsProvider() {
  const providers = await prisma.aiProvider.findMany({ where: { enabled: true, adapter: { in: Object.keys(ttsAdapters) } } });
  for (const p of providers) {
    const key = process.env[p.credentialEnvVar];
    if (key) return { provider: p, adapter: ttsAdapters[p.adapter]!, key };
  }
  return null;
}

/**
 * Speak `text` in the stream with the agent's voice: bill TTS by characters, store the clip, post it to
 * chat as an AI message with audio, and broadcast it. Returns the chat message.
 */
export async function speakInStream(opts: { streamId: string; sellerId: string; userId: string; text: string; voiceId?: string | null; messageId?: string; idempotencyKey: string }) {
  const s = await prisma.livestream.findUniqueOrThrow({ where: { id: opts.streamId }, include: { aiAgent: true } });
  const voiceId = opts.voiceId ?? s.aiAgent?.voiceId;
  if (!voiceId) throw badRequest("Pick a voice for your AI salesperson first", { missing: "voiceId" });
  const text = opts.text.slice(0, MAX_SPOKEN_CHARS);
  const r = await runAi(
    { sellerId: opts.sellerId, userId: opts.userId, feature: "TTS_CHARACTERS", units: ttsUnits(text), streamId: s.id, idempotencyKey: opts.idempotencyKey },
    ttsAdapters,
    (a, key, model) => a.synthesize(key, { model, voiceId, text }),
  );
  const stored = await storeUpload(r.output.audio, `ai-audio/${s.id}`, { audio: true });
  if (stored.mime !== "audio/mpeg") throw badRequest("Voice provider returned unexpected audio");
  const msg = opts.messageId
    ? await prisma.streamChatMessage.update({ where: { id: opts.messageId }, data: { audioUrl: stored.url } })
    : await prisma.streamChatMessage.create({ data: { streamId: s.id, body: text, isAi: true, audioUrl: stored.url } });
  await prisma.aiTranscriptEntry.create({ data: { streamId: s.id, speaker: "ai", kind: "speech", body: text, meta: { audioUrl: stored.url, usageId: r.usageId, provider: r.provider } } });
  emit(`stream:${s.id}`, opts.messageId ? "stream:chat:update" : "stream:chat", msg);
  emit(`stream:${s.id}`, "stream:ai_audio", { streamId: s.id, messageId: msg.id, url: stored.url, text });
  return msg;
}

export async function aiVoiceRoutes(app: FastifyInstance) {
  /** Voices the seller can give an AI salesperson, from the active voice provider. */
  app.get("/seller/ai/voices", async (req) => {
    await requireSeller(req);
    const p = await activeTtsProvider();
    if (!p) return { configured: false, voices: [], requiredEnv: ["ELEVENLABS_API_KEY (and enable ElevenLabs in Admin → AI providers)"] };
    return { configured: true, provider: p.provider.key, voices: await p.adapter.voices(p.key) };
  });

  const AgentPatch = z.object({
    name: z.string().min(2).max(60).optional(),
    personality: z.string().max(200).optional(),
    salesStyle: z.string().max(200).optional(),
    voiceProvider: z.string().max(40).nullable().optional(),
    voiceId: z.string().max(120).nullable().optional(),
    avatarProvider: z.string().max(40).nullable().optional(),
    avatarId: z.string().max(120).nullable().optional(),
    talkingPoints: z.array(z.string().max(300)).max(30).optional(),
  });
  app.patch("/seller/ai-agents/:id", async (req) => {
    const { seller } = await requireSeller(req);
    const a = await prisma.aiAgent.findFirst({ where: { id: (req.params as any).id, sellerId: seller.id } });
    if (!a) throw notFound("AI salesperson");
    const body = parse(AgentPatch, req.body);
    if (body.voiceProvider && !ttsAdapters[body.voiceProvider]) throw badRequest("Unknown voice provider");
    if (body.avatarProvider && !avatarAdapters[body.avatarProvider]) throw badRequest("Unknown avatar provider");
    return prisma.aiAgent.update({ where: { id: a.id }, data: body });
  });

  /** Preview a voice privately (billed like any speech, not posted to a stream). */
  app.post("/seller/ai/voices/preview", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req) => {
    const { seller, user } = await requireSeller(req);
    const { voiceId, text } = parse(z.object({ voiceId: z.string().min(1).max(120), text: z.string().trim().min(1).max(300) }), req.body);
    const r = await runAi({ sellerId: seller.id, userId: user.id, feature: "TTS_CHARACTERS", units: ttsUnits(text), idempotencyKey: `voice-preview:${randomUUID()}` }, ttsAdapters, (a, key, model) => a.synthesize(key, { model, voiceId, text }));
    const stored = await storeUpload(r.output.audio, `ai-audio/previews/${seller.id}`, { audio: true });
    return { url: stored.url, creditsCharged: r.creditsCharged };
  });

  /** Say something out loud in the show, in the AI salesperson's voice. */
  app.post("/seller/streams/:id/ai/speak", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req) => {
    const { seller, user } = await requireSeller(req);
    const s = await ownStream(seller.id, (req.params as any).id);
    assertPublicAi(s);
    if (s.status !== "LIVE") throw forbidden("The show isn't live");
    const body = parse(z.object({ text: z.string().trim().min(1).max(MAX_SPOKEN_CHARS), messageId: z.string().optional() }), req.body);
    if (body.messageId) {
      const m = await prisma.streamChatMessage.findFirst({ where: { id: body.messageId, streamId: s.id, isAi: true, audioUrl: null } });
      if (!m) throw notFound("AI message");
      body.text = m.body;
    }
    return speakInStream({ streamId: s.id, sellerId: seller.id, userId: user.id, text: body.text, messageId: body.messageId, idempotencyKey: `speak:${body.messageId ?? randomUUID()}` });
  });

  /**
   * Transcribe a short clip of the host's mic so the co-host can follow along. Multipart: `audio` file
   * and `durationSec` (billing reserves that many minutes up front; clips are capped at 5 minutes).
   */
  app.post("/seller/streams/:id/ai/transcribe", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req) => {
    const { seller, user } = await requireSeller(req);
    const s = await ownStream(seller.id, (req.params as any).id);
    if (s.mode === "HUMAN") throw forbidden("AI is not enabled for this stream");
    let audio: { buf: Buffer; mime: string } | null = null;
    let duration = 0;
    for await (const part of req.parts({ limits: { fileSize: 25 * 1024 * 1024, files: 1 } })) {
      if (part.type === "file") audio = { buf: await part.toBuffer(), mime: part.mimetype };
      else if (part.fieldname === "durationSec") duration = Number(part.value);
    }
    if (!audio?.buf.length) throw badRequest("Add an audio clip");
    if (!/^audio\/(webm|ogg|mpeg|mp4|wav|x-wav|aac|m4a|x-m4a)$/.test(audio.mime)) throw badRequest("Unsupported audio type");
    if (!(duration > 0 && duration <= 300)) throw badRequest("durationSec must be between 0 and 300");
    const r = await runAi(
      { sellerId: seller.id, userId: user.id, feature: "TRANSCRIPTION_MINUTE", units: duration / 60, streamId: s.id, idempotencyKey: `stt:${randomUUID()}` },
      sttAdapters,
      (a, key, model) => a.transcribe(key, { model, audio: audio!.buf, mime: audio!.mime, language: s.aiAgent?.language }),
    );
    if (r.output.text) await prisma.aiTranscriptEntry.create({ data: { streamId: s.id, speaker: "host", kind: "transcript", body: r.output.text, meta: { durationSec: r.output.durationSec, usageId: r.usageId } } });
    return { text: r.output.text, durationSec: r.output.durationSec };
  });

  /**
   * Start a real-time avatar session for the AI salesperson. Bills the first minute; the studio calls the
   * heartbeat once a minute to keep it going, and stops the avatar when a heartbeat is refused.
   */
  app.post("/seller/streams/:id/ai/avatar-session", async (req) => {
    const { seller, user } = await requireSeller(req);
    const s = await ownStream(seller.id, (req.params as any).id);
    if (s.mode !== "AI_HOST") throw forbidden("Avatars are for AI-hosted shows");
    if (!s.aiAgent?.avatarId) throw badRequest("Pick an avatar for your AI salesperson first", { missing: "avatarId" });
    const sessionId = randomUUID();
    const r = await runAi(
      { sellerId: seller.id, userId: user.id, feature: "AVATAR_MINUTE", units: 1, streamId: s.id, idempotencyKey: `avatar:${sessionId}:0` },
      avatarAdapters,
      (a, key, model) => a.createSession(key, { model, avatarId: s.aiAgent!.avatarId!, voiceId: s.aiAgent!.voiceId }),
    );
    await prisma.aiTranscriptEntry.create({ data: { streamId: s.id, speaker: "ai", kind: "action", body: "Avatar session started", meta: { sessionId, provider: r.provider } } });
    return { sessionId, provider: r.provider, sessionToken: r.output.sessionToken, expiresInSec: r.output.expiresInSec, heartbeatEverySec: 60 };
  });

  app.post("/seller/streams/:id/ai/avatar-session/:sessionId/heartbeat", async (req) => {
    const { seller, user } = await requireSeller(req);
    const { id, sessionId } = req.params as { id: string; sessionId: string };
    const s = await ownStream(seller.id, id);
    if (s.mode !== "AI_HOST" || s.status !== "LIVE" || s.aiPaused) return { continue: false };
    const started = await prisma.aiTranscriptEntry.findFirst({ where: { streamId: s.id, kind: "action", body: "Avatar session started", meta: { path: ["sessionId"], equals: sessionId } } });
    if (!started) throw notFound("Avatar session");
    // Minute index from the server's clock, so a fast client can't skip or double-bill minutes.
    const minute = Math.floor((Date.now() - started.createdAt.getTime()) / 60_000);
    if (minute < 1) return { continue: true, minute };
    // Sessions are capped at the provider token's hour, so this bills at most 59 extra minutes. Every minute
    // up to now is billed exactly once (the gateway's idempotency key refuses a repeat with 409), so a
    // client that skips heartbeats still pays for the minutes it used.
    if (minute >= 60) return { continue: false, minute };
    for (let m = 1; m <= minute; m++) {
      try {
        await runAi(
          { sellerId: seller.id, userId: user.id, feature: "AVATAR_MINUTE", units: 1, streamId: s.id, idempotencyKey: `avatar:${sessionId}:${m}` },
          avatarAdapters,
          async () => ({ output: null, inputTokens: 0, outputTokens: 0 }),
        );
      } catch (e: any) {
        if (e?.status === 409 && e?.code === "duplicate_operation") continue;
        if (e?.status === 402) return { continue: false, minute, reason: "out_of_credits" };
        throw e;
      }
    }
    return { continue: true, minute };
  });
}
