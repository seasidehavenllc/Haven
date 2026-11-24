import { createHmac, randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { prisma } from "../src/db";
import { stripePublishableKey } from "../src/payments";
import { getApp, seller } from "./helpers";

const SECRET = "whsec_test_secret";
async function sendWebhook(event: unknown) {
  const app = await getApp();
  const raw = JSON.stringify(event);
  const t = Math.floor(Date.now() / 1000);
  const sig = createHmac("sha256", SECRET).update(`${t}.${raw}`).digest("hex");
  return app.inject({ method: "POST", url: "/webhooks/stripe", payload: raw, headers: { "content-type": "application/json", "stripe-signature": `t=${t},v1=${sig}` } });
}

beforeAll(async () => {
  await getApp();
});
afterEach(() => vi.unstubAllEnvs());

describe("Stripe card payments", () => {
  it("only hands out a publishable key that matches the secret key's mode", () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_abc");
    vi.stubEnv("STRIPE_PUBLISHABLE_KEY", "pk_test_xyz");
    expect(stripePublishableKey()).toBe("pk_test_xyz");
    vi.stubEnv("STRIPE_PUBLISHABLE_KEY", "pk_live_xyz");
    expect(stripePublishableKey()).toBeNull();
    vi.stubEnv("STRIPE_PUBLISHABLE_KEY", "sk_test_oops");
    expect(stripePublishableKey()).toBeNull();
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    vi.stubEnv("STRIPE_PUBLISHABLE_KEY", "pk_test_xyz");
    expect(stripePublishableKey()).toBeNull();
  });

  it("adds credit pack credits once when Stripe confirms the payment", async () => {
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", SECRET);
    const s = await seller();
    const sellerId = (await prisma.sellerAccount.findFirstOrThrow({ where: { userId: s.userId } })).id;
    const key = `purchase:${sellerId}:${randomUUID()}`;
    const pi = { id: `pi_${randomUUID()}`, amount_received: 1000, metadata: { checkoutId: key, aiCharge: "CREDIT_PACK", sellerId, key: "small", credits: "1000" } };
    const evt = { type: "payment_intent.succeeded", data: { object: pi } };
    expect((await sendWebhook(evt)).statusCode).toBe(200);
    expect((await sendWebhook(evt)).statusCode).toBe(200); // Stripe retries must not add credits twice
    const rows = await prisma.aiCreditTransaction.findMany({ where: { idempotencyKey: key } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ amount: 1000, kind: "PURCHASE", revenueCents: 1000 });
    expect(await prisma.aiBillingCharge.count({ where: { providerRef: pi.id } })).toBe(1);
  });
});
