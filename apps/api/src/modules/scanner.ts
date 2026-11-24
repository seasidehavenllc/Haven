import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { PublishDraftInput } from "@haven/shared";
import { prisma } from "../db";
import { requireSeller } from "../lib/auth";
import { badRequest, conflict, notFound } from "../lib/errors";
import { parse } from "../lib/validate";
import { storeUpload } from "../storage";
import { runText } from "../ai/gateway";
import { lookupBarcode } from "./barcode";
import { emit } from "../realtime";

const nullableStr = { anyOf: [{ type: "string" }, { type: "null" }] };
const confField = (valueSchema: object) => ({
  type: "object",
  additionalProperties: false,
  required: ["value", "confidence"],
  properties: { value: valueSchema, confidence: { type: "string", enum: ["high", "medium", "low"] } },
});

export const SCAN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["productType", "title", "description", "categorySlug", "brand", "model", "condition", "attributes", "tags", "variantHints", "questionsForSeller", "price"],
  properties: {
    productType: { type: "string" },
    title: { type: "string" },
    description: { type: "string" },
    categorySlug: nullableStr,
    brand: confField(nullableStr),
    model: confField(nullableStr),
    condition: {
      type: "object",
      additionalProperties: false,
      required: ["value", "confidence", "notes"],
      properties: {
        value: { anyOf: [{ type: "string", enum: ["NEW", "LIKE_NEW", "GOOD", "FAIR", "POOR", "REFURBISHED"] }, { type: "null" }] },
        confidence: { type: "string", enum: ["high", "medium", "low"] },
        notes: { type: "string" },
      },
    },
    attributes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "value", "confidence"],
        properties: { name: { type: "string" }, value: { type: "string" }, confidence: { type: "string", enum: ["high", "medium", "low"] } },
      },
    },
    tags: { type: "array", items: { type: "string" } },
    variantHints: { type: "array", items: { type: "string" } },
    questionsForSeller: { type: "array", items: { type: "string" } },
    price: {
      anyOf: [
        { type: "null" },
        {
          type: "object",
          additionalProperties: false,
          required: ["lowCents", "highCents", "suggestedCents", "basis"],
          properties: { lowCents: { type: "integer" }, highCents: { type: "integer" }, suggestedCents: { type: "integer" }, basis: { type: "string" } },
        },
      ],
    },
  },
} as const;

export interface ScanResult {
  productType: string;
  title: string;
  description: string;
  categorySlug: string | null;
  brand: { value: string | null; confidence: string };
  model: { value: string | null; confidence: string };
  condition: { value: string | null; confidence: string; notes: string };
  attributes: { name: string; value: string; confidence: string }[];
  tags: string[];
  variantHints: string[];
  questionsForSeller: string[];
  price: { lowCents: number; highCents: number; suggestedCents: number; basis: string } | null;
}

export const SCAN_SYSTEM = `You create marketplace listings from seller photos.
Rules you must follow:
- Describe only what is visible in the photos or stated in the provided data. Never invent a brand, model, material, size, condition, or specification.
- Set brand/model to null unless a logo, label, or model number is clearly legible (or provided barcode data states it). Use confidence "low" whenever you are guessing.
- Condition: judge only from visible wear. If photos are insufficient, set value null and ask the seller.
- Put anything uncertain the seller must confirm (size, material, authenticity, working condition, included accessories) in questionsForSeller.
- Price: only suggest a range when comparable data is provided or the item type has a well-known typical resale range; explain the basis in one sentence and call it an estimate. Otherwise return null.
- categorySlug must be one of the provided category slugs, or null.
- Title under 80 characters, no hype words, no ALL CAPS. Description: 2 short paragraphs + a bullet list of visible features.`;

async function comparables(categorySlug: string | null, brand: string | null) {
  if (!categorySlug && !brand) return null;
  const rows = await prisma.productVariant.findMany({
    where: { product: { status: "ACTIVE", ...(categorySlug ? { category: { slug: categorySlug } } : {}), ...(brand ? { brand: { equals: brand, mode: "insensitive" } } : {}) } },
    select: { priceCents: true },
    take: 200,
  });
  if (rows.length < 3) return null;
  const p = rows.map((r) => r.priceCents).sort((a, b) => a - b);
  return { count: p.length, p25: p[Math.floor(p.length * 0.25)]!, median: p[Math.floor(p.length / 2)]!, p75: p[Math.floor(p.length * 0.75)]! };
}

/** Analyze one scan (images already stored). Charges PRODUCT_SCAN credits via the AI gateway. */
export async function analyzeScan(scanId: string, images: { mime: string; bytes: Buffer }[], userId: string, sellerSaid?: string) {
  const scan = await prisma.productScan.findUniqueOrThrow({ where: { id: scanId } });
  await prisma.productScan.update({ where: { id: scanId }, data: { status: "ANALYZING" } });
  try {
    const cats = await prisma.category.findMany({ select: { slug: true, name: true } });
    const barcodeInfo = scan.barcode ? await lookupBarcode(scan.barcode) : null;
    const prompt = [
      `Category slugs: ${cats.map((c) => c.slug).join(", ")}`,
      barcodeInfo?.found ? `Barcode ${scan.barcode} database match (seller must confirm it is the same item): ${JSON.stringify(barcodeInfo.item)}` : scan.barcode ? `Barcode ${scan.barcode}: no database match available.` : "",
      sellerSaid ? `The seller described it live as: "${sellerSaid.slice(0, 500)}". Treat this as the seller's own statement (it may name the brand, size or condition); don't add anything beyond it and the photos.` : "",
      `There are ${images.length} photo(s). Produce the listing JSON.`,
    ].filter(Boolean).join("\n");

    const first = await runText<ScanResult>(
      { sellerId: scan.sellerId, userId, feature: "PRODUCT_SCAN", scanId, idempotencyKey: `scan:${scanId}` },
      (a, key, model) => a.structured<ScanResult>(key, { model, system: SCAN_SYSTEM, prompt, images: images.map((i) => ({ mime: i.mime, base64: i.bytes.toString("base64") })), schema: SCAN_SCHEMA as any, effort: "low" }),
    );
    const r = first.output;
    // Ground price suggestion in our own marketplace comparables when they exist.
    const comps = await comparables(r.categorySlug, r.brand.confidence === "high" ? r.brand.value : null);
    if (comps) {
      r.price = { lowCents: comps.p25, highCents: comps.p75, suggestedCents: comps.median, basis: `Estimate from ${comps.count} comparable active listings on this marketplace (median ${(comps.median / 100).toFixed(2)}). Not a verified market value.` };
    } else if (r.price) {
      r.price.basis = `AI estimate, not a verified market value: ${r.price.basis}`;
    }
    const category = r.categorySlug ? await prisma.category.findUnique({ where: { slug: r.categorySlug } }) : null;
    const draft = {
      title: r.title,
      description: r.description,
      categoryId: category?.id ?? null,
      brand: r.brand.confidence === "high" ? r.brand.value : null,
      model: r.model.confidence === "high" ? r.model.value : null,
      condition: r.condition.value,
      tags: r.tags.slice(0, 20).map((t) => t.toLowerCase()),
      priceCents: null, // seller must enter/confirm; suggestion lives in result.price
      quantity: 1,
    };
    const updated = await prisma.productScan.update({
      where: { id: scanId },
      data: { status: "READY", result: { ...r, barcode: barcodeInfo, ai: { provider: first.provider, model: first.model, credits: first.creditsCharged } } as any, draft },
    });
    emit(`seller:${scan.sellerId}`, "scan:updated", { id: scanId, status: "READY" });
    return updated;
  } catch (e: any) {
    const updated = await prisma.productScan.update({ where: { id: scanId }, data: { status: "FAILED", error: e?.message?.slice(0, 500) ?? "failed" } });
    emit(`seller:${scan.sellerId}`, "scan:updated", { id: scanId, status: "FAILED" });
    if (e?.status === 402 || e?.status === 503) throw e;
    return updated;
  }
}

/** Add a newly published product to the seller's upcoming/active streams' menus. */
export async function addToLiveMenus(sellerId: string, productId: string) {
  const streams = await prisma.livestream.findMany({ where: { sellerId, status: { in: ["LIVE", "PAUSED", "SCHEDULED"] } }, select: { id: true } });
  for (const s of streams) {
    const pos = await prisma.streamProduct.count({ where: { streamId: s.id } });
    await prisma.streamProduct.upsert({ where: { streamId_productId: { streamId: s.id, productId } }, update: {}, create: { streamId: s.id, productId, position: pos } });
    emit(`stream:${s.id}`, "stream:menu", { streamId: s.id, added: productId });
  }
  return streams.length;
}

async function publishScan(sellerId: string, scanId: string, input: z.infer<typeof PublishDraftInput>) {
  const scan = await prisma.productScan.findFirst({ where: { id: scanId, sellerId } });
  if (!scan) throw notFound("Scan");
  if (scan.status === "PUBLISHED") throw conflict("Already published");
  if (!["READY", "FAILED", "UPLOADED"].includes(scan.status)) throw conflict(`Scan is ${scan.status.toLowerCase()}`);
  const product = await prisma.$transaction(async (tx) => {
    const p = await tx.product.create({
      data: {
        sellerId,
        title: input.title,
        description: input.description,
        categoryId: input.categoryId,
        brand: input.brand ?? null,
        model: input.model ?? null,
        condition: input.condition,
        tags: input.tags.map((t) => t.toLowerCase()),
        shippingWeightGrams: input.shippingWeightGrams,
        liveMenuEnabled: input.addToLiveMenu,
        sourceScanId: scan.id,
        variants: { create: [{ name: "Default", priceCents: input.priceCents, quantity: input.quantity }] },
        media: { create: scan.imageUrls.map((url, i) => ({ url, position: i })) },
      },
    });
    await tx.productScan.update({ where: { id: scan.id }, data: { status: "PUBLISHED", draft: { ...(scan.draft as object), ...input } as any } });
    await tx.inventoryEvent.create({ data: { variantId: (await tx.productVariant.findFirstOrThrow({ where: { productId: p.id } })).id, delta: input.quantity, reason: "RESTOCK", refId: scan.id } });
    return p;
  });
  const menus = input.addToLiveMenu ? await addToLiveMenus(sellerId, product.id) : 0;
  return { product, addedToStreams: menus };
}

export async function scannerRoutes(app: FastifyInstance) {
  /**
   * Upload photos and analyze. Multipart fields:
   *  - files (1..8 images) — all images describe ONE item, unless mode=batch (one item per image)
   *  - barcode (optional), mode=single|batch
   */
  app.post("/seller/scans", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req) => {
    const { user, seller } = await requireSeller(req);
    const parts = req.parts();
    const files: { mime: string; bytes: Buffer; url: string; sha: string }[] = [];
    let barcode: string | undefined;
    let mode = "single";
    for await (const part of parts) {
      if (part.type === "file") {
        if (files.length >= 25) throw badRequest("At most 25 images per request");
        const stored = await storeUpload(await part.toBuffer(), `scans/${seller.id}`);
        if (!stored.mime.startsWith("image/")) throw badRequest("Scanner accepts images only");
        files.push({ mime: stored.mime, bytes: stored.bytes, url: stored.url, sha: stored.sha256 });
      } else if (part.fieldname === "barcode" && typeof part.value === "string" && /^[0-9]{8,14}$/.test(part.value)) barcode = part.value;
      else if (part.fieldname === "mode" && part.value === "batch") mode = "batch";
    }
    if (!files.length) throw badRequest("Add at least one photo");
    if (mode === "single" && files.length > 8) throw badRequest("Up to 8 photos per item");

    const groups = mode === "batch" ? files.map((f) => [f]) : [files];
    const batchId = mode === "batch" ? randomUUID() : null;
    const scans = [];
    for (const g of groups) {
      const dup = await prisma.productScan.findFirst({ where: { sellerId: seller.id, imageHash: g[0]!.sha, status: { notIn: ["DISCARDED"] } }, select: { id: true, status: true } });
      scans.push({
        scan: await prisma.productScan.create({ data: { sellerId: seller.id, batchId, imageUrls: g.map((x) => x.url), barcode, imageHash: g[0]!.sha } }),
        images: g,
        duplicateOf: dup?.id ?? null,
      });
    }
    // Analyze with bounded concurrency.
    const out: any[] = [];
    const queue = [...scans];
    const workers = Array.from({ length: Math.min(3, queue.length) }, async () => {
      while (queue.length) {
        const s = queue.shift()!;
        try {
          out.push({ ...(await analyzeScan(s.scan.id, s.images, user.id)), duplicateOf: s.duplicateOf });
        } catch (e: any) {
          out.push({ ...(await prisma.productScan.findUnique({ where: { id: s.scan.id } })), duplicateOf: s.duplicateOf, errorCode: e?.code, errorDetails: e?.details });
        }
      }
    });
    await Promise.all(workers);
    return { batchId, scans: out };
  });

  app.get("/seller/scans", async (req) => {
    const { seller } = await requireSeller(req);
    const { status, batchId } = req.query as { status?: string; batchId?: string };
    return prisma.productScan.findMany({
      where: { sellerId: seller.id, ...(status ? { status: status as any } : { status: { notIn: ["DISCARDED"] } }), ...(batchId ? { batchId } : {}) },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
  });

  app.get("/seller/scans/:id", async (req) => {
    const { seller } = await requireSeller(req);
    const s = await prisma.productScan.findFirst({ where: { id: (req.params as any).id, sellerId: seller.id } });
    if (!s) throw notFound("Scan");
    return s;
  });

  /** Retry analysis on a failed scan (charges again only if it succeeds the reservation). */
  app.post("/seller/scans/:id/retry", async (req) => {
    const { user, seller } = await requireSeller(req);
    const s = await prisma.productScan.findFirst({ where: { id: (req.params as any).id, sellerId: seller.id, status: "FAILED" } });
    if (!s) throw notFound("Failed scan");
    const { readStored } = await import("../storage");
    const images = await Promise.all(
      s.imageUrls.map(async (u) => {
        const { key, bytes } = await readStored(u);
        const ext = key.split(".").pop();
        return { mime: ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg", bytes };
      }),
    );
    // new idempotency scope for the retry
    const fresh = await prisma.productScan.create({ data: { sellerId: seller.id, batchId: s.batchId, imageUrls: s.imageUrls, barcode: s.barcode, imageHash: s.imageHash } });
    await prisma.productScan.update({ where: { id: s.id }, data: { status: "DISCARDED" } });
    return analyzeScan(fresh.id, images, user.id);
  });

  app.patch("/seller/scans/:id/draft", async (req) => {
    const { seller } = await requireSeller(req);
    const s = await prisma.productScan.findFirst({ where: { id: (req.params as any).id, sellerId: seller.id } });
    if (!s) throw notFound("Scan");
    const patch = parse(PublishDraftInput.omit({ priceConfirmed: true }).partial(), req.body);
    return prisma.productScan.update({ where: { id: s.id }, data: { draft: { ...((s.draft as object) ?? {}), ...patch } as any } });
  });

  app.post("/seller/scans/:id/publish", async (req) => {
    const { seller } = await requireSeller(req);
    return publishScan(seller.id, (req.params as any).id, parse(PublishDraftInput, req.body));
  });

  /** Batch publish: every item needs its own confirmed price. Partial failures are reported per item. */
  app.post("/seller/scans/batch-publish", async (req) => {
    const { seller } = await requireSeller(req);
    const body = parse(z.object({ items: z.array(z.object({ scanId: z.string(), listing: PublishDraftInput })).min(1).max(100), categoryId: z.string().optional() }), req.body);
    const results = [];
    for (const it of body.items) {
      try {
        const r = await publishScan(seller.id, it.scanId, { ...it.listing, categoryId: it.listing.categoryId ?? body.categoryId });
        results.push({ scanId: it.scanId, ok: true, productId: r.product.id });
      } catch (e: any) {
        results.push({ scanId: it.scanId, ok: false, error: e?.message });
      }
    }
    return { results };
  });

  app.delete("/seller/scans/:id", async (req) => {
    const { seller } = await requireSeller(req);
    const r = await prisma.productScan.updateMany({ where: { id: (req.params as any).id, sellerId: seller.id, status: { not: "PUBLISHED" } }, data: { status: "DISCARDED" } });
    if (!r.count) throw notFound("Scan");
    return { ok: true };
  });

  app.get("/barcode/:code", async (req) => {
    await requireSeller(req);
    const code = (req.params as any).code as string;
    if (!/^[0-9]{8,14}$/.test(code)) throw badRequest("Invalid barcode");
    return lookupBarcode(code);
  });
}
