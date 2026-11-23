import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { CartItemInput, CheckoutInput } from "@haven/shared";
import { prisma, type Tx } from "../db";
import { requireSeller, requireUser } from "../lib/auth";
import { badRequest, conflict, notFound, HttpError } from "../lib/errors";
import { parse } from "../lib/validate";
import { emit } from "../realtime";
import { broadcastInventory, productInclude } from "./catalog";
import { createPaymentIntent, verifyStripeSignature } from "../payments";
import { notify, createNotifications, deliver } from "../notify";

type Line = { variantId: string; quantity: number; unitPriceCents?: number };

/** Guarded stock decrement: succeeds only if enough stock remains. Safe under concurrency. */
export async function takeStock(tx: Tx, variantId: string, qty: number, reason: string, refId: string) {
  const n = await tx.$executeRaw`UPDATE "ProductVariant" SET quantity = quantity - ${qty}, version = version + 1 WHERE id = ${variantId} AND quantity >= ${qty}`;
  if (n !== 1) return false;
  await tx.inventoryEvent.create({ data: { variantId, delta: -qty, reason, refId } });
  return true;
}

/**
 * Create orders (one per seller) for the given lines. Stock is reserved atomically; prices are
 * read from the DB (never from the client) unless an explicit server-side price is passed
 * (auction wins). Idempotent on (buyerId, idempotencyKey).
 */
export async function placeOrder(opts: {
  buyerId: string;
  lines: Line[];
  address: unknown;
  idempotencyKey: string;
  streamId?: string;
  affiliateCode?: string;
  clearCart?: boolean;
}) {
  const existing = await prisma.checkoutSession.findUnique({ where: { buyerId_idempotencyKey: { buyerId: opts.buyerId, idempotencyKey: opts.idempotencyKey } } });
  if (existing) {
    const orders = await prisma.order.findMany({ where: { checkoutGroupId: existing.id }, include: { items: true } });
    return { checkout: existing, orders, clientSecret: null as string | null, replay: true };
  }
  if (!opts.lines.length) throw badRequest("Cart is empty");
  const settings = await prisma.platformSettings.findUnique({ where: { id: "global" } });
  const feeBps = settings?.marketplaceFeeBps ?? 800;

  const result = await prisma.$transaction(async (tx) => {
    const variants = await tx.productVariant.findMany({
      where: { id: { in: opts.lines.map((l) => l.variantId) } },
      include: { product: { include: { seller: true } } },
    });
    const bySeller = new Map<string, { v: (typeof variants)[number]; qty: number; price: number }[]>();
    for (const l of opts.lines) {
      const v = variants.find((x) => x.id === l.variantId);
      if (!v || v.product.status !== "ACTIVE" || v.product.seller.status !== "APPROVED") throw conflict("An item in your cart is no longer available", { variantId: l.variantId });
      if (v.product.seller.userId === opts.buyerId) throw badRequest("You cannot buy your own product");
      if (!bySeller.has(v.product.sellerId)) bySeller.set(v.product.sellerId, []);
      bySeller.get(v.product.sellerId)!.push({ v, qty: l.quantity, price: l.unitPriceCents ?? v.priceCents });
    }
    const total = [...bySeller.values()].flat().reduce((s, x) => s + x.price * x.qty, 0);
    const checkout = await tx.checkoutSession.create({
      data: { buyerId: opts.buyerId, idempotencyKey: opts.idempotencyKey, provider: "pending", amountCents: total },
    });
    const orders = [];
    for (const [sellerId, lines] of bySeller) {
      for (const l of lines) {
        const ok = await takeStock(tx, l.v.id, l.qty, "SALE", checkout.id);
        if (!ok) throw conflict(`"${l.v.product.title}" (${l.v.name}) doesn't have enough stock`, { variantId: l.v.id, soldOut: true });
      }
      const subtotal = lines.reduce((s, x) => s + x.price * x.qty, 0);
      orders.push(
        await tx.order.create({
          data: {
            checkoutGroupId: checkout.id,
            buyerId: opts.buyerId,
            sellerId,
            subtotalCents: subtotal,
            platformFeeCents: Math.round((subtotal * feeBps) / 10000),
            totalCents: subtotal,
            shippingAddress: opts.address as any,
            streamId: opts.streamId,
            affiliateCode: opts.affiliateCode,
            items: { create: lines.map((l) => ({ variantId: l.v.id, titleSnapshot: `${l.v.product.title} — ${l.v.name}`, unitPriceCents: l.price, quantity: l.qty })) },
          },
          include: { items: true },
        }),
      );
    }
    if (opts.clearCart) await tx.cartItem.deleteMany({ where: { cart: { userId: opts.buyerId }, variantId: { in: opts.lines.map((l) => l.variantId) } } });
    return { checkout, orders, total };
  });

  // Payment step happens outside the DB transaction.
  let intent;
  try {
    intent = await createPaymentIntent({ amountCents: result.total, currency: "USD", checkoutId: result.checkout.id, idempotencyKey: `pi:${result.checkout.id}` });
  } catch (e) {
    await releaseCheckout(result.checkout.id, "payment_setup_failed");
    throw e;
  }
  await prisma.checkoutSession.update({ where: { id: result.checkout.id }, data: { provider: intent.provider, providerRef: intent.providerRef, isTest: intent.provider === "test" } });
  if (intent.settled) await markCheckoutPaid(result.checkout.id, intent.providerRef, intent.provider);
  await broadcastInventory(opts.lines.map((l) => l.variantId));
  const orders = await prisma.order.findMany({ where: { checkoutGroupId: result.checkout.id }, include: { items: true } });
  return { checkout: result.checkout, orders, clientSecret: intent.clientSecret ?? null, replay: false };
}

export async function markCheckoutPaid(checkoutId: string, providerRef: string, provider: string) {
  const cs = await prisma.checkoutSession.findUniqueOrThrow({ where: { id: checkoutId } });
  if (cs.status === "SUCCEEDED") return;
  const isTest = provider === "test";
  await prisma.$transaction([
    prisma.checkoutSession.update({ where: { id: checkoutId }, data: { status: "SUCCEEDED" } }),
    prisma.payment.create({ data: { checkoutId, provider, providerRef, amountCents: cs.amountCents, status: "SUCCEEDED", isTest } }),
    prisma.order.updateMany({ where: { checkoutGroupId: checkoutId, status: "PENDING_PAYMENT" }, data: { status: "PAID", isTest } }),
  ]);
  const orders = await prisma.order.findMany({ where: { checkoutGroupId: checkoutId } });
  for (const o of orders) {
    emit(`seller:${o.sellerId}`, "order:created", { orderId: o.id, totalCents: o.totalCents, isTest });
    const seller = await prisma.sellerAccount.findUnique({ where: { id: o.sellerId } });
    if (seller) await notify({ userId: seller.userId, type: "order.new", title: "New order", body: `Order ${o.id.slice(-6)} · $${(o.totalCents / 100).toFixed(2)}${isTest ? " (TEST)" : ""}`, link: `/seller/orders`, data: { orderId: o.id } });
  }
}

/** Restore reserved stock for an unpaid checkout. */
export async function releaseCheckout(checkoutId: string, reason: string) {
  const variantIds: string[] = [];
  await prisma.$transaction(async (tx) => {
    const orders = await tx.order.findMany({ where: { checkoutGroupId: checkoutId, status: "PENDING_PAYMENT" }, include: { items: true } });
    for (const o of orders) {
      for (const it of o.items) {
        await tx.$executeRaw`UPDATE "ProductVariant" SET quantity = quantity + ${it.quantity}, version = version + 1 WHERE id = ${it.variantId}`;
        await tx.inventoryEvent.create({ data: { variantId: it.variantId, delta: it.quantity, reason: "CANCEL_RESTORE", refId: checkoutId } });
        variantIds.push(it.variantId);
      }
      await tx.order.update({ where: { id: o.id }, data: { status: "CANCELLED" } });
    }
    await tx.checkoutSession.update({ where: { id: checkoutId }, data: { status: reason === "expired" ? "EXPIRED" : "FAILED" } });
  });
  if (variantIds.length) await broadcastInventory(variantIds);
}

/** Release checkouts that stayed unpaid for 30 minutes. Run periodically. */
export async function expireStaleCheckouts() {
  const stale = await prisma.checkoutSession.findMany({ where: { status: "PENDING", createdAt: { lt: new Date(Date.now() - 30 * 60_000) } }, select: { id: true } });
  for (const s of stale) await releaseCheckout(s.id, "expired");
  return stale.length;
}

async function getCart(userId: string) {
  return prisma.cart.upsert({
    where: { userId },
    update: {},
    create: { userId },
    include: { items: { include: { variant: { include: { product: { include: productInclude } } } }, orderBy: { id: "asc" } } },
  });
}

export async function commerceRoutes(app: FastifyInstance) {
  app.get("/cart", async (req) => getCart(requireUser(req).id));

  app.post("/cart/items", async (req) => {
    const u = requireUser(req);
    const input = parse(CartItemInput, req.body);
    const v = await prisma.productVariant.findUnique({ where: { id: input.variantId }, include: { product: true } });
    if (!v || v.product.status !== "ACTIVE") throw notFound("Product");
    if (v.quantity < input.quantity) throw conflict(`Only ${v.quantity} left in stock`, { available: v.quantity });
    const cart = await prisma.cart.upsert({ where: { userId: u.id }, update: {}, create: { userId: u.id } });
    await prisma.cartItem.upsert({
      where: { cartId_variantId: { cartId: cart.id, variantId: input.variantId } },
      update: { quantity: input.quantity },
      create: { cartId: cart.id, variantId: input.variantId, quantity: input.quantity },
    });
    return getCart(u.id);
  });

  app.delete("/cart/items/:variantId", async (req) => {
    const u = requireUser(req);
    const { variantId } = req.params as { variantId: string };
    await prisma.cartItem.deleteMany({ where: { cart: { userId: u.id }, variantId } });
    return getCart(u.id);
  });

  app.post("/checkout", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req) => {
    const u = requireUser(req);
    const input = parse(CheckoutInput, req.body);
    const cart = await getCart(u.id);
    return placeOrder({
      buyerId: u.id,
      lines: cart.items.map((i) => ({ variantId: i.variantId, quantity: i.quantity })),
      address: input.address,
      idempotencyKey: input.idempotencyKey,
      streamId: input.streamId,
      affiliateCode: input.affiliateCode,
      clearCart: true,
    });
  });

  /** One-tap purchase from a livestream menu (skips the cart). */
  app.post("/buy-now", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req) => {
    const u = requireUser(req);
    const input = parse(CheckoutInput.extend({ variantId: z.string(), quantity: z.number().int().min(1).max(20) }), req.body);
    if (input.streamId) {
      const v = await prisma.productVariant.findUnique({ where: { id: input.variantId } });
      const sp = v && (await prisma.streamProduct.findFirst({ where: { streamId: input.streamId, productId: v.productId, hidden: false } }));
      if (!sp) throw conflict("This product is not currently offered in that stream");
    }
    return placeOrder({ buyerId: u.id, lines: [{ variantId: input.variantId, quantity: input.quantity }], address: input.address, idempotencyKey: input.idempotencyKey, streamId: input.streamId });
  });

  app.get("/orders", async (req) => {
    const u = requireUser(req);
    return prisma.order.findMany({ where: { buyerId: u.id }, include: { items: true, shipments: true, seller: { select: { businessName: true } } }, orderBy: { createdAt: "desc" } });
  });

  app.get("/seller/orders", async (req) => {
    const { seller } = await requireSeller(req);
    return prisma.order.findMany({ where: { sellerId: seller.id }, include: { items: true, shipments: true, buyer: { select: { handle: true, displayName: true } } }, orderBy: { createdAt: "desc" }, take: 200 });
  });

  /** Manual fulfillment until a shipping provider is configured. */
  app.post("/seller/orders/:id/ship", async (req) => {
    const { seller } = await requireSeller(req);
    const { id } = req.params as { id: string };
    const body = parse(z.object({ carrier: z.string().min(2).max(40), trackingNumber: z.string().min(4).max(60) }), req.body);
    const o = await prisma.order.findFirst({ where: { id, sellerId: seller.id } });
    if (!o) throw notFound("Order");
    if (!["PAID", "FULFILLING"].includes(o.status)) throw conflict(`Order is ${o.status.toLowerCase()}`);
    await prisma.$transaction([
      prisma.shipment.create({ data: { orderId: id, carrier: body.carrier, trackingNumber: body.trackingNumber, provider: "manual", status: "IN_TRANSIT" } }),
      prisma.order.update({ where: { id }, data: { status: "SHIPPED" } }),
    ]);
    await notify({ userId: o.buyerId, type: "order.shipped", title: "Your order shipped", body: `${body.carrier} ${body.trackingNumber}`, link: `/orders`, data: { orderId: id } });
    return { ok: true };
  });

  // Stripe webhook (raw body for signature verification)
  app.register(async (scoped) => {
    scoped.addContentTypeParser("application/json", { parseAs: "buffer" }, (_req, body, done) => done(null, body));
    scoped.post("/webhooks/stripe", async (req, reply) => {
      const secret = process.env.STRIPE_WEBHOOK_SECRET;
      if (!secret) return reply.code(503).send({ error: "not_configured" });
      const raw = req.body as Buffer;
      if (!verifyStripeSignature(raw, req.headers["stripe-signature"] as string, secret)) throw new HttpError(400, "bad_signature", "Invalid signature");
      const evt = JSON.parse(raw.toString("utf8"));
      const obj = evt.data?.object;
      if (evt.type === "payment_intent.succeeded" && obj?.metadata?.checkoutId) await markCheckoutPaid(obj.metadata.checkoutId, obj.id, "stripe");
      if (evt.type === "payment_intent.payment_failed" && obj?.metadata?.checkoutId) await releaseCheckout(obj.metadata.checkoutId, "failed");
      return { received: true };
    });
  });
}
