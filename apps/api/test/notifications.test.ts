import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/db";
import { buyer, getApp, product, seller } from "./helpers";
import { closeDueAuctions } from "../src/modules/auctions";
import { notify } from "../src/notify";

beforeAll(async () => {
  await getApp();
});
afterEach(() => vi.unstubAllGlobals());

const settle = () => new Promise((r) => setTimeout(r, 50));

describe("notifications", () => {
  it("lists, counts and marks notifications read for the owner only", async () => {
    const a = await buyer();
    const b = await buyer();
    await notify([
      { userId: a.userId, type: "order.shipped", title: "One" },
      { userId: a.userId, type: "order.shipped", title: "Two" },
      { userId: b.userId, type: "order.shipped", title: "Other user" },
    ]);
    expect((await a.call("GET", "/notifications/unread-count")).json.count).toBe(2);
    const list = await a.call("GET", "/notifications");
    expect(list.json.map((n: any) => n.title).sort()).toEqual(["One", "Two"]);

    // b can't mark a's notification read
    await b.call("POST", "/notifications/read", { ids: [list.json[0].id] });
    expect((await a.call("GET", "/notifications/unread-count")).json.count).toBe(2);

    await a.call("POST", "/notifications/read", { ids: [list.json[0].id] });
    expect((await a.call("GET", "/notifications/unread-count")).json.count).toBe(1);
    await a.call("POST", "/notifications/read", {});
    expect((await a.call("GET", "/notifications/unread-count")).json.count).toBe(0);
    expect((await b.call("GET", "/notifications/unread-count")).json.count).toBe(1);
  });

  it("respects muted types but never mutes transactional ones", async () => {
    const u = await buyer();
    const prefs = await u.call("GET", "/me/notification-preferences");
    expect(prefs.json).toMatchObject({ push: true, email: true, mutedTypes: [] });
    expect((await u.call("PUT", "/me/notification-preferences", { push: true, email: false, mutedTypes: ["order.new"] })).status).toBe(400);
    expect((await u.call("PUT", "/me/notification-preferences", { push: true, email: false, mutedTypes: ["stream.live"] })).status).toBe(200);
    await notify([
      { userId: u.userId, type: "stream.live", title: "Muted" },
      { userId: u.userId, type: "order.shipped", title: "Kept" },
    ]);
    const list = await u.call("GET", "/notifications");
    expect(list.json.map((n: any) => n.title)).toEqual(["Kept"]);
  });

  it("registers Expo push devices, sends pushes, and drops tokens Expo reports dead", async () => {
    const u = await buyer();
    const good = `ExponentPushToken[${randomUUID().slice(0, 12)}]`;
    const dead = `ExponentPushToken[${randomUUID().slice(0, 12)}]`;
    expect((await u.call("POST", "/me/push-devices", { token: "not-a-token", platform: "ios" })).status).toBe(400);
    expect((await u.call("POST", "/me/push-devices", { token: good, platform: "ios" })).status).toBe(200);
    expect((await u.call("POST", "/me/push-devices", { token: dead, platform: "android" })).status).toBe(200);

    const sent: any[] = [];
    vi.stubGlobal("fetch", async (url: string, init: any) => {
      expect(url).toBe("https://exp.host/--/api/v2/push/send");
      const batch = JSON.parse(init.body);
      sent.push(...batch);
      const data = batch.map((m: any) => (m.to === dead ? { status: "error", details: { error: "DeviceNotRegistered" } } : { status: "ok", id: "x" }));
      return new Response(JSON.stringify({ data }), { status: 200 });
    });
    await notify({ userId: u.userId, type: "order.shipped", title: "Shipped", body: "USPS 123", link: "/orders" });
    await settle();
    expect(sent.map((m) => m.to).sort()).toEqual([good, dead].sort());
    expect(sent[0]).toMatchObject({ title: "Shipped", body: "USPS 123", data: { link: "/orders", type: "order.shipped" } });
    const left = await prisma.pushDevice.findMany({ where: { userId: u.userId } });
    expect(left.map((d) => d.token)).toEqual([good]);

    // Turning push off stops pushes but the inbox still gets the notification.
    sent.length = 0;
    await u.call("PUT", "/me/notification-preferences", { push: false, email: true, mutedTypes: [] });
    await notify({ userId: u.userId, type: "order.shipped", title: "Again" });
    await settle();
    expect(sent).toHaveLength(0);
    expect((await u.call("GET", "/notifications/unread-count")).json.count).toBe(2);

    expect((await u.call("DELETE", `/me/push-devices/${encodeURIComponent(good)}`)).status).toBe(200);
    expect(await prisma.pushDevice.count({ where: { userId: u.userId } })).toBe(0);
  });

  it("notifies the outbid bidder and the auction winner, and the seller on a new order", async () => {
    const s = await seller();
    const p = await product(s, 1);
    const a = await s.call("POST", "/seller/auctions", { productId: p.id, startingPriceCents: 500, minIncrementCents: 50, durationSeconds: 30 });
    const first = await buyer();
    const second = await buyer();
    await first.call("POST", `/auctions/${a.json.id}/bids`, { amountCents: 500, idempotencyKey: randomUUID() });
    await second.call("POST", `/auctions/${a.json.id}/bids`, { amountCents: 600, idempotencyKey: randomUUID() });
    const outbid = (await first.call("GET", "/notifications")).json;
    expect(outbid.map((n: any) => n.type)).toEqual(["auction.outbid"]);
    expect(outbid[0].data).toEqual({ auctionId: a.json.id });

    await prisma.auction.update({ where: { id: a.json.id }, data: { endsAt: new Date(Date.now() - 1000) } });
    await closeDueAuctions();
    expect((await second.call("GET", "/notifications")).json.map((n: any) => n.type)).toEqual(["auction.won"]);

    await second.call("POST", `/auctions/${a.json.id}/checkout`, { address: { name: "T", line1: "1 Main", city: "X", region: "IL", postalCode: "62701", country: "US" } });
    const sellerInbox = (await s.call("GET", "/notifications")).json;
    expect(sellerInbox.some((n: any) => n.type === "order.new")).toBe(true);
  });
});
