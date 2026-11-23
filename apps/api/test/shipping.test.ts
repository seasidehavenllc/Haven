import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/db";
import { address, buyer, getApp, product, seller } from "./helpers";

beforeAll(async () => {
  await getApp();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const from = { fromName: "Shop", fromLine1: "10 Dock St", fromCity: "Wilmington", fromRegion: "NC", fromPostalCode: "28401", fromCountry: "US" };

async function paidOrder(qty = 1, opts: { weightGrams?: number } = {}) {
  const s = await seller();
  const p = await product(s, 5, 2000);
  if (opts.weightGrams) await prisma.product.update({ where: { id: p.id }, data: { shippingWeightGrams: opts.weightGrams } });
  const b = await buyer();
  await b.call("POST", "/cart/items", { variantId: p.variants[0].id, quantity: qty });
  const co = await b.call("POST", "/checkout", { address, idempotencyKey: randomUUID() });
  expect(co.status).toBe(200);
  return { s, b, p, order: co.json.orders[0] };
}

/** Fake Shippo HTTP API: records requests and answers like the real one. */
function stubShippo(opts: { labelStatus?: string } = {}) {
  const calls: { url: string; body: any; auth: string }[] = [];
  vi.stubGlobal("fetch", async (url: string, init: any) => {
    const body = init?.body ? JSON.parse(init.body) : null;
    calls.push({ url, body, auth: init.headers.authorization });
    if (url.endsWith("/shipments/"))
      return Response.json({
        object_id: "shp_1",
        rates: [
          { object_id: "rate_exp", amount: "24.10", currency: "USD", provider: "USPS", servicelevel: { name: "Priority Mail Express" }, estimated_days: 1 },
          { object_id: "rate_gnd", amount: "6.85", currency: "USD", provider: "USPS", servicelevel: { name: "Ground Advantage" }, estimated_days: 4 },
        ],
      });
    if (url.endsWith("/transactions/"))
      return Response.json({ object_id: "txn_1", status: opts.labelStatus ?? "SUCCESS", tracking_number: "9400111", tracking_url_provider: "https://tools.usps.com/t/9400111", label_url: "https://shippo-delivery.s3.amazonaws.com/label.pdf", messages: [{ text: "Address invalid" }] });
    if (url.endsWith("/tracks/")) return Response.json({ ok: true });
    return new Response("not found", { status: 404 });
  });
  return calls;
}

describe("shipping", () => {
  it("charges each seller's flat, per-item and free-over shipping at checkout", async () => {
    const s = await seller();
    const p = await product(s, 10, 2000);
    expect((await s.call("PUT", "/seller/shipping", { flatRateCents: 599, perAdditionalItemCents: 100, freeOverCents: 10000, handlingDays: 2 })).status).toBe(200);
    const b = await buyer();
    await b.call("POST", "/cart/items", { variantId: p.variants[0].id, quantity: 3 });
    const totals = await b.call("GET", "/cart/totals");
    expect(totals.json).toMatchObject({ subtotalCents: 6000, shippingCents: 799, totalCents: 6799 });
    expect(totals.json.sellers[0].freeShippingGapCents).toBe(4000);
    const co = await b.call("POST", "/checkout", { address, idempotencyKey: randomUUID() });
    expect(co.json.orders[0]).toMatchObject({ subtotalCents: 6000, shippingCents: 799, totalCents: 6799 });
    expect(co.json.checkout.amountCents).toBe(6799);
    // Platform fee is on the item subtotal only.
    expect(co.json.orders[0].platformFeeCents).toBe(Math.round(6000 * 0.08));

    await b.call("POST", "/cart/items", { variantId: p.variants[0].id, quantity: 5 });
    const free = await b.call("POST", "/checkout", { address, idempotencyKey: randomUUID() });
    expect(free.json.orders[0]).toMatchObject({ subtotalCents: 10000, shippingCents: 0, totalCents: 10000 });
  });

  it("refuses label rates without a provider, and says what's needed", async () => {
    vi.stubEnv("SHIPPO_API_KEY", "");
    vi.stubEnv("EASYPOST_API_KEY", "");
    const { s, order } = await paidOrder();
    const r = await s.call("POST", `/seller/orders/${order.id}/shipping/rates`, {});
    expect(r.status).toBe(503);
    expect(r.json.details.requiredEnv).toContain("SHIPPO_API_KEY");
  });

  it("gets Shippo rates, buys one label once, charges the seller ledger and notifies the buyer", async () => {
    vi.stubEnv("SHIPPO_API_KEY", "shippo_test_key");
    const { s, b, order } = await paidOrder(2, { weightGrams: 454 });
    const calls = stubShippo();

    expect((await s.call("POST", `/seller/orders/${order.id}/shipping/rates`, {})).json.details?.missing).toBe("fromAddress");
    await s.call("PUT", "/seller/shipping", { flatRateCents: 0, perAdditionalItemCents: 0, freeOverCents: null, handlingDays: 1, ...from });

    const q = await s.call("POST", `/seller/orders/${order.id}/shipping/rates`, {});
    expect(q.status).toBe(200);
    expect(q.json.rates.map((r: any) => r.amountCents)).toEqual([685, 2410]);
    expect(calls[0]!.auth).toBe("ShippoToken shippo_test_key");
    expect(calls[0]!.body.parcels[0]).toMatchObject({ mass_unit: "oz", weight: "32" }); // 2 × 454 g
    expect(calls[0]!.body.address_to).toMatchObject({ street1: address.line1, zip: address.postalCode });

    // Someone else's order or a made-up rate is refused.
    const other = await paidOrder();
    expect((await s.call("POST", `/seller/orders/${other.order.id}/shipping/labels`, { quoteId: q.json.quoteId, rateId: "rate_gnd" })).status).toBe(404);
    expect((await s.call("POST", `/seller/orders/${order.id}/shipping/labels`, { quoteId: q.json.quoteId, rateId: "rate_fake" })).status).toBe(400);

    const [a, c] = await Promise.all([
      s.call("POST", `/seller/orders/${order.id}/shipping/labels`, { quoteId: q.json.quoteId, rateId: "rate_gnd" }),
      s.call("POST", `/seller/orders/${order.id}/shipping/labels`, { quoteId: q.json.quoteId, rateId: "rate_gnd" }),
    ]);
    expect([a.status, c.status].sort()).toEqual([200, 409]);
    expect(calls.filter((x) => x.url.endsWith("/transactions/"))).toHaveLength(1);
    const sh = (a.status === 200 ? a : c).json;
    expect(sh).toMatchObject({ provider: "shippo", carrier: "USPS", trackingNumber: "9400111", labelCostCents: 685, status: "LABEL_CREATED" });

    const ledger = await s.call("GET", "/seller/shipping/ledger");
    expect(ledger.json.balanceCents).toBe(-685);
    expect(ledger.json.entries[0]).toMatchObject({ kind: "LABEL_PURCHASE", amountCents: -685, refId: sh.id });
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("SHIPPED");
    expect((await b.call("GET", "/notifications")).json.map((n: any) => n.type)).toContain("order.shipped");
  });

  it("puts the quote back when the provider can't make the label", async () => {
    vi.stubEnv("SHIPPO_API_KEY", "shippo_test_key");
    const { s, order } = await paidOrder(1, { weightGrams: 200 });
    await s.call("PUT", "/seller/shipping", { flatRateCents: 0, perAdditionalItemCents: 0, freeOverCents: null, handlingDays: 1, ...from });
    stubShippo({ labelStatus: "ERROR" });
    const q = await s.call("POST", `/seller/orders/${order.id}/shipping/rates`, {});
    const r = await s.call("POST", `/seller/orders/${order.id}/shipping/labels`, { quoteId: q.json.quoteId, rateId: "rate_gnd" });
    expect(r.status).toBe(502);
    expect(r.json.message).toContain("Address invalid");
    expect((await prisma.shippingQuote.findUniqueOrThrow({ where: { id: q.json.quoteId } })).purchasedAt).toBeNull();
    expect((await s.call("GET", "/seller/shipping/ledger")).json.balanceCents).toBe(0);
  });

  it("applies tracking webhooks only with the right token, once, and marks delivery", async () => {
    vi.stubEnv("SHIPPING_WEBHOOK_TOKEN", "hook-secret-123");
    const { s, b, order } = await paidOrder();
    const tn = `1Z${randomUUID().slice(0, 10)}`;
    await s.call("POST", `/seller/orders/${order.id}/ship`, { carrier: "UPS", trackingNumber: tn });
    const app = await getApp();
    const hook = (token: string, payload: unknown) => app.inject({ method: "POST", url: `/webhooks/shipping/easypost?token=${token}`, payload: payload as any });

    const delivered = {
      description: "tracker.updated",
      result: {
        object: "Tracker",
        tracking_code: tn,
        carrier: "UPS",
        status: "delivered",
        tracking_details: [
          { status: "in_transit", message: "Departed facility", datetime: "2026-11-20T10:00:00Z", tracking_location: { city: "Raleigh", state: "NC" } },
          { status: "delivered", message: "Delivered, front door", datetime: "2026-11-21T15:00:00Z", tracking_location: { city: "Springfield", state: "IL" } },
        ],
      },
    };
    expect((await hook("wrong", delivered)).statusCode).toBe(401);
    expect((await hook("hook-secret-123", delivered)).json()).toEqual({ matched: 1 });
    expect((await hook("hook-secret-123", delivered)).json()).toEqual({ matched: 1 });

    const sh = await prisma.shipment.findFirstOrThrow({ where: { orderId: order.id }, include: { events: true } });
    expect(sh.status).toBe("DELIVERED");
    expect(sh.deliveredAt?.toISOString()).toBe("2026-11-21T15:00:00.000Z");
    expect(sh.events).toHaveLength(2);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("DELIVERED");
    const inbox = (await b.call("GET", "/notifications")).json.filter((n: any) => n.type === "order.delivered");
    expect(inbox).toHaveLength(1);

    const orders = await b.call("GET", "/orders");
    expect(orders.json[0].shipments[0].events[0]).toMatchObject({ status: "DELIVERED", location: "Springfield, IL" });
  });
});
