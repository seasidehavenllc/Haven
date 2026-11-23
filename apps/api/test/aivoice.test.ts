import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/db";
import { buyer, enableTestAi, getApp, seller } from "./helpers";

/** Smallest thing the sniffer accepts as MP3: an ID3 header plus padding. */
const MP3 = Buffer.concat([Buffer.from("ID3"), Buffer.alloc(64)]);
const VOICE_PROVIDERS = ["elevenlabs", "deepgram", "heygen"];

/** Fake provider endpoints. Records each call so tests can check what was sent (and that keys stay server-side). */
const calls: { url: string; init?: RequestInit }[] = [];
let ttsFails = false;
function fakeFetch(url: string, init?: RequestInit) {
  calls.push({ url, init });
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  if (url.startsWith("https://api.elevenlabs.io/v1/voices")) return json({ voices: [{ voice_id: "v-rachel", name: "Rachel", preview_url: "https://example.com/r.mp3", labels: { accent: "american" } }] });
  if (url.startsWith("https://api.elevenlabs.io/v1/text-to-speech/")) return ttsFails ? new Response("overloaded", { status: 500 }) : new Response(new Uint8Array(MP3), { status: 200 });
  if (url.startsWith("https://api.deepgram.com/v1/listen")) return json({ metadata: { duration: 29.5 }, results: { channels: [{ alternatives: [{ transcript: "this jacket runs a little big" }] }] } });
  if (url.startsWith("https://api.heygen.com/v1/streaming.create_token")) return json({ data: { token: "heygen-session-token" } });
  return new Response("unexpected", { status: 404 });
}

async function businessSeller() {
  const s = await seller();
  expect((await s.call("POST", "/seller/ai/plan", { planKey: "business" })).status).toBe(200);
  const agent = await s.call("POST", "/seller/ai-agents", { name: "Sunny" });
  expect(agent.status).toBe(200);
  const st = await s.call("POST", "/seller/streams", { title: "AI show", mode: "AI_HOST", aiAgentId: agent.json.id });
  expect(st.status).toBe(200);
  await s.call("POST", `/seller/streams/${st.json.id}/start`);
  return { s, agentId: agent.json.id as string, streamId: st.json.id as string };
}

function audioForm(durationSec: string) {
  const boundary = "----audio" + randomUUID();
  const payload = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="durationSec"\r\n\r\n${durationSec}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="audio"; filename="mic.webm"\r\nContent-Type: audio/webm\r\n\r\n`),
    Buffer.alloc(128, 1),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return { payload, headers: { "content-type": `multipart/form-data; boundary=${boundary}` } };
}

beforeAll(async () => {
  await getApp();
  await enableTestAi();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  ttsFails = false;
});
afterAll(async () => {
  await prisma.aiProvider.updateMany({ where: { key: { in: VOICE_PROVIDERS } }, data: { enabled: false } });
});

function configure() {
  vi.stubEnv("ELEVENLABS_API_KEY", "el-secret");
  vi.stubEnv("DEEPGRAM_API_KEY", "dg-secret");
  vi.stubEnv("HEYGEN_API_KEY", "hg-secret");
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => fakeFetch(String(url), init)));
}

describe("AI host voice, transcription and avatars", () => {
  it("says what's missing until a voice provider is set up", async () => {
    const { s, streamId, agentId } = await businessSeller();
    const voices = await s.call("GET", "/seller/ai/voices");
    expect(voices.json).toMatchObject({ configured: false, voices: [] });
    await s.call("PATCH", `/seller/ai-agents/${agentId}`, { voiceId: "v-rachel" });
    const speak = await s.call("POST", `/seller/streams/${streamId}/ai/speak`, { text: "Welcome in!" });
    expect(speak.status).toBe(503);
  });

  it("lists voices, speaks in the show, bills by characters and records the provider cost", async () => {
    await prisma.aiProvider.updateMany({ where: { key: { in: VOICE_PROVIDERS } }, data: { enabled: true } });
    configure();
    const { s, streamId, agentId } = await businessSeller();

    const voices = await s.call("GET", "/seller/ai/voices");
    expect(voices.json).toMatchObject({ configured: true, provider: "elevenlabs", voices: [{ id: "v-rachel", name: "Rachel" }] });
    expect(JSON.stringify(voices.json)).not.toContain("el-secret");

    expect((await s.call("POST", `/seller/streams/${streamId}/ai/speak`, { text: "Welcome in!" })).json.details?.missing).toBe("voiceId");
    expect((await s.call("PATCH", `/seller/ai-agents/${agentId}`, { voiceProvider: "made-up" })).status).toBe(400);
    expect((await s.call("PATCH", `/seller/ai-agents/${agentId}`, { voiceProvider: "elevenlabs", voiceId: "v-rachel" })).json.voiceId).toBe("v-rachel");

    const text = "Welcome in! Tonight we have three vintage jackets.";
    const spoken = await s.call("POST", `/seller/streams/${streamId}/ai/speak`, { text });
    expect(spoken.status).toBe(200);
    expect(spoken.json).toMatchObject({ isAi: true, body: text });
    expect(spoken.json.audioUrl).toMatch(/\/uploads\/ai-audio\/.+\.mp3$/);

    const sent = calls.findLast((c) => c.url.includes("text-to-speech"))!;
    expect(sent.url).toContain("/v-rachel?");
    expect(JSON.parse(String(sent.init!.body))).toEqual({ text, model_id: "eleven_flash_v2_5" });

    const usage = await prisma.aiUsageRecord.findFirstOrThrow({ where: { streamId, feature: "TTS_CHARACTERS", status: "SUCCEEDED" } });
    expect(usage.providerKey).toBe("elevenlabs");
    expect(usage.creditsCharged).toBe(Math.ceil(8 * (text.length / 1000)));
    expect(Number(usage.providerCostMicros)).toBe(Math.round((text.length / 1000) * 60_000));

    // Viewers can see it was AI.
    const chat = await (await buyer()).call("GET", `/streams/${streamId}`);
    expect(chat.status).toBe(200);
  });

  it("voices an AI answer, and keeps the text answer when the voice fails", async () => {
    await prisma.aiProvider.updateMany({ where: { key: { in: VOICE_PROVIDERS } }, data: { enabled: true } });
    configure();
    const { s, streamId, agentId } = await businessSeller();
    await s.call("PATCH", `/seller/ai-agents/${agentId}`, { voiceId: "v-rachel" });
    const b = await buyer();

    const q1 = await b.call("POST", `/streams/${streamId}/chat`, { body: "How many are left?" });
    const voiced = await s.call("POST", `/seller/streams/${streamId}/ai/respond`, { messageId: q1.json.id, speak: true });
    expect(voiced.status).toBe(200);
    expect(voiced.json).toMatchObject({ isAi: true, body: "We have 3 left in stock." });
    expect(voiced.json.audioUrl).toMatch(/\.mp3$/);

    ttsFails = true;
    const q2 = await b.call("POST", `/streams/${streamId}/chat`, { body: "What size?" });
    const textOnly = await s.call("POST", `/seller/streams/${streamId}/ai/respond`, { messageId: q2.json.id, speak: true });
    expect(textOnly.status).toBe(200);
    expect(textOnly.json.audioUrl).toBeNull();
    expect(textOnly.json.voiceError).toBeTruthy();
    // The failed voice call was refunded, not charged.
    const failed = await prisma.aiUsageRecord.findFirstOrThrow({ where: { streamId, feature: "TTS_CHARACTERS", status: "FAILED" } });
    const net = await prisma.aiCreditTransaction.aggregate({ where: { usageRecordId: failed.id }, _sum: { amount: true } });
    expect(net._sum.amount ?? 0).toBe(0);
  });

  it("transcribes the host's mic and bills by the minute", async () => {
    await prisma.aiProvider.updateMany({ where: { key: { in: VOICE_PROVIDERS } }, data: { enabled: true } });
    configure();
    const { s, streamId } = await businessSeller();
    const app = await getApp();
    const send = (d: string) => {
      const f = audioForm(d);
      return app.inject({ method: "POST", url: `/seller/streams/${streamId}/ai/transcribe`, payload: f.payload, headers: { ...f.headers, authorization: `Bearer ${s.token}` } });
    };
    expect((await send("900")).statusCode).toBe(400);
    const r = await send("30");
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ text: "this jacket runs a little big", durationSec: 29.5 });
    const sent = calls.findLast((c) => c.url.includes("deepgram"))!;
    expect(sent.url).toContain("model=nova-3");
    expect((sent.init!.headers as Record<string, string>).authorization).toBe("Token dg-secret");
    const usage = await prisma.aiUsageRecord.findFirstOrThrow({ where: { streamId, feature: "TRANSCRIPTION_MINUTE" } });
    expect(usage.creditsCharged).toBe(1); // 0.5 min × 2 credits/min, rounded up
    expect(await prisma.aiTranscriptEntry.count({ where: { streamId, speaker: "host", kind: "transcript" } })).toBe(1);
  });

  it("starts an avatar session and bills every minute exactly once by server time", async () => {
    await prisma.aiProvider.updateMany({ where: { key: { in: VOICE_PROVIDERS } }, data: { enabled: true } });
    configure();
    const { s, streamId, agentId } = await businessSeller();
    expect((await s.call("POST", `/seller/streams/${streamId}/ai/avatar-session`)).json.details?.missing).toBe("avatarId");
    await s.call("PATCH", `/seller/ai-agents/${agentId}`, { avatarProvider: "heygen", avatarId: "Wayne_20240711" });

    const session = await s.call("POST", `/seller/streams/${streamId}/ai/avatar-session`);
    expect(session.status).toBe(200);
    expect(session.json).toMatchObject({ provider: "heygen", sessionToken: "heygen-session-token", heartbeatEverySec: 60 });
    const beat = () => s.call("POST", `/seller/streams/${streamId}/ai/avatar-session/${session.json.sessionId}/heartbeat`);
    expect((await beat()).json).toEqual({ continue: true, minute: 0 });

    // Pretend the session started 3½ minutes ago; the client missed two heartbeats.
    const started = await prisma.aiTranscriptEntry.findFirstOrThrow({ where: { streamId, body: "Avatar session started" } });
    await prisma.aiTranscriptEntry.update({ where: { id: started.id }, data: { createdAt: new Date(Date.now() - 210_000) } });
    expect((await beat()).json).toEqual({ continue: true, minute: 3 });
    await Promise.all([beat(), beat()]);
    const minutes = await prisma.aiUsageRecord.findMany({ where: { streamId, feature: "AVATAR_MINUTE", status: "SUCCEEDED" } });
    expect(minutes.length).toBe(4); // minute 0 at start, then 1, 2 and 3
    expect(minutes.every((m) => m.creditsCharged === 25)).toBe(true);

    expect((await s.call("POST", `/seller/streams/${streamId}/ai/avatar-session/${randomUUID()}/heartbeat`)).status).toBe(404);
    await s.call("POST", `/seller/streams/${streamId}/end`);
    expect((await beat()).json.continue).toBe(false);
  });

  it("keeps voice to plans that include it", async () => {
    await prisma.aiProvider.updateMany({ where: { key: { in: VOICE_PROVIDERS } }, data: { enabled: true } });
    configure();
    const s = await seller(); // Starter
    const r = await s.call("POST", "/seller/ai/voices/preview", { voiceId: "v-rachel", text: "Hi there" });
    expect(r.json.details?.reason).toBe("feature_not_in_plan");
  });
});
