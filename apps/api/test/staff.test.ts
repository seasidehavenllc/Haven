import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll } from "vitest";
import { prisma } from "../src/db";
import { address, admin, buyer, getApp, product, seller } from "./helpers";

beforeAll(async () => {
  await getApp();
});

async function staffMember(role: "MANAGER" | "SUPPORT") {
  const owner = await admin();
  const person = await buyer();
  const email = `${person.tag}@test.dev`;
  const look = await owner.call("GET", `/admin/staff/lookup?email=${encodeURIComponent(email)}`);
  expect(look.json.handle).toBe(`u_${person.tag}`);
  const r = await owner.call("POST", "/admin/staff", { email, role });
  expect(r.status).toBe(200);
  return { ...person, owner };
}

async function paidOrder(priceCents: number) {
  const s = await seller();
  const p = await product(s, 5, priceCents);
  const b = await buyer();
  const r = await b.call("POST", "/buy-now", { variantId: p.variants[0].id, quantity: 1, address, idempotencyKey: randomUUID() });
  expect(r.status).toBe(200);
  return { order: r.json.orders[0], buyer: b, seller: s, variantId: p.variants[0].id };
}

describe("staff roles", () => {
  it("only the owner can assign roles, and the role works without signing in again", async () => {
    const m = await staffMember("MANAGER");
    // Same token as before the role was given.
    expect((await m.call("GET", "/admin/me")).json).toMatchObject({ role: "MANAGER" });
    expect((await m.call("GET", "/admin/staff")).status).toBe(403);
    expect((await m.call("POST", "/admin/staff", { email: `${m.tag}@test.dev`, role: "OWNER" })).status).toBe(403);
    const log = await m.owner.call("GET", `/admin/audit?targetId=${m.userId}`);
    expect(log.json.some((e: any) => e.action === "staff.role.set")).toBe(true);

    // Taking the role away works at once too.
    expect((await m.owner.call("DELETE", `/admin/staff/${m.userId}`)).status).toBe(200);
    expect((await m.call("GET", "/admin/overview")).status).toBe(403);
  });

  it("refuses an email with no account, and the owner's own role", async () => {
    const owner = await admin();
    expect((await owner.call("POST", "/admin/staff", { email: "nobody-here@test.dev", role: "SUPPORT" })).status).toBe(404);
    expect((await owner.call("POST", "/admin/staff", { email: `${owner.tag}@test.dev`, role: "SUPPORT" })).status).toBe(400);
  });

  it("ordinary users can't reach any admin route", async () => {
    const b = await buyer();
    for (const url of ["/admin/overview", "/admin/users", "/admin/orders", "/admin/settings", "/admin/audit", "/admin/reports/open"]) expect((await b.call("GET", url)).status).toBe(403);
    expect((await b.call("GET", "/admin/me")).json.role).toBe(null);
  });
});

describe("manager", () => {
  it("runs moderation and sellers, but not money, bans, staff or the audit log", async () => {
    const m = await staffMember("MANAGER");
    const s = await seller();
    expect((await m.call("PATCH", `/admin/sellers/${s.sellerId}`, { status: "SUSPENDED" })).status).toBe(200);
    expect((await m.call("GET", "/admin/reports/open")).status).toBe(200);

    const target = await buyer();
    expect((await m.call("PATCH", `/admin/users/${target.userId}`, { status: "SUSPENDED" })).status).toBe(200);
    expect((await m.call("PATCH", `/admin/users/${target.userId}`, { status: "BANNED" })).status).toBe(403);

    for (const url of ["/admin/settings", "/admin/ai/providers", "/admin/ai/profitability", "/admin/audit", "/admin/staff"]) expect((await m.call("GET", url)).status).toBe(403);
    expect((await m.call("PATCH", "/admin/settings", { marketplaceFeeBps: 0 })).status).toBe(403);

    const o = await m.call("GET", "/admin/overview");
    expect(o.json.users).toBeGreaterThan(0);
    expect(o.json.gmvUsd).toBeUndefined();
  });

  it("can't touch another staff member's account", async () => {
    const m = await staffMember("MANAGER");
    const sup = await staffMember("SUPPORT");
    expect((await m.call("PATCH", `/admin/users/${sup.userId}`, { status: "SUSPENDED" })).status).toBe(403);
  });

  it("sees emails and addresses masked", async () => {
    const m = await staffMember("MANAGER");
    const { order, buyer: b } = await paidOrder(1500);
    const list = await m.call("GET", `/admin/users?q=u_${b.tag}`);
    expect(list.json[0].email).toContain("•••");
    expect(list.json[0].email).not.toContain(b.tag);
    const detail = await m.call("GET", `/admin/orders/${order.id}`);
    expect(detail.json.shippingAddress.line1).toBe("•••");
    expect(detail.json.shippingAddress.city).toBe(address.city);
    expect(detail.json.platformFeeCents).toBeUndefined();
  });
});

describe("customer support", () => {
  it("looks up people and orders with full contact details, but can't moderate or suspend", async () => {
    const sup = await staffMember("SUPPORT");
    const { order, buyer: b } = await paidOrder(1500);
    const found = await sup.call("GET", `/admin/orders?q=${b.tag}@test.dev`);
    expect(found.json.map((o: any) => o.id)).toContain(order.id);
    expect((await sup.call("GET", `/admin/orders/${order.id}`)).json.shippingAddress.line1).toBe(address.line1);
    expect((await sup.call("GET", `/admin/users/${b.userId}`)).json.email).toBe(`${b.tag}@test.dev`);

    expect((await sup.call("PATCH", `/admin/users/${b.userId}`, { status: "SUSPENDED" })).status).toBe(403);
    expect((await sup.call("POST", "/admin/reports/resolve", { targetType: "user", targetId: b.userId, action: "dismiss" })).status).toBe(403);
    expect((await sup.call("GET", "/admin/streams")).status).toBe(403);
  });

  it("messages a customer, and the message is logged", async () => {
    const sup = await staffMember("SUPPORT");
    const b = await buyer();
    expect((await sup.call("POST", `/admin/users/${b.userId}/message`, { body: "Your package is on its way." })).status).toBe(200);
    expect(await prisma.notification.count({ where: { userId: b.userId, type: "support.message" } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { actorId: sup.userId, action: "admin.user.message", targetId: b.userId } })).toBe(1);
  });

  it("refunds up to the role's limit per order, and the owner can go further", async () => {
    const sup = await staffMember("SUPPORT");
    await prisma.platformSettings.upsert({ where: { id: "global" }, update: { supportRefundLimitCents: 10000 }, create: { id: "global", supportRefundLimitCents: 10000 } });
    const { order, variantId } = await paidOrder(25000);

    expect((await sup.call("POST", `/admin/orders/${order.id}/refund`, { amountCents: 6000, reason: "Arrived damaged" })).status).toBe(200);
    // 6000 + 6000 is over the 10000 limit for this order.
    const over = await sup.call("POST", `/admin/orders/${order.id}/refund`, { amountCents: 6000, reason: "More damage" });
    expect(over.status).toBe(403);
    expect((await sup.call("GET", `/admin/orders/${order.id}`)).json.refundableCents).toBe(4000);

    // The owner can refund the rest, and can't refund past the total.
    expect((await sup.owner.call("POST", `/admin/orders/${order.id}/refund`, { amountCents: 25000, reason: "Too much" })).status).toBe(400);
    const stock = (await prisma.productVariant.findUniqueOrThrow({ where: { id: variantId } })).quantity;
    const rest = await sup.owner.call("POST", `/admin/orders/${order.id}/refund`, { amountCents: 19000, reason: "Full refund", restock: true });
    expect(rest.json.fullyRefunded).toBe(true);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("REFUNDED");
    expect((await prisma.productVariant.findUniqueOrThrow({ where: { id: variantId } })).quantity).toBe(stock + 1);
    expect(await prisma.auditLog.count({ where: { action: "admin.order.refund", targetId: order.id } })).toBe(2);
  });
});

describe("owner", () => {
  it("sees finances and the audit log, and can't remove the last owner", async () => {
    const owner = await admin();
    expect((await owner.call("GET", "/admin/overview")).json.gmvUsd).toBeTypeOf("number");
    expect((await owner.call("GET", "/admin/audit")).status).toBe(200);
    expect((await owner.call("PATCH", "/admin/settings", { supportRefundLimitUsd: 75 })).status).toBe(200);
    expect((await prisma.platformSettings.findUniqueOrThrow({ where: { id: "global" } })).supportRefundLimitCents).toBe(7500);
    expect((await owner.call("DELETE", `/admin/staff/${owner.userId}`)).status).toBe(400);
  });
});
