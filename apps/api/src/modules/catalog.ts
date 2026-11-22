import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { ProductInput, ProductQuery } from "@glint/shared";
import { prisma } from "../db";
import { requireSeller, requireUser } from "../lib/auth";
import { badRequest, notFound } from "../lib/errors";
import { parse } from "../lib/validate";
import { emit } from "../realtime";
import { storeUpload } from "../storage";

export const productInclude = {
  variants: { orderBy: { createdAt: "asc" } },
  media: { orderBy: { position: "asc" } },
  category: true,
  seller: { select: { id: true, businessName: true, storefront: { select: { slug: true, name: true, logoUrl: true } } } },
} satisfies Prisma.ProductInclude;

export async function broadcastInventory(variantIds: string[]) {
  const vs = await prisma.productVariant.findMany({ where: { id: { in: variantIds } }, select: { id: true, productId: true, quantity: true } });
  for (const v of vs) emit(`product:${v.productId}`, "inventory:changed", v);
  const streams = await prisma.streamProduct.findMany({
    where: { productId: { in: vs.map((v) => v.productId) }, stream: { status: { in: ["LIVE", "PAUSED", "SCHEDULED"] } } },
    select: { streamId: true, productId: true },
  });
  for (const s of streams) for (const v of vs.filter((x) => x.productId === s.productId)) emit(`stream:${s.streamId}`, "inventory:changed", v);
}

export async function catalogRoutes(app: FastifyInstance) {
  app.get("/categories", async () => prisma.category.findMany({ orderBy: { name: "asc" } }));

  app.get("/products", async (req) => {
    const q = parse(ProductQuery, req.query);
    const where: Prisma.ProductWhereInput = { status: "ACTIVE", seller: { status: "APPROVED" } };
    if (q.q) {
      where.OR = [
        { title: { contains: q.q, mode: "insensitive" } },
        { description: { contains: q.q, mode: "insensitive" } },
        { brand: { contains: q.q, mode: "insensitive" } },
        { tags: { has: q.q.toLowerCase() } },
      ];
    }
    if (q.category) where.category = { slug: q.category };
    if (q.store) where.seller = { status: "APPROVED", storefront: { slug: q.store } };
    const variantFilter: Prisma.ProductVariantWhereInput = {};
    if (q.minPrice != null) variantFilter.priceCents = { gte: q.minPrice };
    if (q.maxPrice != null) variantFilter.priceCents = { ...(variantFilter.priceCents as object), lte: q.maxPrice };
    if (q.inStock) variantFilter.quantity = { gt: 0 };
    if (Object.keys(variantFilter).length) where.variants = { some: variantFilter };

    const [total, rows] = await Promise.all([
      prisma.product.count({ where }),
      prisma.product.findMany({
        where,
        include: productInclude,
        orderBy: { createdAt: "desc" },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
    ]);
    let items = rows;
    if (q.sort !== "newest") {
      const min = (p: (typeof rows)[number]) => Math.min(...p.variants.map((v) => v.priceCents));
      items = [...rows].sort((a, b) => (q.sort === "price_asc" ? min(a) - min(b) : min(b) - min(a)));
    }
    return { total, page: q.page, pageSize: q.pageSize, items };
  });

  app.get("/products/:id", async (req) => {
    const { id } = req.params as { id: string };
    const p = await prisma.product.findUnique({ where: { id }, include: { ...productInclude, reviews: { include: { user: { select: { handle: true, displayName: true } } }, orderBy: { createdAt: "desc" }, take: 20 } } });
    if (!p || p.status === "REMOVED") throw notFound("Product");
    if (p.status !== "ACTIVE" && req.user?.sellerId !== p.sellerId) throw notFound("Product");
    const [related, live] = await Promise.all([
      prisma.product.findMany({ where: { status: "ACTIVE", id: { not: p.id }, OR: [{ categoryId: p.categoryId ?? undefined }, { sellerId: p.sellerId }] }, include: productInclude, take: 8 }),
      prisma.streamProduct.findFirst({ where: { productId: p.id, hidden: false, stream: { status: "LIVE" } }, include: { stream: { select: { id: true, title: true, mode: true } } } }),
    ]);
    return { product: p, related, liveNow: live?.stream ?? null };
  });

  // ── Seller catalog management ──
  app.get("/seller/products", async (req) => {
    const { seller } = await requireSeller(req);
    return prisma.product.findMany({ where: { sellerId: seller.id, status: { not: "REMOVED" } }, include: productInclude, orderBy: { updatedAt: "desc" } });
  });

  app.post("/seller/products", async (req) => {
    const { seller } = await requireSeller(req);
    const input = parse(ProductInput, req.body);
    if (input.categoryId && !(await prisma.category.findUnique({ where: { id: input.categoryId } }))) throw badRequest("Unknown category");
    return prisma.product.create({
      data: {
        sellerId: seller.id,
        title: input.title,
        description: input.description,
        categoryId: input.categoryId,
        brand: input.brand,
        model: input.model,
        condition: input.condition,
        tags: input.tags.map((t) => t.toLowerCase()),
        status: input.status,
        shippingWeightGrams: input.shippingWeightGrams,
        variants: { create: input.variants.map((v) => ({ ...v, options: v.options })) },
        media: { create: input.imageUrls.map((url, i) => ({ url, position: i })) },
      },
      include: productInclude,
    });
  });

  app.patch("/seller/products/:id", async (req) => {
    const { seller } = await requireSeller(req);
    const { id } = req.params as { id: string };
    const p = await prisma.product.findFirst({ where: { id, sellerId: seller.id } });
    if (!p) throw notFound("Product");
    const input = parse(ProductInput.omit({ variants: true, imageUrls: true }).partial().extend({ liveMenuEnabled: z.boolean().optional(), status: z.enum(["DRAFT", "ACTIVE", "ARCHIVED"]).optional() }), req.body);
    return prisma.product.update({ where: { id }, data: { ...input, tags: input.tags?.map((t) => t.toLowerCase()) }, include: productInclude });
  });

  /** Set absolute stock for a variant; logged as an inventory event and broadcast everywhere. */
  app.put("/seller/variants/:id/inventory", async (req) => {
    const { seller } = await requireSeller(req);
    const { id } = req.params as { id: string };
    const { quantity, priceCents } = parse(z.object({ quantity: z.number().int().min(0), priceCents: z.number().int().positive().optional() }), req.body);
    const v = await prisma.productVariant.findFirst({ where: { id, product: { sellerId: seller.id } } });
    if (!v) throw notFound("Variant");
    const updated = await prisma.$transaction(async (tx) => {
      const cur = await tx.$queryRaw<{ quantity: number }[]>`SELECT quantity FROM "ProductVariant" WHERE id = ${id} FOR UPDATE`;
      const delta = quantity - cur[0]!.quantity;
      const row = await tx.productVariant.update({ where: { id }, data: { quantity, priceCents, version: { increment: 1 } } });
      if (delta !== 0) await tx.inventoryEvent.create({ data: { variantId: id, delta, reason: delta > 0 ? "RESTOCK" : "ADJUST" } });
      return row;
    });
    await broadcastInventory([id]);
    return updated;
  });

  app.post("/uploads", async (req) => {
    const u = requireUser(req);
    const file = await req.file();
    if (!file) throw badRequest("No file");
    const stored = await storeUpload(await file.toBuffer(), `media/${u.id}`);
    return { url: stored.url, mime: stored.mime };
  });

  // ── Wishlist ──
  app.get("/wishlist", async (req) => {
    const u = requireUser(req);
    return prisma.wishlistItem.findMany({ where: { userId: u.id }, include: { product: { include: productInclude } }, orderBy: { createdAt: "desc" } });
  });
  app.post("/wishlist/:productId", async (req) => {
    const u = requireUser(req);
    const { productId } = req.params as { productId: string };
    await prisma.wishlistItem.upsert({ where: { userId_productId: { userId: u.id, productId } }, update: {}, create: { userId: u.id, productId } });
    return { saved: true };
  });
  app.delete("/wishlist/:productId", async (req) => {
    const u = requireUser(req);
    const { productId } = req.params as { productId: string };
    await prisma.wishlistItem.deleteMany({ where: { userId: u.id, productId } });
    return { saved: false };
  });
}
