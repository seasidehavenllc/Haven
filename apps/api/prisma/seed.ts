/**
 * Seeds configuration only: categories, AI plans/prices/packs, AI providers/models/routing,
 * platform settings, and (optionally) the first admin. It creates NO products, sellers,
 * orders, reviews or usage — those must come from real activity.
 *
 * Provider list prices below were taken from the providers' published pricing at build time
 * (Nov 2026). Admins must keep them current in Admin → AI providers; cost accounting uses them.
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const categories = [
  ["clothing", "Clothing"], ["shoes", "Shoes"], ["electronics", "Electronics"], ["accessories", "Accessories"],
  ["toys", "Toys"], ["collectibles", "Collectibles"], ["home", "Home goods"], ["furniture", "Furniture"],
  ["tools", "Tools"], ["beauty", "Beauty"], ["sports", "Sporting goods"], ["general", "General merchandise"],
];

// 1 credit is sold at roughly $0.01 (see credit packs). Admin-editable.
const featurePrices = [
  ["PRODUCT_SCAN", 5, "scan"],
  ["LISTING_GENERATION", 2, "listing"],
  ["PRICE_SUGGESTION", 1, "suggestion"],
  ["SHOPPING_ASSISTANT", 0, "conversation"], // platform-paid for buyers
  ["COHOST_MINUTE", 4, "minute"],
  ["AI_HOST_MINUTE", 30, "minute"],
  ["TRANSCRIPTION_MINUTE", 2, "minute"],
  ["TTS_CHARACTERS", 3, "1k characters"],
  ["AVATAR_MINUTE", 25, "minute"],
] as const;

const plans = [
  { key: "starter", name: "Starter", tier: 0, monthlyPriceCents: 0, annualPriceCents: 0, monthlyCredits: 100, rolloverPercent: 0,
    features: ["PRODUCT_SCAN", "LISTING_GENERATION", "PRICE_SUGGESTION"], limits: { maxAiAgents: 0 } },
  { key: "pro", name: "Seller Pro", tier: 1, monthlyPriceCents: 2900, annualPriceCents: 29000, monthlyCredits: 2000, rolloverPercent: 0,
    features: ["PRODUCT_SCAN", "LISTING_GENERATION", "PRICE_SUGGESTION", "COHOST_MINUTE", "TRANSCRIPTION_MINUTE", "TTS_CHARACTERS"], limits: { maxAiAgents: 0, TTS_CHARACTERS: { perCallMaxUnits: 5 } } },
  { key: "business", name: "Business", tier: 2, monthlyPriceCents: 7900, annualPriceCents: 79000, monthlyCredits: 6000, rolloverPercent: 25,
    features: ["PRODUCT_SCAN", "LISTING_GENERATION", "PRICE_SUGGESTION", "COHOST_MINUTE", "TRANSCRIPTION_MINUTE", "TTS_CHARACTERS", "AI_HOST_MINUTE", "AVATAR_MINUTE"], limits: { maxAiAgents: 1, AI_HOST_MINUTE: { perCallMaxUnits: 60 } } },
  { key: "enterprise", name: "Enterprise", tier: 3, monthlyPriceCents: 19900, annualPriceCents: 199000, monthlyCredits: 18000, rolloverPercent: 50,
    features: ["PRODUCT_SCAN", "LISTING_GENERATION", "PRICE_SUGGESTION", "COHOST_MINUTE", "TRANSCRIPTION_MINUTE", "TTS_CHARACTERS", "AI_HOST_MINUTE", "AVATAR_MINUTE"], limits: { maxAiAgents: 5, AI_HOST_MINUTE: { perCallMaxUnits: 240 } } },
];

const packs = [
  { key: "credits-1k", name: "1,000 credits", credits: 1000, priceCents: 1000 },
  { key: "credits-5k", name: "5,000 credits", credits: 5000, priceCents: 4500 },
  { key: "credits-20k", name: "20,000 credits", credits: 20000, priceCents: 16000 },
];

// micro-dollars per million tokens
const anthropicModels = [
  { modelId: "claude-haiku-5-5", tier: "economy", in: 100_000, out: 500_000 },
  { modelId: "claude-sonnet-5-5", tier: "standard", in: 2_000_000, out: 10_000_000 },
  { modelId: "claude-opus-5-5", tier: "premium", in: 4_000_000, out: 20_000_000 },
];

async function main() {
  for (const [slug, name] of categories) await prisma.category.upsert({ where: { slug }, update: { name }, create: { slug, name } });
  for (const [feature, creditsPerUnit, unitName] of featurePrices)
    await prisma.aiFeaturePrice.upsert({ where: { feature }, update: {}, create: { feature, creditsPerUnit, unitName } });
  for (const p of plans) await prisma.aiPlan.upsert({ where: { key: p.key }, update: {}, create: p });
  for (const p of packs) await prisma.aiCreditPack.upsert({ where: { key: p.key }, update: {}, create: p });
  await prisma.platformSettings.upsert({
    where: { id: "global" },
    update: {},
    create: { id: "global", marketplaceFeeBps: 800, aiDailyBudgetMicros: 50_000_000n, aiMonthlyBudgetMicros: 1_000_000_000n },
  });

  const anthropic = await prisma.aiProvider.upsert({
    where: { key: "anthropic" },
    update: {},
    create: { key: "anthropic", name: "Anthropic (Claude)", adapter: "anthropic", credentialEnvVar: "ANTHROPIC_API_KEY", enabled: true, monthlySpendLimitMicros: 1_000_000_000n },
  });
  await prisma.aiProvider.upsert({
    where: { key: "openai" },
    update: {},
    create: { key: "openai", name: "OpenAI", adapter: "openai", credentialEnvVar: "OPENAI_API_KEY", enabled: false },
  });
  for (const [key, name, envVar] of [
    ["deepgram", "Deepgram (speech-to-text)", "DEEPGRAM_API_KEY"],
    ["elevenlabs", "ElevenLabs (voice)", "ELEVENLABS_API_KEY"],
    ["heygen", "HeyGen (avatars)", "HEYGEN_API_KEY"],
  ] as const)
    await prisma.aiProvider.upsert({ where: { key }, update: {}, create: { key, name, adapter: key, credentialEnvVar: envVar, enabled: false } });

  const model: Record<string, string> = {};
  for (const m of anthropicModels) {
    for (const capability of ["LLM_TEXT", "VISION_PRODUCT_ID", "LLM_AGENT"]) {
      const row = await prisma.aiProviderModel.upsert({
        where: { providerId_modelId_capability: { providerId: anthropic.id, modelId: m.modelId, capability } },
        update: {},
        create: { providerId: anthropic.id, modelId: m.modelId, capability, tier: m.tier, inputCostMicrosPerMTok: m.in, outputCostMicrosPerMTok: m.out },
      });
      model[`${m.modelId}:${capability}`] = row.id;
    }
  }

  if ((await prisma.aiRoutingRule.count()) === 0) {
    const r = (feature: string, ref: string, priority: number, minPlanTier = 0) => ({ feature, modelRefId: model[ref]!, priority, minPlanTier });
    await prisma.aiRoutingRule.createMany({
      data: [
        // Paid plans get the stronger vision model first; everyone can fall back to the economy model.
        r("PRODUCT_SCAN", "claude-sonnet-5-5:VISION_PRODUCT_ID", 10, 1),
        r("PRODUCT_SCAN", "claude-haiku-5-5:VISION_PRODUCT_ID", 20, 0),
        r("LISTING_GENERATION", "claude-haiku-5-5:LLM_TEXT", 10),
        r("PRICE_SUGGESTION", "claude-haiku-5-5:LLM_TEXT", 10),
        r("SHOPPING_ASSISTANT", "claude-haiku-5-5:LLM_TEXT", 10),
        r("COHOST_MINUTE", "claude-sonnet-5-5:LLM_AGENT", 10, 1),
        r("COHOST_MINUTE", "claude-haiku-5-5:LLM_AGENT", 20, 1),
        r("AI_HOST_MINUTE", "claude-opus-5-5:LLM_AGENT", 5, 3),
        r("AI_HOST_MINUTE", "claude-sonnet-5-5:LLM_AGENT", 10, 2),
      ],
    });
  }

  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  if (email && password) {
    await prisma.user.upsert({
      where: { email: email.toLowerCase() },
      update: { roles: ["BUYER", "ADMIN"] },
      create: { email: email.toLowerCase(), handle: "admin", displayName: "Platform Admin", passwordHash: await bcrypt.hash(password, 12), roles: ["BUYER", "ADMIN"] },
    });
    console.log(`Admin ready: ${email}`);
  } else console.log("Set ADMIN_EMAIL and ADMIN_PASSWORD to create the first admin.");
  console.log("Seed complete (configuration only).");
}

main().finally(() => prisma.$disconnect());
