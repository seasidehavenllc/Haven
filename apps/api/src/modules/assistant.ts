import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { requireUser } from "../lib/auth";
import { parse } from "../lib/validate";
import { runText } from "../ai/gateway";
import { productInclude } from "./catalog";

const INTENT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["keywords", "maxPriceCents", "minPriceCents", "categorySlug", "liveOnly", "inStockOnly"],
  properties: {
    keywords: { type: "array", items: { type: "string" } },
    maxPriceCents: { anyOf: [{ type: "integer" }, { type: "null" }] },
    minPriceCents: { anyOf: [{ type: "integer" }, { type: "null" }] },
    categorySlug: { anyOf: [{ type: "string" }, { type: "null" }] },
    liveOnly: { type: "boolean" },
    inStockOnly: { type: "boolean" },
  },
};
type Intent = { keywords: string[]; maxPriceCents: number | null; minPriceCents: number | null; categorySlug: string | null; liveOnly: boolean; inStockOnly: boolean };

/**
 * Buyer shopping assistant. Two AI steps around a real database search:
 *  1) turn the question into search filters, 2) explain ONLY the products the search returned.
 * Product cards in the response come straight from the database, not from the model.
 */
export async function assistantRoutes(app: FastifyInstance) {
  app.post("/assistant", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req) => {
    const u = requireUser(req);
    const { message } = parse(z.object({ message: z.string().min(2).max(800) }), req.body);
    const cats = await prisma.category.findMany({ select: { slug: true } });
    const op = randomUUID();

    const intent = await runText<Intent>(
      { sellerId: null, userId: u.id, feature: "SHOPPING_ASSISTANT", idempotencyKey: `asst:${op}:intent` },
      (a, key, model) =>
        a.structured<Intent>(key, {
          model,
          system: `Convert a shopper's request into marketplace search filters. Category slugs: ${cats.map((c) => c.slug).join(", ")}. Prices in US cents. Use 1-4 short keywords.`,
          prompt: message,
          schema: INTENT_SCHEMA,
          effort: "low",
          maxTokens: 2000,
        }),
    );
    const f = intent.output;
    const where: Prisma.ProductWhereInput = { status: "ACTIVE", seller: { status: "APPROVED" } };
    if (f.keywords.length)
      where.OR = f.keywords.flatMap((k) => [{ title: { contains: k, mode: "insensitive" as const } }, { description: { contains: k, mode: "insensitive" as const } }, { tags: { has: k.toLowerCase() } }]);
    if (f.categorySlug) where.category = { slug: f.categorySlug };
    const vf: Prisma.ProductVariantWhereInput = {};
    if (f.maxPriceCents != null || f.minPriceCents != null) vf.priceCents = { ...(f.minPriceCents != null ? { gte: f.minPriceCents } : {}), ...(f.maxPriceCents != null ? { lte: f.maxPriceCents } : {}) };
    if (f.inStockOnly) vf.quantity = { gt: 0 };
    if (Object.keys(vf).length) where.variants = { some: vf };
    if (f.liveOnly) where.streamProducts = { some: { hidden: false, stream: { status: "LIVE" } } };
    const products = await prisma.product.findMany({ where, include: productInclude, take: 8, orderBy: { createdAt: "desc" } });

    if (!products.length) {
      return { reply: "I couldn't find anything on the marketplace matching that right now. Try different words or a wider price range.", products: [], filters: f };
    }
    const facts = products.map((p) => ({
      id: p.id,
      title: p.title,
      store: p.seller.storefront?.name,
      condition: p.condition,
      prices: p.variants.map((v) => ({ variant: v.name, price: `$${(v.priceCents / 100).toFixed(2)}`, inStock: v.quantity })),
      description: p.description.slice(0, 400),
    }));
    const answer = await runText<string>(
      { sellerId: null, userId: u.id, feature: "SHOPPING_ASSISTANT", idempotencyKey: `asst:${op}:answer` },
      (a, key, model) =>
        a.chat(key, {
          model,
          system:
            "You are a marketplace shopping assistant. Recommend ONLY products from the provided list, by exact title. Use only the prices, stock and details given. Never invent products, reviews, discounts or shipping promises. 2-5 sentences.",
          messages: [{ role: "user", content: `PRODUCTS:\n${JSON.stringify(facts)}\n\nSHOPPER: ${message}` }],
          maxTokens: 1500,
        }),
    );
    return { reply: answer.output, products, filters: f };
  });
}
