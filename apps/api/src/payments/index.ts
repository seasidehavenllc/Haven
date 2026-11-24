import { createHmac, timingSafeEqual } from "node:crypto";
import { env, testPaymentsAllowed } from "../env";
import { notConfigured } from "../lib/errors";

/**
 * Marketplace payment provider abstraction. Stripe Connect is the production target.
 * The "test" provider exists only outside production when ALLOW_TEST_PAYMENTS=true; every
 * record it creates is flagged isTest and excluded from revenue reporting.
 */
export interface PaymentIntentResult {
  provider: "stripe" | "test";
  providerRef: string;
  clientSecret?: string;
  /** test provider settles immediately; Stripe settles via webhook */
  settled: boolean;
}

export function activePaymentProvider(): "stripe" | "test" | null {
  if (env.STRIPE_SECRET_KEY) return "stripe";
  if (testPaymentsAllowed) return "test";
  return null;
}

async function stripe(path: string, params: Record<string, string>, idempotencyKey: string) {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      "content-type": "application/x-www-form-urlencoded",
      "idempotency-key": idempotencyKey,
    },
    body: new URLSearchParams(params),
  });
  const json = (await res.json()) as any;
  if (!res.ok) throw new Error(`Stripe error: ${json?.error?.message ?? res.status}`);
  return json;
}

export async function createPaymentIntent(opts: { amountCents: number; currency: string; checkoutId: string; idempotencyKey: string; metadata?: Record<string, string> }): Promise<PaymentIntentResult> {
  const provider = activePaymentProvider();
  if (!provider) throw notConfigured("Payments", ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"]);
  if (provider === "test") return { provider, providerRef: `test_${opts.checkoutId}`, settled: true };
  const pi = await stripe(
    "payment_intents",
    {
      amount: String(opts.amountCents),
      currency: opts.currency.toLowerCase(),
      "automatic_payment_methods[enabled]": "true",
      "metadata[checkoutId]": opts.checkoutId,
      ...Object.fromEntries(Object.entries(opts.metadata ?? {}).map(([k, v]) => [`metadata[${k}]`, v])),
    },
    opts.idempotencyKey,
  );
  return { provider, providerRef: pi.id, clientSecret: pi.client_secret, settled: false };
}

/**
 * The key the card form needs. Returned only when it pairs with the secret key: a pk_test key with
 * an sk_live key (or the other way round) would show a form that can never charge.
 */
export function stripePublishableKey(): string | null {
  const pk = process.env.STRIPE_PUBLISHABLE_KEY?.trim();
  const sk = process.env.STRIPE_SECRET_KEY?.trim();
  if (!pk || !sk || !pk.startsWith("pk_")) return null;
  const mode = (k: string) => (k.includes("_live_") ? "live" : "test");
  return mode(pk) === mode(sk) ? pk : null;
}

/** Verify a Stripe webhook signature header against the raw body. */
export function verifyStripeSignature(raw: Buffer, header: string | undefined, secret: string, toleranceSec = 300) {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=") as [string, string]));
  const t = Number(parts.t);
  if (!t || Math.abs(Date.now() / 1000 - t) > toleranceSec) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${raw.toString("utf8")}`).digest("hex");
  const sigs = header.split(",").filter((p) => p.startsWith("v1=")).map((p) => p.slice(3));
  return sigs.some((s) => s.length === expected.length && timingSafeEqual(Buffer.from(s), Buffer.from(expected)));
}
