import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll } from "vitest";
import { prisma } from "../src/db";
import { address, admin, buyer, client, getApp, product, seller } from "./helpers";

const video = (creatorId: string) => prisma.video.create({ data: { creatorId, caption: `clip ${randomUUID().slice(0, 4)}`, mediaUrl: "/uploads/x.mp4", mime: "video/mp4", bytes: 10 } });

beforeAll(async () => {
  await getApp();
});

describe("report", () => {
  it("files one open report per person per item, and refuses your own content", async () => {
    const creator = await buyer();
    const viewer = await buyer();
    const v = await video(creator.userId);
    const r = await viewer.call("POST", "/reports", { targetType: "video", targetId: v.id, reason: "Spam" });
    expect(r.status).toBe(200);
    expect((await viewer.call("POST", "/reports", { targetType: "video", targetId: v.id, reason: "Spam again" })).json.alreadyReported).toBe(true);
    expect(await prisma.report.count({ where: { targetId: v.id, status: "OPEN" } })).toBe(1);
    expect((await creator.call("POST", "/reports", { targetType: "video", targetId: v.id, reason: "Mine" })).status).toBe(400);
    expect((await viewer.call("POST", "/reports", { targetType: "comment", targetId: "nope", reason: "Rude" })).status).toBe(404);
  });

  it("lets an admin remove reported content and suspend the poster", async () => {
    const creator = await buyer();
    const viewer = await buyer();
    const a = await admin();
    const v = await video(creator.userId);
    const c = await viewer.call("POST", `/videos/${v.id}/comments`, { body: "Something awful" });
    await creator.call("POST", "/reports", { targetType: "comment", targetId: c.json.id, reason: "Harassment" });

    const queue = await a.call("GET", "/admin/reports/open");
    const row = queue.json.find((g: any) => g.targetId === c.json.id);
    expect(row.preview).toMatchObject({ text: "Something awful", status: "VISIBLE" });

    expect((await viewer.call("GET", "/admin/reports/open")).status).toBe(403);
    expect((await a.call("POST", "/admin/reports/resolve", { targetType: "comment", targetId: c.json.id, action: "remove" })).json.resolved).toBe(1);
    expect((await prisma.videoComment.findUniqueOrThrow({ where: { id: c.json.id } })).hidden).toBe(true);

    await creator.call("POST", "/reports", { targetType: "user", targetId: viewer.userId, reason: "Keeps harassing me" });
    await a.call("POST", "/admin/reports/resolve", { targetType: "user", targetId: viewer.userId, action: "suspend_owner" });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: viewer.userId } })).status).toBe("SUSPENDED");
    const anon = await client();
    expect((await anon("POST", "/auth/refresh", { refreshToken: viewer.refreshToken })).status).toBe(401);
  });
});

describe("block", () => {
  it("hides each person's videos and comments from the other, and stops comments and follows", async () => {
    const a = await buyer();
    const b = await buyer();
    const bystander = await buyer();
    const vb = await video(b.userId);
    const va = await video(a.userId);
    await b.call("POST", `/videos/${va.id}/comments`, { body: "hi from b" });
    await a.call("POST", `/users/${b.userId}/follow`);

    const handleB = `u_${b.tag}`;
    expect((await a.call("POST", `/users/${handleB}/block`)).json.blocked).toBe(true);
    expect(await prisma.follow.count({ where: { followerId: a.userId, followeeId: b.userId } })).toBe(0);

    // a no longer sees b, and b no longer sees a.
    expect((await a.call("GET", `/videos/${vb.id}`)).status).toBe(404);
    expect((await b.call("GET", `/videos/${va.id}`)).status).toBe(404);
    expect((await a.call("GET", `/users/${handleB}/videos`)).json).toEqual([]);
    expect((await a.call("GET", `/videos/${va.id}/comments`)).json.map((c: any) => c.body)).not.toContain("hi from b");
    expect((await b.call("POST", `/videos/${va.id}/comments`, { body: "again" })).status).toBe(403);
    expect((await b.call("POST", `/users/${a.userId}/follow`)).status).toBe(409);
    const feed = await a.call("GET", "/videos/feed?tab=foryou");
    expect(feed.json.videos.map((v: any) => v.id)).not.toContain(vb.id);
    expect((await a.call("GET", "/me")).json.blockedUserIds).toEqual([b.userId]);
    expect((await a.call("GET", `/users/${handleB}`)).json).toMatchObject({ blockedByMe: true, blocked: true });

    // Everyone else is unaffected.
    expect((await bystander.call("GET", `/videos/${vb.id}`)).status).toBe(200);
    expect((await bystander.call("GET", `/videos/${va.id}/comments`)).json.map((c: any) => c.body)).toContain("hi from b");

    expect((await a.call("DELETE", `/users/${handleB}/block`)).json.blocked).toBe(false);
    expect((await a.call("GET", `/videos/${vb.id}`)).status).toBe(200);
  });
});

describe("delete account", () => {
  it("needs the password, waits for open orders, then erases personal details but keeps orders", async () => {
    const s = await seller();
    const p = await product(s);
    const b = await buyer();
    const order = await b.call("POST", "/buy-now", { variantId: p.variants[0].id, quantity: 1, address, idempotencyKey: randomUUID() });
    expect(order.status).toBe(200);

    expect((await b.call("DELETE", "/me", { confirm: "DELETE" })).status).toBe(403);
    expect((await b.call("DELETE", "/me", { confirm: "DELETE", password: "wrong-password-here" })).status).toBe(403);
    const blocked = await b.call("DELETE", "/me", { confirm: "DELETE", password: "correct-horse-battery" });
    expect(blocked.status).toBe(409);
    expect(blocked.json.message).toContain("still on the way");
    expect((await s.call("DELETE", "/me", { confirm: "DELETE", password: "correct-horse-battery" })).status).toBe(409);

    await prisma.order.updateMany({ where: { buyerId: b.userId }, data: { status: "DELIVERED" } });
    const v = await video(b.userId);
    expect((await b.call("DELETE", "/me", { confirm: "DELETE", password: "correct-horse-battery" })).json.deleted).toBe(true);

    const gone = await prisma.user.findUniqueOrThrow({ where: { id: b.userId } });
    expect(gone).toMatchObject({ status: "DELETED", displayName: "Deleted user", passwordHash: null, avatarUrl: null });
    expect(gone.email).not.toContain(b.tag);
    expect(await prisma.order.count({ where: { buyerId: b.userId } })).toBe(1);
    expect((await prisma.video.findUniqueOrThrow({ where: { id: v.id } })).status).toBe("REMOVED");
    expect(await prisma.session.count({ where: { userId: b.userId, revokedAt: null } })).toBe(0);

    const anon = await client();
    expect((await anon("POST", "/auth/login", { email: `${b.tag}@test.dev`, password: "correct-horse-battery" })).status).toBe(401);
    expect((await anon("POST", "/auth/refresh", { refreshToken: b.refreshToken })).status).toBe(401);
    expect(await prisma.auditLog.count({ where: { action: "account.delete", targetId: b.userId } })).toBe(1);
  });

});
