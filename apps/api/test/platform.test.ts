import { describe, it, expect, beforeAll } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/db";
import { address, admin, buyer, client, enableTestAi, getApp, multipart, PNG, product, register, seller, testAi } from "./helpers";
import { closeDueAuctions } from "../src/modules/auctions";
import { creditBalance } from "../src/ai/ledger";

beforeAll(async () => {
  await getApp();
});

describe("auth", () => {
  it("registers, logs in, rotates refresh tokens and detects reuse", async () => {
    const u = await register();
    const anon = await client();
    const login = await anon("POST", "/auth/login", { email: `${u.tag}@test.dev`, password: "correct-horse-battery" });
    expect(login.status).toBe(200);
    expect((await anon("POST", "/auth/login", { email: `${u.tag}@test.dev`, password: "wrong-password" })).status).toBe(401);

    const r1 = await anon("POST", "/auth/refresh", { refreshToken: u.refreshToken });
    expect(r1.status).toBe(200);
    // Reusing the rotated token revokes every session.
    expect((await anon("POST", "/auth/refresh", { refreshToken: u.refreshToken })).status).toBe(401);
    expect((await anon("POST", "/auth/refresh", { refreshToken: r1.json.refreshToken })).status).toBe(401);
  });

  it("rejects unauthenticated and non-admin access", async () => {
    const anon = await client();
    expect((await anon("GET", "/me")).status).toBe(401);
    const b = await buyer();
    expect((await b.call("GET", "/admin/overview")).status).toBe(403);
    expect((await b.call("POST", "/seller/products", {})).status).toBe(403);
  });
});

describe("sellers and storefronts", () => {
  it("creates a seller with storefront, Starter plan and allowance credits", async () => {
    const s = await seller();
    const me = await s.call("GET", "/me");
    expect(me.json.seller.plan.key).toBe("starter");
    const bal = await creditBalance(prisma, s.sellerId);
    expect(bal).toEqual({ allowance: 100, purchased: 0, total: 100 });
    const store = await (await client())("GET", `/stores/shop-${s.tag}`);
    expect(store.status).toBe(200);
    expect(store.json.products).toEqual([]);
  });
});

describe("marketplace checkout", () => {
  it("sells exactly the available stock under concurrent checkouts", async () => {
    const s = await seller();
    const p = await product(s, 3);
    const variantId = p.variants[0].id;
    const buyers = await Promise.all(Array.from({ length: 8 }, () => buyer()));
    const results = await Promise.all(
      buyers.map((b) => b.call("POST", "/buy-now", { variantId, quantity: 1, address, idempotencyKey: randomUUID() })),
    );
    const ok = results.filter((r) => r.status === 200);
    const soldOut = results.filter((r) => r.status === 409);
    expect(ok.length).toBe(3);
    expect(soldOut.length).toBe(5);
    const v = await prisma.productVariant.findUniqueOrThrow({ where: { id: variantId } });
    expect(v.quantity).toBe(0);
    // Test-provider orders are flagged as test.
    expect(ok[0]!.json.orders[0].status).toBe("PAID");
    expect(ok[0]!.json.orders[0].isTest).toBe(true);
    const sellerOrders = await s.call("GET", "/seller/orders");
    expect(sellerOrders.json.length).toBe(3);
  });

  it("is idempotent on checkout retries and uses server prices", async () => {
    const s = await seller();
    const p = await product(s, 5, 1999);
    const b = await buyer();
    await b.call("POST", "/cart/items", { variantId: p.variants[0].id, quantity: 2 });
    const key = randomUUID();
    const first = await b.call("POST", "/checkout", { address, idempotencyKey: key });
    expect(first.status).toBe(200);
    expect(first.json.orders[0].totalCents).toBe(3998);
    expect(first.json.orders[0].platformFeeCents).toBe(320); // 8% marketplace fee from settings
    const replay = await b.call("POST", "/checkout", { address, idempotencyKey: key });
    expect(replay.json.replay).toBe(true);
    expect(replay.json.orders[0].id).toBe(first.json.orders[0].id);
    const v = await prisma.productVariant.findUniqueOrThrow({ where: { id: p.variants[0].id } });
    expect(v.quantity).toBe(3);
  });

  it("prevents sellers from buying their own products and rejects empty carts", async () => {
    const s = await seller();
    const p = await product(s, 5);
    expect((await s.call("POST", "/buy-now", { variantId: p.variants[0].id, quantity: 1, address, idempotencyKey: randomUUID() })).status).toBe(400);
    const b = await buyer();
    expect((await b.call("POST", "/checkout", { address, idempotencyKey: randomUUID() })).status).toBe(400);
  });
});

describe("auctions", () => {
  it("serializes simultaneous bids and enforces increments", async () => {
    const s = await seller();
    const p = await product(s, 1);
    const a = await s.call("POST", "/seller/auctions", { productId: p.id, startingPriceCents: 1000, minIncrementCents: 100, durationSeconds: 60 });
    expect(a.status).toBe(200);
    const bidders = await Promise.all(Array.from({ length: 6 }, () => buyer()));
    const results = await Promise.all(bidders.map((b) => b.call("POST", `/auctions/${a.json.id}/bids`, { amountCents: 1000, idempotencyKey: randomUUID() })));
    expect(results.filter((r) => r.status === 200).length).toBe(1);
    expect(results.filter((r) => r.status === 409).length).toBe(5);
    const challenger = bidders[results.findIndex((r) => r.status !== 200)]!;

    const low = await challenger.call("POST", `/auctions/${a.json.id}/bids`, { amountCents: 1050, idempotencyKey: randomUUID() });
    expect(low.status).toBe(409);
    expect(low.json.details.minimumCents).toBe(1100);
    expect((await s.call("POST", `/auctions/${a.json.id}/bids`, { amountCents: 5000, idempotencyKey: randomUUID() })).status).toBe(403);

    const key = randomUUID();
    const hi = await challenger.call("POST", `/auctions/${a.json.id}/bids`, { amountCents: 1200, idempotencyKey: key });
    expect(hi.status).toBe(200);
    const again = await challenger.call("POST", `/auctions/${a.json.id}/bids`, { amountCents: 1200, idempotencyKey: key });
    expect(again.json.replay).toBe(true);
  });

  it("closes on server time, picks the winner and lets only the winner check out at the winning price", async () => {
    const s = await seller();
    const p = await product(s, 1);
    const a = await s.call("POST", "/seller/auctions", { productId: p.id, startingPriceCents: 500, minIncrementCents: 50, durationSeconds: 30 });
    const w = await buyer();
    const other = await buyer();
    await other.call("POST", `/auctions/${a.json.id}/bids`, { amountCents: 500, idempotencyKey: randomUUID() });
    await w.call("POST", `/auctions/${a.json.id}/bids`, { amountCents: 650, idempotencyKey: randomUUID() });
    await prisma.auction.update({ where: { id: a.json.id }, data: { endsAt: new Date(Date.now() - 1000) } });
    await closeDueAuctions();
    const closed = await prisma.auction.findUniqueOrThrow({ where: { id: a.json.id } });
    expect(closed.status).toBe("ENDED");
    expect(closed.winnerId).toBe(w.userId);
    expect((await other.call("POST", `/auctions/${a.json.id}/checkout`, { address })).status).toBe(403);
    const co = await w.call("POST", `/auctions/${a.json.id}/checkout`, { address });
    expect(co.status).toBe(200);
    expect(co.json.orders[0].totalCents).toBe(650);
    expect((await w.call("POST", `/auctions/${a.json.id}/bids`, { amountCents: 9999, idempotencyKey: randomUUID() })).status).toBe(409);
  });
});

describe("AI gateway, metering and credit ledger", () => {
  beforeAll(async () => enableTestAi());

  async function scan(s: Awaited<ReturnType<typeof seller>>) {
    const a = await getApp();
    const mp = multipart([{ name: "item.png", data: PNG, type: "image/png" }]);
    const res = await a.inject({ method: "POST", url: "/seller/scans", payload: mp.payload, headers: { ...mp.headers, authorization: `Bearer ${s.token}` } });
    return { status: res.statusCode, json: JSON.parse(res.body) };
  }

  it("turns a photo into a draft, charges credits once and records provider cost", async () => {
    const s = await seller();
    const r = await scan(s);
    expect(r.status).toBe(200);
    const sc = r.json.scans[0];
    expect(sc.status).toBe("READY");
    expect(sc.draft.title).toBe("Ceramic coffee mug");
    expect(sc.draft.brand).toBeNull(); // low-confidence brand is never filled in
    expect(sc.draft.priceCents).toBeNull(); // seller must set the price
    expect(sc.result.questionsForSeller.length).toBeGreaterThan(0);
    expect(await creditBalance(prisma, s.sellerId)).toMatchObject({ total: 95 });
    const usage = await prisma.aiUsageRecord.findFirstOrThrow({ where: { scanId: sc.id, status: "SUCCEEDED" } });
    expect(usage.creditsCharged).toBe(5);
    expect(Number(usage.providerCostMicros)).toBe(2000); // 1000 in @ $1/MTok + 200 out @ $5/MTok
  });

  it("refuses to publish without a confirmed price, then publishes into the live menu", async () => {
    const s = await seller();
    const stream = await s.call("POST", "/seller/streams", { title: "Friday drop", mode: "HUMAN" });
    expect(stream.status).toBe(200);
    const sc = (await scan(s)).json.scans[0];
    const listing = { title: "Ceramic coffee mug", description: "A plain mug", condition: "GOOD", tags: ["mug"], priceCents: 1200, quantity: 2 };
    expect((await s.call("POST", `/seller/scans/${sc.id}/publish`, listing)).status).toBe(400);
    const pub = await s.call("POST", `/seller/scans/${sc.id}/publish`, { ...listing, priceConfirmed: true });
    expect(pub.status).toBe(200);
    expect(pub.json.addedToStreams).toBe(1);
    const view = await (await client())("GET", `/streams/${stream.json.id}`);
    expect(view.json.products.map((x: any) => x.productId)).toContain(pub.json.product.id);
    expect((await s.call("POST", `/seller/scans/${sc.id}/publish`, { ...listing, priceConfirmed: true })).status).toBe(409);
  });

  it("refunds credits when every provider fails", async () => {
    const s = await seller();
    testAi.fail = true;
    try {
      const r = await scan(s);
      expect(r.json.scans[0].status).toBe("FAILED");
    } finally {
      testAi.fail = false;
    }
    expect(await creditBalance(prisma, s.sellerId)).toMatchObject({ total: 100 });
    const kinds = (await prisma.aiCreditTransaction.findMany({ where: { sellerId: s.sellerId } })).map((t) => t.kind).sort();
    expect(kinds).toEqual(["ALLOWANCE_GRANT", "REFUND", "USAGE"]);
  });

  it("never overdraws credits under concurrent requests", async () => {
    const s = await seller();
    // leave 12 credits: enough for 2 scans at 5 credits
    await prisma.aiCreditTransaction.create({ data: { sellerId: s.sellerId, kind: "ADJUSTMENT", bucket: "allowance", amount: -88, idempotencyKey: `adj:${randomUUID()}` } });
    const rs = await Promise.all(Array.from({ length: 5 }, () => scan(s)));
    const ready = rs.flatMap((r) => r.json.scans ?? []).filter((x: any) => x.status === "READY");
    expect(ready.length).toBe(2);
    const bal = await creditBalance(prisma, s.sellerId);
    expect(bal.total).toBe(2);
    expect(bal.total).toBeGreaterThanOrEqual(0);
  });

  it("enforces plan features, the seller AI switch and the platform kill switch", async () => {
    const s = await seller();
    const st = await s.call("POST", "/seller/streams", { title: "Co-host test", mode: "HUMAN_AI_COHOST" });
    const ask = await s.call("POST", `/seller/streams/${st.json.id}/cohost/ask`, { question: "What sizes are left?" });
    expect(ask.status).toBe(402);
    expect(ask.json.details.reason).toBe("feature_not_in_plan");

    await s.call("PUT", "/seller/ai/enabled", { enabled: false });
    expect((await scan(s)).json.scans[0].errorDetails.reason).toBe("seller_ai_disabled");
    await s.call("PUT", "/seller/ai/enabled", { enabled: true });

    const adm = await admin();
    await adm.call("PATCH", "/admin/settings", { aiEmergencyDisabled: true });
    try {
      expect((await scan(s)).json.scans[0].errorDetails.reason).toBe("platform_disabled");
    } finally {
      await adm.call("PATCH", "/admin/settings", { aiEmergencyDisabled: false });
    }
    const denied = await prisma.aiUsageRecord.count({ where: { sellerId: s.sellerId, status: "DENIED" } });
    expect(denied).toBe(3);
  });

  it("upgrades a plan with a test payment, unlocks co-host, and grounds answers in real inventory", async () => {
    const s = await seller();
    const up = await s.call("POST", "/seller/ai/plan", { planKey: "pro" });
    expect(up.status).toBe(200);
    expect((await creditBalance(prisma, s.sellerId)).total).toBe(2000); // starter allowance expired, pro granted
    const p = await product(s, 3, 4500);
    const st = await s.call("POST", "/seller/streams", { title: "Live with AI", mode: "HUMAN_AI_COHOST", productIds: [p.id] });
    await s.call("POST", `/seller/streams/${st.json.id}/start`);
    await s.call("POST", `/seller/streams/${st.json.id}/pin`, { productId: p.id });
    const ask = await s.call("POST", `/seller/streams/${st.json.id}/cohost/ask`, { question: "How many are left?" });
    expect(ask.status).toBe(200);
    expect(testAi.lastPrompt).toContain('"inStock":3');
    expect(testAi.lastPrompt).toContain("$45.00");
    expect(ask.json.credits).toBe(1); // 0.25 min × 4 credits/min, rounded up

    // Public AI replies are off until the host enables them.
    const b = await buyer();
    const msg = await b.call("POST", `/streams/${st.json.id}/chat`, { body: "Is this in stock?" });
    expect((await s.call("POST", `/seller/streams/${st.json.id}/ai/respond`, { messageId: msg.json.id })).status).toBe(403);
    await s.call("PATCH", `/seller/streams/${st.json.id}/ai`, { aiPublicSpeech: true });
    const reply = await s.call("POST", `/seller/streams/${st.json.id}/ai/respond`, { messageId: msg.json.id });
    expect(reply.status).toBe(200);
    expect(reply.json.isAi).toBe(true);
  });

  it("buys credit packs idempotently and reports profitability from real records only", async () => {
    const s = await seller();
    const key = randomUUID();
    const r1 = await s.call("POST", "/seller/ai/credits/purchase", { packKey: "credits-1k", idempotencyKey: key });
    expect(r1.json.balance.total).toBe(1100);
    const r2 = await s.call("POST", "/seller/ai/credits/purchase", { packKey: "credits-1k", idempotencyKey: key });
    expect(r2.json.replay).toBe(true);
    expect((await creditBalance(prisma, s.sellerId)).total).toBe(1100);

    const adm = await admin();
    const real = await adm.call("GET", "/admin/ai/profitability");
    expect(real.status).toBe(200);
    expect(real.json.totals.revenueUsd).toBe(0); // all charges so far are test payments
    const withTest = await adm.call("GET", "/admin/ai/profitability?includeTest=true");
    expect(withTest.json.totals.revenueUsd).toBeGreaterThan(0);
    expect(withTest.json.totals.providerCostUsd).toBeGreaterThan(0);
    const providers = await adm.call("GET", "/admin/ai/providers");
    const anthropic = providers.json.find((p: any) => p.key === "anthropic");
    expect(anthropic.credentialConfigured).toBe(false);
    expect(JSON.stringify(providers.json)).not.toContain("test-key"); // secrets never leave the server
  });
});

describe("live menu and realtime-backed state", () => {
  it("includes approved products by default, hides items from viewers, and refuses stream buys for hidden items", async () => {
    const s = await seller();
    const p1 = await product(s, 2);
    const p2 = await product(s, 2);
    const st = await s.call("POST", "/seller/streams", { title: "Menu test", mode: "HUMAN" });
    expect(st.json.products.length).toBe(2);
    await s.call("PATCH", `/seller/streams/${st.json.id}/products/${p2.id}`, { hidden: true });
    const view = await (await client())("GET", `/streams/${st.json.id}`);
    expect(view.json.products.map((x: any) => x.productId)).toEqual([p1.id]);
    expect(view.json.viewers).toBe(0); // real socket count, never inflated
    expect(view.json.video.configured).toBe(false);
    const b = await buyer();
    const buy = await b.call("POST", "/buy-now", { variantId: p2.variants[0].id, quantity: 1, address, idempotencyKey: randomUUID(), streamId: st.json.id });
    expect(buy.status).toBe(409);
  });

  it("refuses video tokens when LiveKit is not configured", async () => {
    const s = await seller();
    const st = await s.call("POST", "/seller/streams", { title: "No video", mode: "HUMAN" });
    await s.call("POST", `/seller/streams/${st.json.id}/start`);
    const t = await s.call("GET", `/streams/${st.json.id}/video-token`);
    expect(t.status).toBe(503);
    expect(t.json.details.requiredEnv).toContain("LIVEKIT_API_KEY");
  });
});
