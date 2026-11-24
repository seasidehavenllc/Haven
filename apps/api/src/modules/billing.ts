import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db";
import { requireSeller } from "../lib/auth";
import { badRequest, conflict, notFound } from "../lib/errors";
import { parse } from "../lib/validate";
import { audit } from "../lib/audit";
import { creditBalance, expireAllowance, grantAllowance, lockSeller, creditsUsedSince } from "../ai/ledger";
import { featureAvailability } from "../ai/gateway";
import { activePaymentProvider, createPaymentIntent } from "../payments";
import { emit } from "../realtime";
import { notify, createNotifications, deliver } from "../notify";

const addPeriod = (d: Date, interval: string) => {
  const n = new Date(d);
  if (interval === "year") n.setUTCFullYear(n.getUTCFullYear() + 1);
  else n.setUTCMonth(n.getUTCMonth() + 1);
  return n;
};

/**
 * Collect money for an AI charge. Stripe Billing (recurring subscriptions) is wired in Phase 5;
 * today paid charges settle only through the clearly-labelled test provider outside production.
 */
async function collectAiCharge(opts: { sellerId: string; amountCents: number; kind: "SUBSCRIPTION" | "CREDIT_PACK"; key: string; idempotencyKey: string; credits?: number }) {
  const provider = activePaymentProvider();
  if (provider === "stripe") {
    // One-off PaymentIntent for credit packs; subscription renewals will move to Stripe Billing.
    const pi = await createPaymentIntent({ amountCents: opts.amountCents, currency: "USD", checkoutId: opts.idempotencyKey, idempotencyKey: `ai:${opts.idempotencyKey}`, metadata: { aiCharge: opts.kind, sellerId: opts.sellerId, key: opts.key, ...(opts.credits != null ? { credits: String(opts.credits) } : {}) } });
    return { settled: false, provider, providerRef: pi.providerRef, clientSecret: pi.clientSecret };
  }
  const pi = await createPaymentIntent({ amountCents: opts.amountCents, currency: "USD", checkoutId: opts.idempotencyKey, idempotencyKey: opts.idempotencyKey });
  return { settled: pi.settled, provider: pi.provider, providerRef: pi.providerRef, clientSecret: undefined };
}

/**
 * Stripe confirmed a credit pack payment (webhook). Credits are added once: the ledger row's
 * idempotency key is the same one the purchase request used. The credits and price come from what
 * was agreed at purchase time (PaymentIntent metadata and amount), not today's pack settings.
 */
export async function completeCreditPackPayment(pi: { id: string; amount_received?: number; amount?: number; metadata?: Record<string, string> }) {
  const m = pi.metadata ?? {};
  const credits = Number(m.credits);
  if (m.aiCharge !== "CREDIT_PACK" || !m.sellerId || !m.checkoutId || !Number.isInteger(credits) || credits <= 0) return false;
  const amountCents = pi.amount_received ?? pi.amount ?? 0;
  const pack = await prisma.aiCreditPack.findUnique({ where: { key: m.key } });
  const done = await prisma.$transaction(async (tx) => {
    if (await tx.aiCreditTransaction.findUnique({ where: { idempotencyKey: m.checkoutId } })) return false;
    await tx.aiBillingCharge.create({ data: { sellerId: m.sellerId, kind: "CREDIT_PACK", packKey: m.key, amountCents, provider: "stripe", providerRef: pi.id, isTest: false } });
    await tx.aiCreditTransaction.create({ data: { sellerId: m.sellerId, kind: "PURCHASE", amount: credits, bucket: "purchased", idempotencyKey: m.checkoutId, revenueCents: amountCents, note: pack?.name ?? m.key } });
    return true;
  });
  if (done) {
    await audit(prisma, { action: "ai.credits.purchase", targetType: "seller", targetId: m.sellerId, data: { pack: m.key, providerRef: pi.id } });
    emit(`seller:${m.sellerId}`, "credits:changed", await creditBalance(prisma, m.sellerId));
  }
  return true;
}

/** Roll every subscription whose period ended: expire unused allowance (minus rollover), grant the next one. */
export async function renewSubscriptions() {
  const due = await prisma.sellerSubscription.findMany({ where: { status: "ACTIVE", currentPeriodEnd: { lte: new Date() } }, include: { plan: true } });
  for (const sub of due) {
    const periodKey = sub.currentPeriodEnd.toISOString().slice(0, 10);
    if (sub.cancelAtPeriodEnd) {
      const starter = await prisma.aiPlan.findFirst({ where: { tier: 0, active: true } });
      await prisma.$transaction(async (tx) => {
        await lockSeller(tx, sub.sellerId);
        await expireAllowance(tx, sub.sellerId, 0, periodKey);
        if (starter) {
          await tx.sellerSubscription.update({ where: { id: sub.id }, data: { planId: starter.id, cancelAtPeriodEnd: false, currentPeriodStart: sub.currentPeriodEnd, currentPeriodEnd: addPeriod(sub.currentPeriodEnd, "month"), interval: "month" } });
          await grantAllowance(tx, sub.sellerId, starter.monthlyCredits, periodKey);
        } else await tx.sellerSubscription.update({ where: { id: sub.id }, data: { status: "CANCELLED" } });
      });
      continue;
    }
    if (sub.plan.monthlyPriceCents > 0) {
      const amount = sub.interval === "year" ? (sub.plan.annualPriceCents ?? sub.plan.monthlyPriceCents * 12) : sub.plan.monthlyPriceCents;
      try {
        const c = await collectAiCharge({ sellerId: sub.sellerId, amountCents: amount, kind: "SUBSCRIPTION", key: sub.plan.key, idempotencyKey: `renew:${sub.id}:${periodKey}` });
        if (!c.settled) continue; // Stripe webhook completes renewal
        await prisma.aiBillingCharge.upsert({ where: { providerRef: c.providerRef }, update: {}, create: { sellerId: sub.sellerId, kind: "SUBSCRIPTION", planKey: sub.plan.key, amountCents: amount, provider: c.provider, providerRef: c.providerRef, isTest: c.provider === "test" } });
      } catch {
        await prisma.sellerSubscription.update({ where: { id: sub.id }, data: { status: "PAST_DUE" } });
        const seller = await prisma.sellerAccount.findUniqueOrThrow({ where: { id: sub.sellerId } });
        await notify({ userId: seller.userId, type: "billing.payment_failed", title: "AI plan payment failed", body: "Update your payment method to keep AI features.", link: "/seller/ai" });
        continue;
      }
    }
    await prisma.$transaction(async (tx) => {
      await lockSeller(tx, sub.sellerId);
      await expireAllowance(tx, sub.sellerId, sub.plan.rolloverPercent, periodKey);
      await grantAllowance(tx, sub.sellerId, sub.plan.monthlyCredits * (sub.interval === "year" ? 12 : 1), periodKey);
      await tx.sellerSubscription.update({ where: { id: sub.id }, data: { currentPeriodStart: sub.currentPeriodEnd, currentPeriodEnd: addPeriod(sub.currentPeriodEnd, sub.interval) } });
    });
  }
  return due.length;
}

export async function billingRoutes(app: FastifyInstance) {
  app.get("/ai/plans", async () => ({
    plans: await prisma.aiPlan.findMany({ where: { active: true }, orderBy: { tier: "asc" } }),
    featurePrices: await prisma.aiFeaturePrice.findMany(),
    creditPacks: await prisma.aiCreditPack.findMany({ where: { active: true }, orderBy: { credits: "asc" } }),
  }));

  app.get("/seller/ai/billing", async (req) => {
    const { seller } = await requireSeller(req);
    const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
    const [sub, balance, usage, byFeature, charges, limits, availability, monthUsed] = await Promise.all([
      prisma.sellerSubscription.findUnique({ where: { sellerId: seller.id }, include: { plan: true } }),
      creditBalance(prisma, seller.id),
      prisma.aiUsageRecord.findMany({
        where: { sellerId: seller.id },
        orderBy: { createdAt: "desc" },
        take: 100,
        select: { id: true, feature: true, status: true, denyReason: true, creditsCharged: true, units: true, createdAt: true, streamId: true, scanId: true },
      }),
      prisma.aiUsageRecord.groupBy({ by: ["feature"], where: { sellerId: seller.id, status: "SUCCEEDED", createdAt: { gte: monthStart } }, _sum: { creditsCharged: true }, _count: true }),
      prisma.aiBillingCharge.findMany({ where: { sellerId: seller.id }, orderBy: { createdAt: "desc" }, take: 50 }),
      prisma.aiSpendingLimit.findUnique({ where: { sellerId: seller.id } }),
      featureAvailability(),
      creditsUsedSince(prisma, seller.id, monthStart),
    ]);
    const ledger = await prisma.aiCreditTransaction.findMany({ where: { sellerId: seller.id }, orderBy: { createdAt: "desc" }, take: 100 });
    // Provider costs are internal and never returned to sellers.
    return { subscription: sub, balance, monthUsed, usage, byFeature, ledger, charges, limits, availability, aiDisabled: seller.aiDisabled };
  });

  app.post("/seller/ai/plan", async (req) => {
    const { user, seller } = await requireSeller(req);
    const { planKey, interval } = parse(z.object({ planKey: z.string(), interval: z.enum(["month", "year"]).default("month") }), req.body);
    const plan = await prisma.aiPlan.findUnique({ where: { key: planKey } });
    if (!plan || !plan.active) throw notFound("Plan");
    const sub = await prisma.sellerSubscription.findUnique({ where: { sellerId: seller.id }, include: { plan: true } });
    if (sub?.planId === plan.id && sub.interval === interval && !sub.cancelAtPeriodEnd) throw conflict("You're already on this plan");

    // Downgrades take effect at period end; upgrades take effect now.
    if (sub && plan.tier < sub.plan.tier) {
      await prisma.sellerSubscription.update({ where: { id: sub.id }, data: { cancelAtPeriodEnd: plan.tier === 0 } });
      await audit(prisma, { actorId: user.id, action: "ai.plan.downgrade_scheduled", targetType: "seller", targetId: seller.id, data: { to: plan.key } });
      return { scheduled: true, effectiveAt: sub.currentPeriodEnd };
    }
    const amount = interval === "year" ? (plan.annualPriceCents ?? plan.monthlyPriceCents * 12) : plan.monthlyPriceCents;
    const now = new Date();
    const key = `plan:${seller.id}:${plan.key}:${now.toISOString().slice(0, 13)}`;
    if (amount > 0) {
      const c = await collectAiCharge({ sellerId: seller.id, amountCents: amount, kind: "SUBSCRIPTION", key: plan.key, idempotencyKey: key });
      if (!c.settled) return { requiresPayment: true, clientSecret: c.clientSecret };
      await prisma.aiBillingCharge.upsert({ where: { providerRef: c.providerRef }, update: {}, create: { sellerId: seller.id, kind: "SUBSCRIPTION", planKey: plan.key, amountCents: amount, provider: c.provider, providerRef: c.providerRef, isTest: c.provider === "test" } });
    }
    await prisma.$transaction(async (tx) => {
      await lockSeller(tx, seller.id);
      const end = addPeriod(now, interval);
      if (sub) await tx.sellerSubscription.update({ where: { id: sub.id }, data: { planId: plan.id, interval, status: "ACTIVE", cancelAtPeriodEnd: false, currentPeriodStart: now, currentPeriodEnd: end } });
      else await tx.sellerSubscription.create({ data: { sellerId: seller.id, planId: plan.id, interval, currentPeriodStart: now, currentPeriodEnd: end } });
      await expireAllowance(tx, seller.id, 0, `switch:${key}`);
      await grantAllowance(tx, seller.id, plan.monthlyCredits * (interval === "year" ? 12 : 1), `switch:${key}`, `${plan.name} allowance`);
    });
    await audit(prisma, { actorId: user.id, action: "ai.plan.change", targetType: "seller", targetId: seller.id, data: { to: plan.key, interval, amount } });
    emit(`seller:${seller.id}`, "credits:changed", await creditBalance(prisma, seller.id));
    return { ok: true, plan: plan.key };
  });

  app.post("/seller/ai/credits/purchase", async (req) => {
    const { user, seller } = await requireSeller(req);
    const { packKey, idempotencyKey } = parse(z.object({ packKey: z.string(), idempotencyKey: z.string().min(8).max(100) }), req.body);
    const pack = await prisma.aiCreditPack.findUnique({ where: { key: packKey } });
    if (!pack || !pack.active) throw notFound("Credit pack");
    const txnKey = `purchase:${seller.id}:${idempotencyKey}`;
    if (await prisma.aiCreditTransaction.findUnique({ where: { idempotencyKey: txnKey } })) return { ok: true, replay: true, balance: await creditBalance(prisma, seller.id) };
    const c = await collectAiCharge({ sellerId: seller.id, amountCents: pack.priceCents, kind: "CREDIT_PACK", key: pack.key, idempotencyKey: txnKey, credits: pack.credits });
    if (!c.settled) return { requiresPayment: true, clientSecret: c.clientSecret };
    await prisma.$transaction(async (tx) => {
      await tx.aiBillingCharge.create({ data: { sellerId: seller.id, kind: "CREDIT_PACK", packKey: pack.key, amountCents: pack.priceCents, provider: c.provider, providerRef: c.providerRef, isTest: c.provider === "test" } });
      await tx.aiCreditTransaction.create({ data: { sellerId: seller.id, kind: "PURCHASE", amount: pack.credits, bucket: "purchased", idempotencyKey: txnKey, revenueCents: pack.priceCents, note: `${pack.name}${c.provider === "test" ? " (TEST payment)" : ""}` } });
    });
    await audit(prisma, { actorId: user.id, action: "ai.credits.purchase", targetType: "seller", targetId: seller.id, data: { pack: pack.key, test: c.provider === "test" } });
    const balance = await creditBalance(prisma, seller.id);
    emit(`seller:${seller.id}`, "credits:changed", balance);
    return { ok: true, balance };
  });

  app.put("/seller/ai/limits", async (req) => {
    const { seller } = await requireSeller(req);
    const body = parse(z.object({ dailyCreditCap: z.number().int().min(0).nullable(), monthlyCreditCap: z.number().int().min(0).nullable(), warnAtCredits: z.number().int().min(0).nullable() }), req.body);
    if (body.dailyCreditCap != null && body.monthlyCreditCap != null && body.dailyCreditCap > body.monthlyCreditCap) throw badRequest("Daily cap can't exceed monthly cap");
    return prisma.aiSpendingLimit.upsert({ where: { sellerId: seller.id }, update: body, create: { sellerId: seller.id, ...body } });
  });

  app.put("/seller/ai/enabled", async (req) => {
    const { user, seller } = await requireSeller(req);
    const { enabled } = parse(z.object({ enabled: z.boolean() }), req.body);
    await prisma.sellerAccount.update({ where: { id: seller.id }, data: { aiDisabled: !enabled } });
    await audit(prisma, { actorId: user.id, action: enabled ? "ai.seller.enable" : "ai.seller.disable", targetType: "seller", targetId: seller.id });
    return { enabled };
  });
}
