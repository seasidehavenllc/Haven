import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { vi } from "vitest";
import { prisma } from "../src/db";
import { geminiAdapter, groqAdapter } from "../src/ai/adapters";
import { buyer, enableTestAi, getApp } from "./helpers";

const calls: { url: string; init?: RequestInit }[] = [];
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const geminiReply = (text: string) => json({ candidates: [{ content: { parts: [{ text }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 30 } });

async function seedFree() {
  for (const [key, envVar] of [["gemini", "GEMINI_API_KEY"], ["groq", "GROQ_API_KEY"]] as const) {
    const p = await prisma.aiProvider.upsert({ where: { key }, update: { enabled: true }, create: { key, name: key, adapter: key, credentialEnvVar: envVar, enabled: true } });
    const m = await prisma.aiProviderModel.upsert({
      where: { providerId_modelId_capability: { providerId: p.id, modelId: `${key}-model`, capability: "LLM_TEXT" } },
      update: {},
      create: { providerId: p.id, modelId: `${key}-model`, capability: "LLM_TEXT" },
    });
    if (!(await prisma.aiRoutingRule.findFirst({ where: { modelRefId: m.id, feature: "SHOPPING_ASSISTANT" } })))
      await prisma.aiRoutingRule.create({ data: { feature: "SHOPPING_ASSISTANT", modelRefId: m.id, priority: 50, minPlanTier: 0 } });
  }
}

beforeAll(async () => {
  await getApp();
  await enableTestAi();
  await seedFree();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  calls.length = 0;
});

describe("free AI providers", () => {
  it("Gemini sends images, the JSON schema and the key in a header, and reads usage", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => (calls.push({ url: String(url), init }), geminiReply('{"title":"Mug"}'))));
    const r = await geminiAdapter.structured<{ title: string }>("g-secret", {
      model: "gemini-3.8-flash",
      system: "Identify the product.",
      prompt: "What is this?",
      images: [{ mime: "image/png", base64: "AAAA" }],
      schema: { type: "object", properties: { title: { type: "string" } } },
    });
    expect(r).toEqual({ output: { title: "Mug" }, inputTokens: 120, outputTokens: 30 });
    expect(calls[0].url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent");
    expect((calls[0].init!.headers as Record<string, string>)["x-goog-api-key"]).toBe("g-secret");
    expect(calls[0].url).not.toContain("g-secret");
    const body = JSON.parse(String(calls[0].init!.body));
    expect(body.contents[0].parts[0]).toEqual({ inline_data: { mime_type: "image/png", data: "AAAA" } });
    expect(body.generationConfig).toMatchObject({ responseMimeType: "application/json", responseJsonSchema: { type: "object" } });
    expect(body.systemInstruction.parts[0].text).toBe("Identify the product.");
  });

  it("Gemini chat maps assistant turns to the model role, and safety blocks are not retried", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => (calls.push({ url: String(url), init }), geminiReply("Hello!"))));
    const r = await geminiAdapter.chat("k", { model: "m", system: "s", messages: [{ role: "user", content: "hi" }, { role: "assistant", content: "hey" }, { role: "user", content: "?" }] });
    expect(r.output).toBe("Hello!");
    expect(JSON.parse(String(calls[0].init!.body)).contents.map((c: any) => c.role)).toEqual(["user", "model", "user"]);

    vi.stubGlobal("fetch", vi.fn(async () => json({ candidates: [{ finishReason: "SAFETY" }] })));
    await expect(geminiAdapter.chat("k", { model: "m", system: "s", messages: [{ role: "user", content: "x" }] })).rejects.toMatchObject({ retryable: false });
    vi.stubGlobal("fetch", vi.fn(async () => json({ error: { message: "quota" } }, 429)));
    await expect(geminiAdapter.chat("k", { model: "m", system: "s", messages: [{ role: "user", content: "x" }] })).rejects.toMatchObject({ retryable: true });
  });

  it("Groq uses its OpenAI-compatible endpoint with JSON mode and the schema in the instructions", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => (calls.push({ url: String(url), init }), json({ choices: [{ message: { content: '{"ok":true}' }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 3 } }))),
    );
    const r = await groqAdapter.structured("q-secret", { model: "llama-3.3-70b-versatile", system: "S", prompt: "P", schema: { type: "object" } });
    expect(r.output).toEqual({ ok: true });
    expect(calls[0].url).toBe("https://api.groq.com/openai/v1/chat/completions");
    const body = JSON.parse(String(calls[0].init!.body));
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.messages[0].content).toContain('{"type":"object"}');
    expect(body.messages[1].content).toBe("P");
  });

  it("AI_PROVIDER pins the feature to one provider and records it in the usage ledger", async () => {
    vi.stubEnv("AI_PROVIDER", "gemini");
    vi.stubEnv("GEMINI_API_KEY", "g-secret");
    vi.stubEnv("TEST_AI_KEY", "t");
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => (calls.push({ url: String(url), init }), geminiReply('{"keywords":["zzz-no-such-thing"],"inStockOnly":false,"liveOnly":false}'))));
    const b = await buyer();
    const r = await b.call("POST", "/assistant", { message: "find me a zzz-no-such-thing" });
    expect(r.status).toBe(200);
    expect(calls[0].url).toContain("generativelanguage.googleapis.com");
    const usage = await prisma.aiUsageRecord.findFirstOrThrow({ where: { userId: b.userId, feature: "SHOPPING_ASSISTANT" }, orderBy: { createdAt: "desc" } });
    expect(usage).toMatchObject({ status: "SUCCEEDED", providerKey: "gemini", inputTokens: 120, outputTokens: 30 });

    // AI_MODEL swaps the model id without touching the database.
    vi.stubEnv("AI_MODEL", "gemini-custom-model");
    calls.length = 0;
    expect((await b.call("POST", "/assistant", { message: "find me a zzz-no-such-thing" })).status).toBe(200);
    expect(calls[0].url).toContain("/models/gemini-custom-model:generateContent");
  });

  it("says which key is missing when the pinned provider has none", async () => {
    vi.stubEnv("AI_PROVIDER", "groq");
    vi.stubEnv("GROQ_API_KEY", "");
    vi.stubEnv("TEST_AI_KEY", "t");
    const r = await (await buyer()).call("POST", "/assistant", { message: "anything nice?" });
    expect(r.status).toBe(503);
    expect(JSON.stringify(r.json)).toContain("AI_PROVIDER=groq");
  });
});
