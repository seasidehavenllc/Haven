import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AiCapabilities, AiFeatures } from "@haven/shared";
import { prisma } from "../db";
import { requireAdmin } from "../lib/auth";
import { badRequest, notFound } from "../lib/errors";
import { parse } from "../lib/validate";
import { audit } from "../lib/audit";
import { textAdapters } from "../ai/adapters";
import { avatarAdapters, sttAdapters, ttsAdapters } from "../ai/voice";
import { notify, createNotifications, deliver } from "../notify";

const micros = (v: bigint | null | undefined) => Number(v ?? 0n) / 1e6;

export async function adminRoutes(app: FastifyInstance) {
  // ── Platform settings / kill switch ──
  app.get("/admin/settings", async (req) => {
    await requireAdmin(req);
    const s = await prisma.platformSettings.upsert({ where: { id: "global" }, update: {}, create: { id: "global" } });
    return { ...s, aiDailyBudgetUsd: s.aiDailyBudgetMicros ? micros(s.aiDailyBudgetMicros) : null, aiMonthlyBudgetUsd: s.aiMonthlyBudgetMicros ? micros(s.aiMonthlyBudgetMicros) : null, aiDailyBudgetMicros: undefined, aiMonthlyBudgetMicros: undefined };
  });

  app.patch("/admin/settings", async (req) => {
    const admin = await requireAdmin(req);
    const b = parse(
      z.object({
        aiEmergencyDisabled: z.boolean().optional(),
        aiDailyBudgetUsd: z.number().min(0).nullable().optional(),
        aiMonthlyBudgetUsd: z.number().min(0).nullable().optional(),
        marketplaceFeeBps: z.number().int().min(0).max(5000).optional(),
      }),
      req.body,
    );
    const data: Record<string, unknown> = {};
    if (b.aiEmergencyDisabled !== undefined) data.aiEmergencyDisabled = b.aiEmergencyDisabled;
    if (b.marketplaceFeeBps !== undefined) data.marketplaceFeeBps = b.marketplaceFeeBps;
    if (b.aiDailyBudgetUsd !== undefined) data.aiDailyBudgetMicros = b.aiDailyBudgetUsd == null ? null : BigInt(Math.round(b.aiDailyBudgetUsd * 1e6));
    if (b.aiMonthlyBudgetUsd !== undefined) data.aiMonthlyBudgetMicros = b.aiMonthlyBudgetUsd == null ? null : BigInt(Math.round(b.aiMonthlyBudgetUsd * 1e6));
    await prisma.platformSettings.upsert({ where: { id: "global" }, update: data, create: { id: "global", ...data } });
    await audit(prisma, { actorId: admin.id, action: "admin.settings.update", data: b, ip: req.ip });
    return { ok: true };
  });

  // ── AI providers ──
  app.get("/admin/ai/providers", async (req) => {
    await requireAdmin(req);
    const providers = await prisma.aiProvider.findMany({ include: { models: true }, orderBy: { name: "asc" } });
    const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
    const stats = await prisma.aiUsageRecord.groupBy({ by: ["providerKey", "status"], where: { createdAt: { gte: monthStart }, providerKey: { not: null } }, _count: true, _sum: { providerCostMicros: true }, _avg: { latencyMs: true } });
    return providers.map((p) => {
      const mine = stats.filter((s) => s.providerKey === p.key);
      const ok = mine.find((s) => s.status === "SUCCEEDED");
      const failed = mine.find((s) => s.status === "FAILED");
      return {
        ...p,
        monthlySpendLimitUsd: p.monthlySpendLimitMicros ? micros(p.monthlySpendLimitMicros) : null,
        monthlySpendLimitMicros: undefined,
        // Only whether the secret is present — never its value.
        credentialConfigured: !!process.env[p.credentialEnvVar],
        adapterAvailable: !!(textAdapters[p.adapter] ?? ttsAdapters[p.adapter] ?? sttAdapters[p.adapter] ?? avatarAdapters[p.adapter]),
        month: { calls: ok?._count ?? 0, failures: failed?._count ?? 0, costUsd: micros(ok?._sum.providerCostMicros), avgLatencyMs: ok?._avg.latencyMs ?? null },
      };
    });
  });

  const ProviderInput = z.object({
    key: z.string().regex(/^[a-z0-9-]+$/),
    name: z.string().min(2),
    adapter: z.string(),
    credentialEnvVar: z.string().regex(/^[A-Z][A-Z0-9_]+$/, "Use the NAME of an environment variable, not the key itself"),
    enabled: z.boolean().default(false),
    monthlySpendLimitUsd: z.number().min(0).nullable().optional(),
  });
  app.post("/admin/ai/providers", async (req) => {
    const admin = await requireAdmin(req);
    const b = parse(ProviderInput, req.body);
    const { monthlySpendLimitUsd, ...rest } = b;
    const p = await prisma.aiProvider.create({ data: { ...rest, monthlySpendLimitMicros: monthlySpendLimitUsd == null ? null : BigInt(Math.round(monthlySpendLimitUsd * 1e6)) } });
    await audit(prisma, { actorId: admin.id, action: "admin.ai.provider.create", targetType: "aiProvider", targetId: p.id, data: rest });
    return p;
  });
  app.patch("/admin/ai/providers/:id", async (req) => {
    const admin = await requireAdmin(req);
    const b = parse(ProviderInput.partial(), req.body);
    const { monthlySpendLimitUsd, ...rest } = b;
    const p = await prisma.aiProvider.update({
      where: { id: (req.params as { id: string }).id },
      data: { ...rest, ...(monthlySpendLimitUsd !== undefined ? { monthlySpendLimitMicros: monthlySpendLimitUsd == null ? null : BigInt(Math.round(monthlySpendLimitUsd * 1e6)) } : {}) },
    });
    await audit(prisma, { actorId: admin.id, action: "admin.ai.provider.update", targetType: "aiProvider", targetId: p.id, data: b });
    return { ...p, monthlySpendLimitMicros: undefined };
  });

  const ModelInput = z.object({
    providerId: z.string(),
    modelId: z.string().min(1),
    capability: z.enum(AiCapabilities),
    tier: z.enum(["economy", "standard", "premium"]).default("standard"),
    enabled: z.boolean().default(true),
    inputCostMicrosPerMTok: z.number().int().min(0).default(0),
    outputCostMicrosPerMTok: z.number().int().min(0).default(0),
    unitCostMicros: z.number().int().min(0).default(0),
    unitName: z.string().optional(),
  });
  app.post("/admin/ai/models", async (req) => {
    const admin = await requireAdmin(req);
    const m = await prisma.aiProviderModel.create({ data: parse(ModelInput, req.body) });
    await audit(prisma, { actorId: admin.id, action: "admin.ai.model.create", targetId: m.id });
    return m;
  });
  app.patch("/admin/ai/models/:id", async (req) => {
    const admin = await requireAdmin(req);
    const m = await prisma.aiProviderModel.update({ where: { id: (req.params as { id: string }).id }, data: parse(ModelInput.partial(), req.body) });
    await audit(prisma, { actorId: admin.id, action: "admin.ai.model.update", targetId: m.id });
    return m;
  });

  // ── Routing ──
  app.get("/admin/ai/routing", async (req) => {
    await requireAdmin(req);
    const rules = await prisma.aiRoutingRule.findMany({ orderBy: [{ feature: "asc" }, { priority: "asc" }] });
    const models = await prisma.aiProviderModel.findMany({ include: { provider: { select: { key: true, enabled: true } } } });
    return rules.map((r) => ({ ...r, model: models.find((m) => m.id === r.modelRefId) ?? null }));
  });
  const RuleInput = z.object({ feature: z.enum(AiFeatures), modelRefId: z.string(), priority: z.number().int().default(100), minPlanTier: z.number().int().min(0).default(0), enabled: z.boolean().default(true) });
  app.post("/admin/ai/routing", async (req) => {
    const admin = await requireAdmin(req);
    const b = parse(RuleInput, req.body);
    if (!(await prisma.aiProviderModel.findUnique({ where: { id: b.modelRefId } }))) throw badRequest("Unknown model");
    const r = await prisma.aiRoutingRule.create({ data: b });
    await audit(prisma, { actorId: admin.id, action: "admin.ai.routing.create", targetId: r.id, data: b });
    return r;
  });
  app.patch("/admin/ai/routing/:id", async (req) => {
    const admin = await requireAdmin(req);
    const r = await prisma.aiRoutingRule.update({ where: { id: (req.params as { id: string }).id }, data: parse(RuleInput.partial(), req.body) });
    await audit(prisma, { actorId: admin.id, action: "admin.ai.routing.update", targetId: r.id });
    return r;
  });
  app.delete("/admin/ai/routing/:id", async (req) => {
    const admin = await requireAdmin(req);
    await prisma.aiRoutingRule.delete({ where: { id: (req.params as { id: string }).id } });
    await audit(prisma, { actorId: admin.id, action: "admin.ai.routing.delete", targetId: (req.params as { id: string }).id });
    return { ok: true };
  });

  // ── Plans, feature prices, credit packs ──
  const PlanInput = z.object({
    key: z.string().regex(/^[a-z0-9-]+$/),
    name: z.string(),
    tier: z.number().int().min(0).max(9),
    monthlyPriceCents: z.number().int().min(0),
    annualPriceCents: z.number().int().min(0).nullable().optional(),
    monthlyCredits: z.number().int().min(0),
    rolloverPercent: z.number().int().min(0).max(100).default(0),
    features: z.array(z.enum(AiFeatures)),
    limits: z.record(z.any()).default({}),
    active: z.boolean().default(true),
  });
  app.get("/admin/ai/plans", async (req) => {
    await requireAdmin(req);
    return {
      plans: await prisma.aiPlan.findMany({ orderBy: { tier: "asc" }, include: { _count: { select: { subscriptions: true } } } }),
      featurePrices: await prisma.aiFeaturePrice.findMany(),
      creditPacks: await prisma.aiCreditPack.findMany(),
    };
  });
  app.post("/admin/ai/plans", async (req) => {
    const admin = await requireAdmin(req);
    const p = await prisma.aiPlan.create({ data: parse(PlanInput, req.body) });
    await audit(prisma, { actorId: admin.id, action: "admin.ai.plan.create", targetId: p.id });
    return p;
  });
  app.patch("/admin/ai/plans/:id", async (req) => {
    const admin = await requireAdmin(req);
    const b = parse(PlanInput.partial(), req.body);
    const p = await prisma.aiPlan.update({ where: { id: (req.params as { id: string }).id }, data: b });
    await audit(prisma, { actorId: admin.id, action: "admin.ai.plan.update", targetId: p.id, data: b });
    return p;
  });
  app.put("/admin/ai/feature-prices/:feature", async (req) => {
    const admin = await requireAdmin(req);
    const feature = z.enum(AiFeatures).parse((req.params as { feature: string }).feature);
    const b = parse(z.object({ creditsPerUnit: z.number().int().min(0), unitName: z.string() }), req.body);
    const r = await prisma.aiFeaturePrice.upsert({ where: { feature }, update: b, create: { feature, ...b } });
    await audit(prisma, { actorId: admin.id, action: "admin.ai.feature_price.update", targetId: feature, data: b });
    return r;
  });
  app.put("/admin/ai/credit-packs/:key", async (req) => {
    const admin = await requireAdmin(req);
    const key = (req.params as { key: string }).key;
    const b = parse(z.object({ name: z.string(), credits: z.number().int().positive(), priceCents: z.number().int().positive(), active: z.boolean().default(true) }), req.body);
    const r = await prisma.aiCreditPack.upsert({ where: { key }, update: b, create: { key, ...b } });
    await audit(prisma, { actorId: admin.id, action: "admin.ai.credit_pack.update", targetId: key, data: b });
    return r;
  });

  // ── Profitability (real records only; test charges excluded unless includeTest=true) ──
  app.get("/admin/ai/profitability", async (req) => {
    await requireAdmin(req);
    const q = parse(
      z.object({ from: z.string().datetime().optional(), to: z.string().datetime().optional(), includeTest: z.coerce.boolean().default(false), sellerId: z.string().optional(), provider: z.string().optional(), feature: z.string().optional(), plan: z.string().optional() }),
      req.query,
    );
    const to = q.to ? new Date(q.to) : new Date();
    const from = q.from ? new Date(q.from) : new Date(to.getTime() - 30 * 864e5);
    const usageWhere = {
      createdAt: { gte: from, lte: to },
      ...(q.sellerId ? { sellerId: q.sellerId } : {}),
      ...(q.provider ? { providerKey: q.provider } : {}),
      ...(q.feature ? { feature: q.feature } : {}),
      ...(q.plan ? { planKey: q.plan } : {}),
    };
    const chargeWhere = { createdAt: { gte: from, lte: to }, status: "SUCCEEDED", ...(q.includeTest ? {} : { isTest: false }), ...(q.sellerId ? { sellerId: q.sellerId } : {}), ...(q.plan ? { planKey: q.plan } : {}) };
    const [revenue, revenueByKind, revenueByPlan, cost, byFeature, byProvider, byPlan, bySeller, statusCounts, creditFlows] = await Promise.all([
      prisma.aiBillingCharge.aggregate({ where: chargeWhere, _sum: { amountCents: true }, _count: true }),
      prisma.aiBillingCharge.groupBy({ by: ["kind"], where: chargeWhere, _sum: { amountCents: true }, _count: true }),
      prisma.aiBillingCharge.groupBy({ by: ["planKey"], where: { ...chargeWhere, kind: "SUBSCRIPTION" }, _sum: { amountCents: true } }),
      prisma.aiUsageRecord.aggregate({ where: { ...usageWhere, status: "SUCCEEDED" }, _sum: { providerCostMicros: true, creditsCharged: true }, _count: true }),
      prisma.aiUsageRecord.groupBy({ by: ["feature"], where: { ...usageWhere, status: "SUCCEEDED" }, _sum: { providerCostMicros: true, creditsCharged: true, units: true }, _count: true }),
      prisma.aiUsageRecord.groupBy({ by: ["providerKey", "modelId"], where: { ...usageWhere, status: "SUCCEEDED" }, _sum: { providerCostMicros: true, inputTokens: true, outputTokens: true }, _count: true }),
      prisma.aiUsageRecord.groupBy({ by: ["planKey"], where: { ...usageWhere, status: "SUCCEEDED" }, _sum: { providerCostMicros: true, creditsCharged: true }, _count: true }),
      prisma.aiUsageRecord.groupBy({ by: ["sellerId"], where: { ...usageWhere, status: "SUCCEEDED" }, _sum: { providerCostMicros: true, creditsCharged: true }, _count: true, orderBy: { _sum: { providerCostMicros: "desc" } }, take: 20 }),
      prisma.aiUsageRecord.groupBy({ by: ["status", "denyReason"], where: usageWhere, _count: true }),
      prisma.aiCreditTransaction.groupBy({ by: ["kind"], where: { createdAt: { gte: from, lte: to }, ...(q.sellerId ? { sellerId: q.sellerId } : {}) }, _sum: { amount: true } }),
    ]);
    const revenueCents = revenue._sum.amountCents ?? 0;
    const costUsd = micros(cost._sum.providerCostMicros);
    const per = (feature: string) => {
      const f = byFeature.find((x) => x.feature === feature);
      return f && f._count ? micros(f._sum.providerCostMicros) / f._count : null;
    };
    const minutes = (feature: string) => byFeature.find((x) => x.feature === feature)?._sum.units ?? 0;
    const hostMin = minutes("AI_HOST_MINUTE");
    const sellers = await prisma.sellerAccount.findMany({ where: { id: { in: bySeller.map((s) => s.sellerId!).filter(Boolean) } }, select: { id: true, businessName: true } });

    // Simple anomaly flag: sellers whose cost in the window is > 5x the median seller cost.
    const costs = bySeller.map((s) => micros(s._sum.providerCostMicros)).sort((a, b) => a - b);
    const median = costs.length ? costs[Math.floor(costs.length / 2)]! : 0;

    return {
      window: { from, to, includeTest: q.includeTest },
      totals: {
        revenueUsd: revenueCents / 100,
        providerCostUsd: costUsd,
        grossMarginUsd: revenueCents / 100 - costUsd,
        grossMarginPct: revenueCents > 0 ? (1 - costUsd / (revenueCents / 100)) * 100 : null,
        operations: cost._count,
        creditsConsumed: cost._sum.creditsCharged ?? 0,
      },
      revenueByKind: revenueByKind.map((r) => ({ kind: r.kind, usd: (r._sum.amountCents ?? 0) / 100, count: r._count })),
      revenueByPlan: revenueByPlan.map((r) => ({ plan: r.planKey, usd: (r._sum.amountCents ?? 0) / 100 })),
      costByPlan: byPlan.map((r) => ({ plan: r.planKey, costUsd: micros(r._sum.providerCostMicros), credits: r._sum.creditsCharged ?? 0, ops: r._count })),
      costByFeature: byFeature.map((r) => ({ feature: r.feature, costUsd: micros(r._sum.providerCostMicros), credits: r._sum.creditsCharged ?? 0, ops: r._count, units: r._sum.units ?? 0 })),
      costByProvider: byProvider.map((r) => ({ provider: r.providerKey, model: r.modelId, costUsd: micros(r._sum.providerCostMicros), ops: r._count, inputTokens: r._sum.inputTokens ?? 0, outputTokens: r._sum.outputTokens ?? 0 })),
      topSellers: bySeller.map((r) => ({ sellerId: r.sellerId, name: sellers.find((s) => s.id === r.sellerId)?.businessName ?? null, costUsd: micros(r._sum.providerCostMicros), credits: r._sum.creditsCharged ?? 0, ops: r._count, anomalous: median > 0 && micros(r._sum.providerCostMicros) > median * 5 })),
      averages: {
        costPerProductScanUsd: per("PRODUCT_SCAN"),
        costPerAssistantConversationUsd: per("SHOPPING_ASSISTANT"),
        costPerCohostCallUsd: per("COHOST_MINUTE"),
        costPerAiHostMinuteUsd: hostMin ? micros(byFeature.find((x) => x.feature === "AI_HOST_MINUTE")?._sum.providerCostMicros) / hostMin : null,
      },
      credits: Object.fromEntries(creditFlows.map((c) => [c.kind, c._sum.amount ?? 0])),
      statusCounts: statusCounts.map((s) => ({ status: s.status, reason: s.denyReason, count: s._count })),
    };
  });

  app.get("/admin/ai/usage", async (req) => {
    await requireAdmin(req);
    const { cursor, sellerId } = req.query as { cursor?: string; sellerId?: string };
    const rows = await prisma.aiUsageRecord.findMany({ where: sellerId ? { sellerId } : {}, orderBy: { createdAt: "desc" }, take: 100, ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}) });
    return rows.map((r) => ({ ...r, providerCostUsd: micros(r.providerCostMicros), providerCostMicros: undefined }));
  });

  // ── Users, sellers, moderation ──
  app.get("/admin/users", async (req) => {
    await requireAdmin(req);
    const { q } = req.query as { q?: string };
    return prisma.user.findMany({
      where: q ? { OR: [{ email: { contains: q, mode: "insensitive" } }, { handle: { contains: q, mode: "insensitive" } }] } : {},
      select: { id: true, email: true, handle: true, displayName: true, roles: true, status: true, createdAt: true, seller: { select: { id: true, businessName: true, status: true } } },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
  });
  app.patch("/admin/users/:id", async (req) => {
    const admin = await requireAdmin(req);
    const { id } = req.params as { id: string };
    if (id === admin.id) throw badRequest("You can't change your own admin account here");
    const b = parse(z.object({ status: z.enum(["ACTIVE", "SUSPENDED", "BANNED"]) }), req.body);
    const u = await prisma.user.update({ where: { id }, data: b });
    if (b.status !== "ACTIVE") await prisma.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
    await audit(prisma, { actorId: admin.id, action: "admin.user.status", targetType: "user", targetId: id, data: b, ip: req.ip });
    return { id: u.id, status: u.status };
  });
  app.patch("/admin/sellers/:id", async (req) => {
    const admin = await requireAdmin(req);
    const b = parse(z.object({ status: z.enum(["PENDING_REVIEW", "APPROVED", "REJECTED", "SUSPENDED"]).optional(), aiDisabled: z.boolean().optional() }), req.body);
    const s = await prisma.sellerAccount.update({ where: { id: (req.params as { id: string }).id }, data: b });
    await audit(prisma, { actorId: admin.id, action: "admin.seller.update", targetType: "seller", targetId: s.id, data: b, ip: req.ip });
    return s;
  });
  app.post("/admin/products/:id/remove", async (req) => {
    const admin = await requireAdmin(req);
    const { reason } = parse(z.object({ reason: z.string().min(3).max(500) }), req.body);
    const p = await prisma.product.findUnique({ where: { id: (req.params as { id: string }).id }, include: { seller: true } });
    if (!p) throw notFound("Product");
    await prisma.product.update({ where: { id: p.id }, data: { status: "REMOVED" } });
    await notify({ userId: p.seller.userId, type: "moderation.product_removed", title: "A listing was removed", body: `${p.title}: ${reason}` });
    await audit(prisma, { actorId: admin.id, action: "admin.product.remove", targetType: "product", targetId: p.id, data: { reason }, ip: req.ip });
    return { ok: true };
  });
  app.get("/admin/overview", async (req) => {
    await requireAdmin(req);
    const [users, sellers, products, liveStreams, orders, gmv, openReports] = await Promise.all([
      prisma.user.count(),
      prisma.sellerAccount.count(),
      prisma.product.count({ where: { status: "ACTIVE" } }),
      prisma.livestream.count({ where: { status: "LIVE" } }),
      prisma.order.count({ where: { status: { notIn: ["CANCELLED", "PENDING_PAYMENT"] }, isTest: false } }),
      prisma.order.aggregate({ where: { status: { notIn: ["CANCELLED", "PENDING_PAYMENT", "REFUNDED"] }, isTest: false }, _sum: { totalCents: true, platformFeeCents: true } }),
      prisma.report.count({ where: { status: "OPEN" } }),
    ]);
    return { users, sellers, products, liveStreams, orders, gmvUsd: (gmv._sum.totalCents ?? 0) / 100, marketplaceFeesUsd: (gmv._sum.platformFeeCents ?? 0) / 100, openReports, note: "Excludes orders paid with the test payment provider." };
  });
  app.get("/admin/audit", async (req) => {
    await requireAdmin(req);
    return prisma.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 200, include: { actor: { select: { handle: true } } } });
  });
  app.get("/admin/reports", async (req) => {
    await requireAdmin(req);
    return prisma.report.findMany({ where: { status: "OPEN" }, orderBy: { createdAt: "desc" }, take: 100 });
  });
}
