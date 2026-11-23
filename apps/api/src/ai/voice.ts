import { ProviderError, type AdapterResult } from "./adapters";

/**
 * Voice, transcription and avatar adapters for AI hosts and co-hosts. Like the text adapters, each one
 * is selected by Admin → AI providers routing, gets its key from the env var named on the provider row,
 * and reports usage so the gateway can bill credits and record provider cost.
 *
 * Usage is reported in `inputTokens: 0, outputTokens: 0`; these are priced per unit (1k characters,
 * minutes) through AiProviderModel.unitCostMicros and the `units` the caller passes.
 */

export type Voice = { id: string; name: string; preview: string | null; labels: Record<string, string> };

export interface TtsAdapter {
  id: string;
  synthesize(apiKey: string, req: { model: string; voiceId: string; text: string }): Promise<AdapterResult<{ audio: Buffer; mime: "audio/mpeg" }>>;
  voices(apiKey: string): Promise<Voice[]>;
}

export interface SttAdapter {
  id: string;
  /** Transcribe a recorded clip (a host's mic segment, a voice question). */
  transcribe(apiKey: string, req: { model: string; audio: Buffer; mime: string; language?: string }): Promise<AdapterResult<{ text: string; durationSec: number }>>;
}

export interface AvatarAdapter {
  id: string;
  /**
   * Start a real-time avatar session the browser or app connects to directly. Returns a short-lived
   * session token, never the provider key.
   */
  createSession(apiKey: string, req: { model: string; avatarId: string; voiceId?: string | null }): Promise<AdapterResult<{ sessionToken: string; expiresInSec: number }>>;
}

async function http(provider: string, url: string, init: RequestInit, as: "json" | "buffer" = "json") {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    throw new ProviderError(provider, "connection error", true);
  }
  if (!res.ok) throw new ProviderError(provider, `${res.status}: ${(await res.text().catch(() => "")).slice(0, 300)}`, res.status === 429 || res.status >= 500);
  return as === "json" ? res.json() : Buffer.from(await res.arrayBuffer());
}
const unitResult = <T>(output: T): AdapterResult<T> => ({ output, inputTokens: 0, outputTokens: 0 });

// ── Text to speech ──

/** ElevenLabs (https://elevenlabs.io/docs/api-reference/text-to-speech). Model e.g. eleven_flash_v2_5. */
export const elevenlabs: TtsAdapter = {
  id: "elevenlabs",
  async synthesize(key, { model, voiceId, text }) {
    const audio = (await http("elevenlabs", `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`, {
      method: "POST",
      headers: { "xi-api-key": key, "content-type": "application/json", accept: "audio/mpeg" },
      body: JSON.stringify({ text, model_id: model }),
    }, "buffer")) as Buffer;
    return unitResult({ audio, mime: "audio/mpeg" as const });
  },
  async voices(key) {
    const j = await http("elevenlabs", "https://api.elevenlabs.io/v1/voices", { headers: { "xi-api-key": key } });
    return (j.voices ?? []).map((v: any) => ({ id: v.voice_id, name: v.name, preview: v.preview_url ?? null, labels: v.labels ?? {} }));
  },
};

const OPENAI_VOICES = ["alloy", "ash", "ballad", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer", "verse"];
/** OpenAI speech (https://platform.openai.com/docs/api-reference/audio/createSpeech). Model e.g. gpt-4o-mini-tts. */
export const openaiTts: TtsAdapter = {
  id: "openai-tts",
  async synthesize(key, { model, voiceId, text }) {
    const audio = (await http("openai-tts", "https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ model, voice: voiceId, input: text, response_format: "mp3" }),
    }, "buffer")) as Buffer;
    return unitResult({ audio, mime: "audio/mpeg" as const });
  },
  async voices() {
    return OPENAI_VOICES.map((v) => ({ id: v, name: v[0]!.toUpperCase() + v.slice(1), preview: null, labels: {} }));
  },
};

// ── Speech to text ──

/** Deepgram pre-recorded transcription (https://developers.deepgram.com/reference/listen-file). Model e.g. nova-3. */
export const deepgram: SttAdapter = {
  id: "deepgram",
  async transcribe(key, { model, audio, mime, language }) {
    const qs = new URLSearchParams({ model, smart_format: "true", ...(language ? { language } : {}) });
    const j = await http("deepgram", `https://api.deepgram.com/v1/listen?${qs}`, { method: "POST", headers: { authorization: `Token ${key}`, "content-type": mime }, body: new Uint8Array(audio) });
    return unitResult({ text: j.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? "", durationSec: Number(j.metadata?.duration ?? 0) });
  },
};

// ── Avatars ──

/** HeyGen streaming avatar: mints a session token the client SDK uses (https://docs.heygen.com). */
export const heygen: AvatarAdapter = {
  id: "heygen",
  async createSession(key) {
    const j = await http("heygen", "https://api.heygen.com/v1/streaming.create_token", { method: "POST", headers: { "x-api-key": key } });
    const token = j.data?.token;
    if (!token) throw new ProviderError("heygen", "No session token in response", true);
    return unitResult({ sessionToken: token, expiresInSec: 3600 });
  },
};

export const ttsAdapters: Record<string, TtsAdapter> = { elevenlabs, "openai-tts": openaiTts };
export const sttAdapters: Record<string, SttAdapter> = { deepgram };
export const avatarAdapters: Record<string, AvatarAdapter> = { heygen };

/** Speech is priced per 1,000 characters. */
export const ttsUnits = (text: string) => text.length / 1000;
