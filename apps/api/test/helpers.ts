import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";
import { createSellerAccount } from "../src/modules/sellerApplications";
import { prisma } from "../src/db";
import { textAdapters, ProviderError, type TextAdapter } from "../src/ai/adapters";

let app: FastifyInstance;
export async function getApp() {
  if (!app) {
    app = await buildApp();
    await app.ready();
  }
  return app;
}

export type Client = { token: string; userId: string; call: (method: string, url: string, body?: unknown) => Promise<{ status: number; json: any }> };

export async function client(token?: string) {
  const a = await getApp();
  return async (method: string, url: string, body?: unknown) => {
    const res = await a.inject({ method: method as any, url, payload: body as any, headers: token ? { authorization: `Bearer ${token}` } : {} });
    return { status: res.statusCode, json: res.body ? JSON.parse(res.body) : null };
  };
}

export async function register(role: "BUYER" | "SELLER" = "BUYER") {
  const tag = randomUUID().slice(0, 8);
  const anon = await client();
  const r = await anon("POST", "/auth/register", { email: `${tag}@test.dev`, password: "correct-horse-battery", displayName: `User ${tag}`, handle: `u_${tag}`, role });
  if (r.status !== 200) throw new Error(JSON.stringify(r.json));
  return { token: r.json.accessToken as string, refreshToken: r.json.refreshToken as string, userId: r.json.user.id as string, tag };
}

/** An approved seller. Skips the application form (tested on its own in seller-applications.test.ts). */
export async function seller() {
  const u = await register("SELLER");
  const sellerRow = await prisma.$transaction((tx) => createSellerAccount(tx, { userId: u.userId, businessName: `Shop ${u.tag}`, storefront: { name: `Shop ${u.tag}`, slug: `shop-${u.tag}` } }));
  const token = (await (await client(u.token))("POST", "/auth/token")).json.accessToken as string;
  return { ...u, token, sellerId: sellerRow.id as string, call: await client(token) };
}

export async function buyer() {
  const u = await register();
  return { ...u, call: await client(u.token) };
}

export async function admin() {
  const u = await register();
  await prisma.user.update({ where: { id: u.userId }, data: { roles: ["BUYER", "ADMIN"], staffRole: "OWNER" } });
  return { ...u, call: await client(u.token) };
}

export async function product(s: Awaited<ReturnType<typeof seller>>, qty = 5, priceCents = 2500) {
  const r = await s.call("POST", "/seller/products", { title: `Test item ${randomUUID().slice(0, 4)}`, description: "Plain test item", variants: [{ name: "Default", priceCents, quantity: qty }] });
  if (r.status !== 200) throw new Error(JSON.stringify(r.json));
  return r.json;
}

export const address = { name: "Test Buyer", line1: "1 Main St", city: "Springfield", region: "IL", postalCode: "62701", country: "US" };

/**
 * Deterministic AI adapter for tests (registered under the provider key "testai").
 * Lets tests exercise metering, routing, fallback and ledger logic with no external calls.
 */
export const testAi = { fail: false, calls: 0, lastPrompt: "" };
const adapter: TextAdapter = {
  id: "testai",
  async structured(_k, req) {
    testAi.calls++;
    testAi.lastPrompt = req.prompt;
    if (testAi.fail) throw new ProviderError("testai", "simulated outage", true);
    return {
      output: {
        productType: "mug",
        title: "Ceramic coffee mug",
        description: "A plain ceramic mug.",
        categorySlug: "home",
        brand: { value: null, confidence: "low" },
        model: { value: null, confidence: "low" },
        condition: { value: "GOOD", confidence: "medium", notes: "Light wear visible" },
        attributes: [{ name: "color", value: "white", confidence: "high" }],
        tags: ["Mug", "kitchen"],
        variantHints: [],
        questionsForSeller: ["What is the capacity?"],
        price: null,
      } as any,
      inputTokens: 1000,
      outputTokens: 200,
    };
  },
  async chat(_k, req) {
    testAi.calls++;
    testAi.lastPrompt = req.messages.at(-1)!.content;
    if (testAi.fail) throw new ProviderError("testai", "simulated outage", true);
    return { output: "We have 3 left in stock.", inputTokens: 500, outputTokens: 20 };
  },
};

export async function enableTestAi() {
  textAdapters.testai = adapter;
  const p = await prisma.aiProvider.upsert({ where: { key: "testai" }, update: { enabled: true }, create: { key: "testai", name: "Test AI", adapter: "testai", credentialEnvVar: "TEST_AI_KEY", enabled: true } });
  for (const capability of ["VISION_PRODUCT_ID", "LLM_TEXT", "LLM_AGENT"]) {
    const m = await prisma.aiProviderModel.upsert({
      where: { providerId_modelId_capability: { providerId: p.id, modelId: "test-model", capability } },
      update: {},
      // $1 / $5 per MTok → 1000 in + 200 out = $0.002
      create: { providerId: p.id, modelId: "test-model", capability, inputCostMicrosPerMTok: 1_000_000, outputCostMicrosPerMTok: 5_000_000 },
    });
    for (const feature of ["PRODUCT_SCAN", "LISTING_GENERATION", "SHOPPING_ASSISTANT", "COHOST_MINUTE"]) {
      const exists = await prisma.aiRoutingRule.findFirst({ where: { feature, modelRefId: m.id } });
      const cap = { PRODUCT_SCAN: "VISION_PRODUCT_ID", LISTING_GENERATION: "LLM_TEXT", SHOPPING_ASSISTANT: "LLM_TEXT", COHOST_MINUTE: "LLM_AGENT" }[feature];
      if (!exists && cap === capability) await prisma.aiRoutingRule.create({ data: { feature, modelRefId: m.id, priority: 1, minPlanTier: 0 } });
    }
  }
}

/** Minimal valid 1x1 PNG. */
export const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082", "hex");

export function multipart(files: { name: string; data: Buffer; type: string }[], fields: Record<string, string> = {}) {
  const boundary = "----brandtest" + randomUUID();
  const chunks: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  for (const f of files) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="${f.name}"\r\nContent-Type: ${f.type}\r\n\r\n`));
    chunks.push(f.data, Buffer.from("\r\n"));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { payload: Buffer.concat(chunks), headers: { "content-type": `multipart/form-data; boundary=${boundary}` } };
}
