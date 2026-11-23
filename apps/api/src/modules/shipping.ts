import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db";
import { requireSeller } from "../lib/auth";
import { audit } from "../lib/audit";
import { badRequest, conflict, HttpError, notConfigured, notFound } from "../lib/errors";
import { parse } from "../lib/validate";
import { notify } from "../notify";
import { activeShippingProvider, gramsToOz, shippingProviders, ShippingError, type Parcel, type Rate, type ShipAddress, type TrackingUpdate } from "../shipping";

const ProfileInput = z.object({
  flatRateCents: z.number().int().min(0).max(100_000),
  perAdditionalItemCents: z.number().int().min(0).max(100_000),
  freeOverCents: z.number().int().min(0).max(10_000_000).nullable(),
  handlingDays: z.number().int().min(0).max(30),
  fromName: z.string().trim().max(120).nullable().optional(),
  fromCompany: z.string().trim().max(120).nullable().optional(),
  fromLine1: z.string().trim().max(200).nullable().optional(),
  fromLine2: z.string().trim().max(200).nullable().optional(),
  fromCity: z.string().trim().max(100).nullable().optional(),
  fromRegion: z.string().trim().max(100).nullable().optional(),
  fromPostalCode: z.string().trim().max(20).nullable().optional(),
  fromCountry: z.string().trim().length(2).toUpperCase().nullable().optional(),
  fromPhone: z.string().trim().max(30).nullable().optional(),
  parcelLengthIn: z.number().positive().max(108).optional(),
  parcelWidthIn: z.number().positive().max(108).optional(),
  parcelHeightIn: z.number().positive().max(108).optional(),
});

const ParcelInput = z.object({ lengthIn: z.number().positive().max(108), widthIn: z.number().positive().max(108), heightIn: z.number().positive().max(108), weightOz: z.number().positive().max(2400) });

const DEFAULTS = { flatRateCents: 0, perAdditionalItemCents: 0, freeOverCents: null, handlingDays: 2, fromCountry: "US", parcelLengthIn: 10, parcelWidthIn: 8, parcelHeightIn: 4 };
type Profile = Awaited<ReturnType<typeof prisma.sellerShippingProfile.findUnique>>;

function fromAddress(p: Profile, fallbackName: string): ShipAddress | null {
  if (!p?.fromLine1 || !p.fromCity || !p.fromRegion || !p.fromPostalCode) return null;
  return { name: p.fromName || fallbackName, company: p.fromCompany, line1: p.fromLine1, line2: p.fromLine2, city: p.fromCity, region: p.fromRegion, postalCode: p.fromPostalCode, country: p.fromCountry || "US", phone: p.fromPhone };
}

const SHIPPABLE = ["PAID", "FULFILLING"];

export const sellerBalance = async (sellerId: string) => (await prisma.sellerLedgerEntry.aggregate({ where: { sellerId }, _sum: { amountCents: true } }))._sum.amountCents ?? 0;

function tokenOk(given: unknown) {
  const want = process.env.SHIPPING_WEBHOOK_TOKEN;
  if (!want || typeof given !== "string") return false;
  const a = Buffer.from(given);
  const b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Apply a carrier tracking update to the matching shipment. Idempotent: replays add nothing new. */
export async function applyTracking(u: TrackingUpdate) {
  const shipments = await prisma.shipment.findMany({ where: { trackingNumber: u.trackingNumber }, include: { order: true } });
  for (const sh of shipments) {
    if (u.events.length) await prisma.shipmentEvent.createMany({ data: u.events.map((e) => ({ shipmentId: sh.id, ...e })), skipDuplicates: true });
    const delivered = u.status === "DELIVERED";
    const at = delivered ? (u.events.filter((e) => e.status === "DELIVERED").at(-1)?.occurredAt ?? new Date()) : null;
    await prisma.shipment.update({ where: { id: sh.id }, data: { status: u.status === "PRE_TRANSIT" ? "LABEL_CREATED" : u.status, estDeliveryAt: u.estDeliveryAt ?? undefined, ...(delivered && !sh.deliveredAt ? { deliveredAt: at } : {}) } });
    if (delivered && !sh.deliveredAt) {
      // Only the first delivered update moves the order and tells the buyer.
      const moved = await prisma.order.updateMany({ where: { id: sh.orderId, status: "SHIPPED" }, data: { status: "DELIVERED" } });
      if (moved.count) await notify({ userId: sh.order.buyerId, type: "order.delivered", title: "Your order was delivered", body: [sh.carrier, sh.trackingNumber].filter(Boolean).join(" "), link: "/orders", data: { orderId: sh.orderId } });
    }
  }
  return shipments.length;
}

export async function shippingRoutes(app: FastifyInstance) {
  app.get("/seller/shipping", async (req) => {
    const { seller } = await requireSeller(req);
    const p = await prisma.sellerShippingProfile.findUnique({ where: { sellerId: seller.id } });
    const provider = activeShippingProvider();
    return {
      profile: p ?? { sellerId: seller.id, ...DEFAULTS },
      labels: provider ? { configured: true, provider: provider.id, name: provider.name } : { configured: false, requiredEnv: ["SHIPPO_API_KEY or EASYPOST_API_KEY"] },
      fromAddressComplete: !!fromAddress(p, seller.businessName),
      balanceCents: await sellerBalance(seller.id),
    };
  });

  app.put("/seller/shipping", async (req) => {
    const { seller, user } = await requireSeller(req);
    const body = parse(ProfileInput, req.body);
    if (body.freeOverCents != null && body.freeOverCents === 0) throw badRequest("Use a flat rate of 0 for free shipping on every order");
    const p = await prisma.sellerShippingProfile.upsert({ where: { sellerId: seller.id }, create: { sellerId: seller.id, ...body }, update: body });
    await audit(prisma, { actorId: user.id, action: "seller.shipping.update", targetType: "seller", targetId: seller.id, data: { flatRateCents: p.flatRateCents, perAdditionalItemCents: p.perAdditionalItemCents, freeOverCents: p.freeOverCents } });
    return p;
  });

  app.get("/seller/shipping/ledger", async (req) => {
    const { seller } = await requireSeller(req);
    return { balanceCents: await sellerBalance(seller.id), entries: await prisma.sellerLedgerEntry.findMany({ where: { sellerId: seller.id }, orderBy: { createdAt: "desc" }, take: 100 }) };
  });

  /** Live carrier rates for one order's package. The seller then buys one of these. */
  app.post("/seller/orders/:id/shipping/rates", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req) => {
    const { seller } = await requireSeller(req);
    const provider = activeShippingProvider();
    if (!provider) throw notConfigured("Shipping labels", ["SHIPPO_API_KEY", "EASYPOST_API_KEY"]);
    const { id } = req.params as { id: string };
    const body = parse(z.object({ parcel: ParcelInput.partial().optional() }), req.body ?? {});
    const order = await prisma.order.findFirst({ where: { id, sellerId: seller.id }, include: { items: { include: { variant: { include: { product: true } } } } } });
    if (!order) throw notFound("Order");
    if (!SHIPPABLE.includes(order.status)) throw conflict(`Order is ${order.status.toLowerCase()}`);
    const profile = await prisma.sellerShippingProfile.findUnique({ where: { sellerId: seller.id } });
    const from = fromAddress(profile, seller.businessName);
    if (!from) throw badRequest("Add your ship-from address in shipping settings first", { missing: "fromAddress" });
    const to = order.shippingAddress as unknown as ShipAddress;

    const grams = order.items.reduce((s, i) => s + (i.variant.product.shippingWeightGrams ?? 0) * i.quantity, 0);
    const missingWeight = order.items.some((i) => !i.variant.product.shippingWeightGrams);
    const parcel: Parcel = {
      lengthIn: body.parcel?.lengthIn ?? profile?.parcelLengthIn ?? DEFAULTS.parcelLengthIn,
      widthIn: body.parcel?.widthIn ?? profile?.parcelWidthIn ?? DEFAULTS.parcelWidthIn,
      heightIn: body.parcel?.heightIn ?? profile?.parcelHeightIn ?? DEFAULTS.parcelHeightIn,
      weightOz: body.parcel?.weightOz ?? (missingWeight ? 0 : gramsToOz(grams)),
    };
    if (!parcel.weightOz) throw badRequest("Enter the package weight (some items have no shipping weight)", { missing: "weightOz" });

    let quote;
    try {
      quote = await provider.rates(from, to, parcel);
    } catch (e) {
      if (e instanceof ShippingError) throw new HttpError(502, "shipping_provider_error", `${provider.name}: ${e.message}`);
      throw e;
    }
    if (!quote.rates.length) throw new HttpError(422, "no_rates", `${provider.name} returned no rates for this package. Check both addresses and the package size.`);
    const rates = [...quote.rates].sort((a, b) => a.amountCents - b.amountCents);
    const q = await prisma.shippingQuote.create({ data: { orderId: order.id, provider: provider.id, shipmentRef: quote.shipmentRef, rates: rates as any, parcel: parcel as any } });
    return { quoteId: q.id, provider: provider.id, parcel, rates, chargedToBuyerCents: order.shippingCents };
  });

  /** Buy a label from a quote. The label cost is charged to the seller in the seller ledger. */
  app.post("/seller/orders/:id/shipping/labels", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req) => {
    const { seller, user } = await requireSeller(req);
    const { id } = req.params as { id: string };
    const body = parse(z.object({ quoteId: z.string(), rateId: z.string() }), req.body);
    const order = await prisma.order.findFirst({ where: { id, sellerId: seller.id } });
    if (!order) throw notFound("Order");
    if (!SHIPPABLE.includes(order.status)) throw conflict(`Order is ${order.status.toLowerCase()}`);
    const q = await prisma.shippingQuote.findFirst({ where: { id: body.quoteId, orderId: order.id } });
    if (!q) throw notFound("Quote");
    if (Date.now() - q.createdAt.getTime() > 24 * 3600_000) throw conflict("These rates have expired. Get new rates.");
    const rate = (q.rates as unknown as Rate[]).find((r) => r.id === body.rateId);
    if (!rate) throw badRequest("That rate isn't part of this quote");
    const provider = shippingProviders[q.provider];
    if (!provider?.configured()) throw notConfigured("Shipping labels", [provider?.envVar ?? "SHIPPO_API_KEY"]);

    // Claim the quote first so two clicks can't buy two labels.
    const claimed = await prisma.shippingQuote.updateMany({ where: { id: q.id, purchasedAt: null }, data: { purchasedAt: new Date() } });
    if (!claimed.count) throw conflict("A label was already bought from these rates");

    let label;
    try {
      label = await provider.buyLabel(q.shipmentRef, rate);
    } catch (e) {
      await prisma.shippingQuote.update({ where: { id: q.id }, data: { purchasedAt: null } });
      if (e instanceof ShippingError) throw new HttpError(502, "shipping_provider_error", `${provider.name}: ${e.message}`);
      throw e;
    }

    const shipment = await prisma.$transaction(async (tx) => {
      const sh = await tx.shipment.create({
        data: { orderId: order.id, provider: provider.id, providerRef: label.providerRef, carrier: label.carrier, service: label.service, trackingNumber: label.trackingNumber, trackingUrl: label.trackingUrl, labelUrl: label.labelUrl, labelCostCents: label.costCents, status: "LABEL_CREATED" },
      });
      await tx.sellerLedgerEntry.create({ data: { sellerId: seller.id, amountCents: -label.costCents, kind: "LABEL_PURCHASE", refId: sh.id, memo: `${label.carrier} ${label.service} label for order ${order.id.slice(-6)}`, idempotencyKey: `label:${q.id}` } });
      await tx.order.updateMany({ where: { id: order.id, status: { in: SHIPPABLE as any } }, data: { status: "SHIPPED" } });
      await audit(tx, { actorId: user.id, action: "shipping.label.buy", targetType: "order", targetId: order.id, data: { provider: provider.id, costCents: label.costCents, shipmentId: sh.id } });
      return sh;
    });
    await notify({ userId: order.buyerId, type: "order.shipped", title: "Your order shipped", body: `${label.carrier} ${label.trackingNumber}`, link: "/orders", data: { orderId: order.id } });
    return shipment;
  });

  // Carrier tracking webhooks. Neither Shippo nor EasyPost sign every plan's webhooks the same way,
  // so the URL carries our own secret: /webhooks/shipping/shippo?token=SHIPPING_WEBHOOK_TOKEN
  app.post("/webhooks/shipping/:provider", async (req, reply) => {
    const { provider } = req.params as { provider: string };
    const p = shippingProviders[provider];
    if (!p) throw notFound("Provider");
    if (!process.env.SHIPPING_WEBHOOK_TOKEN) return reply.code(503).send({ error: "not_configured", message: "SHIPPING_WEBHOOK_TOKEN is not set" });
    if (!tokenOk((req.query as any)?.token)) throw new HttpError(401, "bad_token", "Invalid webhook token");
    const update = p.parseWebhook(req.body);
    if (!update) return { ignored: true };
    return { matched: await applyTracking(update) };
  });
}

/** After a manual "I shipped it" with a tracking number, ask the provider to track it so delivery updates still arrive. */
export function trackManualShipment(carrier: string, trackingNumber: string) {
  const p = activeShippingProvider();
  if (!p?.track) return;
  p.track(carrier, trackingNumber).catch((e) => console.error(`[shipping] could not start tracking ${trackingNumber}:`, e.message));
}
