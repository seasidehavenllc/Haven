import type { AiFeature } from "@haven/shared";
import { prisma } from "../db";
import { paymentRequired, notConfigured, HttpError } from "../lib/errors";
import { emit } from "../realtime";
import { textAdapters, ProviderError, type AdapterResult, type TextAdapter } from "./adapters";
import { avatarAdapters, sttAdapters, ttsAdapters } from "./voice";
import { creditBalance, creditsUsedSince, lockSeller } from "./ledger";

export const FEATURE_CAPABILITY: Record<AiFeature, string> = {
  PRODUCT_SCAN: "VISION_PRODUCT_ID",
  LISTING_GENERATION: "LLM_TEXT",
  PRICE_SUGGESTION: "LLM_TEXT",
  SHOPPING_ASSISTANT: "LLM_TEXT",
  COHOST_MINUTE: "LLM_AGENT",
  AI_HOST_MINUTE: "LLM_AGENT",
  TRANSCRIPTION_MINUTE: "SPEECH_TO_TEXT",
  TTS_CHARACTERS: "TEXT_TO_SPEECH",
  AVATAR_MINUTE: "AVATAR_VIDEO",
};

export interface AiContext {
  /** Seller being billed. null = platform-paid (e.g. buyer shopping assistant). */
  sellerId: string | null;
  userId?: string | null;
  feature: AiFeature;
  /** Billing units for this call (1 scan, N minutes...). */
  units?: number;
  streamId?: string;
  productId?: string;
  scanId?: string;
  /** Caller-supplied idempotency key; repeating it never double-charges. */
  idempotencyKey: string;
}

type Candidate<A = TextAdapter> = {
  providerKey: string;
  adapter: A;
  apiKey: string;
  modelId: string;
  inCost: number;
  outCost: number;
  unitCost: number;
};

const startOfDay = () => {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
};
const startOfMonth = () => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
};

async function recordDenied(ctx: AiContext, reason: string, planKey?: string) {
  await prisma.aiUsageRecord.create({
    data: {
      sellerId: ctx.sellerId,
      userId: ctx.userId ?? null,
      planKey,
      feature: ctx.feature,
      capability: FEATURE_CAPABILITY[ctx.feature],
      status: "DENIED",
      denyReason: reason,
      streamId: ctx.streamId,
      productId: ctx.productId,
      scanId: ctx.scanId,
    },
  });
}

/**
 * Pre-flight checks (in order): platform kill switch, seller active/AI enabled, plan includes
 * feature, per-feature plan limits, seller spending caps, credit balance, platform budget.
 */
export async function authorize(ctx: AiContext) {
  const settings = await prisma.platformSettings.findUnique({ where: { id: "global" } });
  const deny = async (reason: string, msg: string, details?: object, planKey?: string): Promise<never> => {
    await recordDenied(ctx, reason, planKey);
    throw paymentRequired(msg, { reason, ...details });
  };
  if (settings?.aiEmergencyDisabled) return deny("platform_disabled", "AI features are temporarily disabled by the platform.");

  // platform budget (provider spend)
  if (settings?.aiDailyBudgetMicros || settings?.aiMonthlyBudgetMicros) {
    const [day, month] = await Promise.all([
      prisma.aiUsageRecord.aggregate({ where: { createdAt: { gte: startOfDay() } }, _sum: { providerCostMicros: true } }),
      prisma.aiUsageRecord.aggregate({ where: { createdAt: { gte: startOfMonth() } }, _sum: { providerCostMicros: true } }),
    ]);
    if (settings.aiDailyBudgetMicros && (day._sum.providerCostMicros ?? 0n) >= settings.aiDailyBudgetMicros)
      return deny("platform_budget", "AI capacity for today has been reached. Please try again later.");
    if (settings.aiMonthlyBudgetMicros && (month._sum.providerCostMicros ?? 0n) >= settings.aiMonthlyBudgetMicros)
      return deny("platform_budget", "AI capacity for this month has been reached.");
  }

  const price = await prisma.aiFeaturePrice.findUnique({ where: { feature: ctx.feature } });
  const units = ctx.units ?? 1;
  const credits = price ? Math.ceil(price.creditsPerUnit * units) : 0;

  if (!ctx.sellerId) return { credits: 0, planKey: undefined as string | undefined, planTier: 1 };

  const seller = await prisma.sellerAccount.findUnique({
    where: { id: ctx.sellerId },
    include: { subscription: { include: { plan: true } }, spendingLimit: true },
  });
  if (!seller || seller.status !== "APPROVED") return deny("seller_inactive", "Seller account is not active.");
  if (seller.aiDisabled) return deny("seller_ai_disabled", "AI is turned off for this store.");
  const sub = seller.subscription;
  if (!sub || sub.status !== "ACTIVE" || sub.currentPeriodEnd < new Date())
    return deny("no_active_plan", "No active AI plan. Choose a plan to use AI features.");
  const plan = sub.plan;
  if (!plan.features.includes(ctx.feature))
    return deny("feature_not_in_plan", `Your ${plan.name} plan does not include this AI feature.`, { upgrade: true }, plan.key);

  const limit = (plan.limits as Record<string, { perCallMaxUnits?: number }>)[ctx.feature];
  if (limit?.perCallMaxUnits && units > limit.perCallMaxUnits)
    return deny("plan_limit", `Your plan allows at most ${limit.perCallMaxUnits} units per use of this feature.`, { upgrade: true }, plan.key);

  const cap = seller.spendingLimit;
  if (cap?.dailyCreditCap != null && (await creditsUsedSince(prisma, seller.id, startOfDay())) + credits > cap.dailyCreditCap)
    return deny("seller_daily_cap", "You reached your daily AI spending limit.", {}, plan.key);
  if (cap?.monthlyCreditCap != null && (await creditsUsedSince(prisma, seller.id, startOfMonth())) + credits > cap.monthlyCreditCap)
    return deny("seller_monthly_cap", "You reached your monthly AI spending limit.", {}, plan.key);

  const bal = await creditBalance(prisma, seller.id);
  if (bal.total < credits)
    return deny("insufficient_credits", `This needs ${credits} credits and you have ${bal.total}.`, { needed: credits, balance: bal.total, buyCredits: true, upgrade: true }, plan.key);

  return { credits, planKey: plan.key, planTier: plan.tier };
}

async function candidates<A>(feature: AiFeature, planTier: number, registry: Record<string, A>): Promise<Candidate<A>[]> {
  const rules = await prisma.aiRoutingRule.findMany({
    where: { feature, enabled: true, minPlanTier: { lte: planTier } },
    orderBy: { priority: "asc" },
  });
  const models = await prisma.aiProviderModel.findMany({
    where: { id: { in: rules.map((r) => r.modelRefId) }, enabled: true, provider: { enabled: true } },
    include: { provider: true },
  });
  const out: Candidate<A>[] = [];
  for (const r of rules) {
    const m = models.find((x) => x.id === r.modelRefId);
    if (!m) continue;
    const adapter = registry[m.provider.adapter];
    const apiKey = process.env[m.provider.credentialEnvVar];
    if (!adapter || !apiKey) continue;
    out.push({
      providerKey: m.provider.key,
      adapter,
      apiKey,
      modelId: m.modelId,
      inCost: m.inputCostMicrosPerMTok,
      outCost: m.outputCostMicrosPerMTok,
      unitCost: m.unitCostMicros,
    });
  }
  return out;
}

/** Which features currently have at least one usable provider (for UI + health). */
export async function featureAvailability() {
  const feats = Object.keys(FEATURE_CAPABILITY) as AiFeature[];
  const res: Record<string, boolean> = {};
  for (const f of feats) res[f] = (await candidates(f, 99, registryFor(f))).length > 0;
  return res;
}

/**
 * Run a metered AI text/vision operation:
 * authorize → reserve credits (locked, idempotent) → call providers in routing order with fallback
 * → record usage + provider cost → refund the reservation if every provider failed.
 */
export function runText<T>(ctx: AiContext, call: (adapter: TextAdapter, apiKey: string, model: string) => Promise<AdapterResult<T>>) {
  return runAi<TextAdapter, T>(ctx, textAdapters, call);
}

/** Adapter registry for a feature's capability: text models, voice, transcription or avatars. */
export function registryFor(feature: AiFeature): Record<string, any> {
  const cap = FEATURE_CAPABILITY[feature];
  if (cap === "TEXT_TO_SPEECH") return ttsAdapters;
  if (cap === "SPEECH_TO_TEXT") return sttAdapters;
  if (cap === "AVATAR_VIDEO") return avatarAdapters;
  return textAdapters;
}

/** The same metering pipeline for any adapter type. Cost = tokens × token price + units × unit price. */
export async function runAi<A, T>(
  ctx: AiContext,
  registry: Record<string, A>,
  call: (adapter: A, apiKey: string, model: string) => Promise<AdapterResult<T>>,
): Promise<{ output: T; usageId: string; creditsCharged: number; provider: string; model: string }> {
  // Idempotent replay: if this key already succeeded, refuse to re-run/charge.
  const duplicate = () => new HttpError(409, "duplicate_operation", "This AI operation was already processed.");
  const prior =
    (await prisma.aiUsageRecord.findUnique({ where: { idempotencyKey: ctx.idempotencyKey }, select: { id: true } })) ??
    (await prisma.aiCreditTransaction.findUnique({ where: { idempotencyKey: `usage:${ctx.idempotencyKey}:allowance` } })) ??
    (await prisma.aiCreditTransaction.findUnique({ where: { idempotencyKey: `usage:${ctx.idempotencyKey}:purchased` } }));
  if (prior) throw duplicate();

  const auth = await authorize(ctx);
  const cands = await candidates(ctx.feature, auth.planTier, registry);
  if (cands.length === 0) {
    await recordDenied(ctx, "no_provider", auth.planKey);
    throw notConfigured(`AI provider for ${ctx.feature}`, ["ANTHROPIC_API_KEY or another provider key", "enable a provider + routing rule in Admin → AI providers"]);
  }

  const usage = await prisma.aiUsageRecord.create({
    data: {
      idempotencyKey: ctx.idempotencyKey,
      sellerId: ctx.sellerId,
      userId: ctx.userId ?? null,
      planKey: auth.planKey,
      feature: ctx.feature,
      capability: FEATURE_CAPABILITY[ctx.feature],
      status: "PENDING",
      units: ctx.units ?? 1,
      streamId: ctx.streamId,
      productId: ctx.productId,
      scanId: ctx.scanId,
    },
  }).catch((e) => {
    // Two concurrent calls with one key: the loser sees the unique index.
    if (e?.code === "P2002") throw duplicate();
    throw e;
  });

  // Reserve credits atomically (allowance first, then purchased).
  if (ctx.sellerId && auth.credits > 0) {
    const sellerId = ctx.sellerId;
    await prisma.$transaction(async (tx) => {
      await lockSeller(tx, sellerId);
      const bal = await creditBalance(tx, sellerId);
      if (bal.total < auth.credits) throw paymentRequired("Insufficient credits", { reason: "insufficient_credits", needed: auth.credits, balance: bal.total });
      const fromAllowance = Math.min(Math.max(bal.allowance, 0), auth.credits);
      const fromPurchased = auth.credits - fromAllowance;
      if (fromAllowance > 0)
        await tx.aiCreditTransaction.create({ data: { sellerId, kind: "USAGE", bucket: "allowance", amount: -fromAllowance, usageRecordId: usage.id, idempotencyKey: `usage:${ctx.idempotencyKey}:allowance` } });
      if (fromPurchased > 0)
        await tx.aiCreditTransaction.create({ data: { sellerId, kind: "USAGE", bucket: "purchased", amount: -fromPurchased, usageRecordId: usage.id, idempotencyKey: `usage:${ctx.idempotencyKey}:purchased` } });
    });
  }

  const started = Date.now();
  let lastErr: unknown;
  for (const c of cands) {
    try {
      const r = await call(c.adapter, c.apiKey, c.modelId);
      const cost = BigInt(Math.round((r.inputTokens * c.inCost + r.outputTokens * c.outCost) / 1e6 + (ctx.units ?? 1) * c.unitCost));
      await prisma.aiUsageRecord.update({
        where: { id: usage.id },
        data: {
          status: "SUCCEEDED",
          providerKey: c.providerKey,
          modelId: c.modelId,
          inputTokens: r.inputTokens,
          outputTokens: r.outputTokens,
          providerCostMicros: cost,
          creditsCharged: auth.credits,
          latencyMs: Date.now() - started,
        },
      });
      if (ctx.sellerId) {
        const bal = await creditBalance(prisma, ctx.sellerId);
        emit(`seller:${ctx.sellerId}`, "credits:changed", bal);
      }
      return { output: r.output, usageId: usage.id, creditsCharged: auth.credits, provider: c.providerKey, model: c.modelId };
    } catch (e) {
      lastErr = e;
      // Non-retryable errors (bad request, refusal) are not retried on another provider.
      if (e instanceof ProviderError && !e.retryable) break;
    }
  }

  // All providers failed → refund the reservation in the ledger (never edit rows).
  if (ctx.sellerId && auth.credits > 0) {
    await prisma.aiCreditTransaction.createMany({
      data: (await prisma.aiCreditTransaction.findMany({ where: { usageRecordId: usage.id, kind: "USAGE" } })).map((t) => ({
        sellerId: t.sellerId,
        kind: "REFUND" as const,
        bucket: t.bucket,
        amount: -t.amount,
        usageRecordId: usage.id,
        idempotencyKey: `refund:${t.idempotencyKey}`,
        note: "AI operation failed",
      })),
      skipDuplicates: true,
    });
  }
  await prisma.aiUsageRecord.update({
    where: { id: usage.id },
    data: { status: "FAILED", denyReason: lastErr instanceof Error ? lastErr.message.slice(0, 500) : "unknown", latencyMs: Date.now() - started },
  });
  throw new HttpError(502, "ai_provider_failed", "The AI provider could not complete this request. You were not charged.");
}
