import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db";
import { requireStaff, requireUser, verifyPassword } from "../lib/auth";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors";
import { parse } from "../lib/validate";
import { audit } from "../lib/audit";
import { emit } from "../realtime";
import { notify } from "../notify";

/**
 * Safety tools the App Store requires for apps with user content: report, block, and delete
 * your own account. Moderators act on reports in Admin → Reports.
 */

export const REPORT_TARGETS = ["video", "comment", "stream", "chat", "user", "product"] as const;
type Target = (typeof REPORT_TARGETS)[number];

/** Everyone this person has blocked or been blocked by. Content between them is hidden both ways. */
export async function blockedIds(userId: string | null | undefined): Promise<string[]> {
  if (!userId) return [];
  const rows = await prisma.userBlock.findMany({ where: { OR: [{ blockerId: userId }, { blockedId: userId }] }, select: { blockerId: true, blockedId: true } });
  return [...new Set(rows.map((r) => (r.blockerId === userId ? r.blockedId : r.blockerId)))];
}

export async function isBlockedBetween(a: string, b: string) {
  return !!(await prisma.userBlock.findFirst({ where: { OR: [{ blockerId: a, blockedId: b }, { blockerId: b, blockedId: a }] }, select: { blockerId: true } }));
}

/** Who owns a reported thing, or null if it doesn't exist. */
async function ownerOf(type: Target, id: string): Promise<string | null | undefined> {
  switch (type) {
    case "video":
      return (await prisma.video.findUnique({ where: { id }, select: { creatorId: true } }))?.creatorId;
    case "comment":
      return (await prisma.videoComment.findUnique({ where: { id }, select: { userId: true } }))?.userId;
    case "chat": {
      const m = await prisma.streamChatMessage.findUnique({ where: { id }, select: { userId: true, stream: { select: { seller: { select: { userId: true } } } } } });
      return m ? (m.userId ?? m.stream.seller.userId) : undefined;
    }
    case "stream":
      return (await prisma.livestream.findUnique({ where: { id }, select: { seller: { select: { userId: true } } } }))?.seller.userId;
    case "product":
      return (await prisma.product.findUnique({ where: { id }, select: { seller: { select: { userId: true } } } }))?.seller.userId;
    case "user":
      return (await prisma.user.findUnique({ where: { id }, select: { id: true } }))?.id;
  }
}

/** Orders that still have money or goods in motion. An account can't be deleted until these finish. */
const OPEN_ORDER: ("PAID" | "FULFILLING" | "SHIPPED")[] = ["PAID", "FULFILLING", "SHIPPED"];

export async function safetyRoutes(app: FastifyInstance) {
  // ── Report ──
  app.post("/reports", { config: { rateLimit: { max: 20, timeWindow: "10 minutes" } } }, async (req) => {
    const u = requireUser(req);
    const b = parse(z.object({ targetType: z.enum(REPORT_TARGETS), targetId: z.string().min(1).max(100), reason: z.string().trim().min(3).max(500) }), req.body);
    const owner = await ownerOf(b.targetType, b.targetId);
    if (owner === undefined) throw notFound("That item");
    if (owner === u.id) throw badRequest("You can't report your own content");
    const dup = await prisma.report.findFirst({ where: { reporterId: u.id, targetType: b.targetType, targetId: b.targetId, status: "OPEN" } });
    if (dup) return { ok: true, alreadyReported: true };
    await prisma.report.create({ data: { reporterId: u.id, targetType: b.targetType, targetId: b.targetId, reason: b.reason } });
    return { ok: true };
  });

  // ── Block ──
  app.get("/me/blocks", async (req) => {
    const u = requireUser(req);
    const rows = await prisma.userBlock.findMany({ where: { blockerId: u.id }, orderBy: { createdAt: "desc" }, include: { blocked: { select: { id: true, handle: true, displayName: true, avatarUrl: true } } } });
    return rows.map((r) => ({ ...r.blocked, blockedAt: r.createdAt }));
  });

  app.post("/users/:handle/block", async (req) => {
    const u = requireUser(req);
    const target = await prisma.user.findUnique({ where: { handle: (req.params as { handle: string }).handle }, select: { id: true } });
    if (!target) throw notFound("User");
    if (target.id === u.id) throw badRequest("You can't block yourself");
    await prisma.$transaction([
      prisma.userBlock.upsert({ where: { blockerId_blockedId: { blockerId: u.id, blockedId: target.id } }, update: {}, create: { blockerId: u.id, blockedId: target.id } }),
      // Blocking ends any follow between the two people.
      prisma.follow.deleteMany({ where: { OR: [{ followerId: u.id, followeeId: target.id }, { followerId: target.id, followeeId: u.id }] } }),
    ]);
    return { blocked: true };
  });

  app.delete("/users/:handle/block", async (req) => {
    const u = requireUser(req);
    const target = await prisma.user.findUnique({ where: { handle: (req.params as { handle: string }).handle }, select: { id: true } });
    if (!target) throw notFound("User");
    await prisma.userBlock.deleteMany({ where: { blockerId: u.id, blockedId: target.id } });
    return { blocked: false };
  });

  // ── Delete my account ──
  app.delete("/me", { config: { rateLimit: { max: 5, timeWindow: "10 minutes" } } }, async (req) => {
    const u = requireUser(req);
    const b = parse(z.object({ confirm: z.literal("DELETE"), password: z.string().max(200).optional() }), req.body ?? {});
    const user = await prisma.user.findUniqueOrThrow({ where: { id: u.id }, include: { seller: true } });
    if (user.status === "DELETED") throw notFound("Account");
    if (user.passwordHash && !(b.password && (await verifyPassword(b.password, user.passwordHash)))) throw forbidden("Enter your password to delete your account");
    if (user.staffRole === "OWNER") {
      const owners = await prisma.user.count({ where: { staffRole: "OWNER", status: "ACTIVE" } });
      if (owners <= 1) throw conflict("You're the only owner. Make someone else an owner in Admin → Staff before deleting this account.");
    }
    const [buying, selling] = await Promise.all([
      prisma.order.count({ where: { buyerId: u.id, status: { in: OPEN_ORDER } } }),
      user.seller ? prisma.order.count({ where: { sellerId: user.seller.id, status: { in: OPEN_ORDER } } }) : 0,
    ]);
    if (buying || selling)
      throw conflict(
        `You have ${buying + selling} order${buying + selling === 1 ? "" : "s"} still on the way (${[buying && `${buying} you bought`, selling && `${selling} you sold`].filter(Boolean).join(", ")}). Delete your account after they're delivered.`,
        { buying, selling },
      );

    const tag = u.id.slice(-10);
    const now = new Date();
    await prisma.$transaction(async (tx) => {
      // Erase personal details. Orders, payments and ledgers keep pointing at this row for the records,
      // but nothing left on it identifies the person.
      await tx.user.update({
        where: { id: u.id },
        data: { status: "DELETED", deletedAt: now, email: `deleted-${tag}@deleted.invalid`, handle: `deleted-${tag}`, displayName: "Deleted user", avatarUrl: null, bio: null, passwordHash: null },
      });
      await tx.session.updateMany({ where: { userId: u.id, revokedAt: null }, data: { revokedAt: now } });
      await tx.oAuthAccount.deleteMany({ where: { userId: u.id } });
      await tx.pushDevice.deleteMany({ where: { userId: u.id } });
      await tx.address.deleteMany({ where: { userId: u.id } });
      // Seller applications hold a legal name, phone, birth date and address.
      await tx.sellerApplication.deleteMany({ where: { userId: u.id } });
      await tx.wishlistItem.deleteMany({ where: { userId: u.id } });
      await tx.follow.deleteMany({ where: { OR: [{ followerId: u.id }, { followeeId: u.id }] } });
      await tx.userBlock.deleteMany({ where: { OR: [{ blockerId: u.id }, { blockedId: u.id }] } });
      await tx.notification.deleteMany({ where: { userId: u.id } });
      await tx.cart.deleteMany({ where: { userId: u.id } });
      await tx.video.updateMany({ where: { creatorId: u.id, status: "READY" }, data: { status: "REMOVED", removedReason: "Account deleted" } });
      await tx.videoComment.updateMany({ where: { userId: u.id }, data: { hidden: true } });
      await tx.streamChatMessage.updateMany({ where: { userId: u.id }, data: { hidden: true } });
      if (user.seller) {
        await tx.product.updateMany({ where: { sellerId: user.seller.id, status: { in: ["ACTIVE", "DRAFT"] } }, data: { status: "ARCHIVED" } });
        await tx.livestream.updateMany({ where: { sellerId: user.seller.id, status: { in: ["SCHEDULED", "LIVE", "PAUSED"] } }, data: { status: "ENDED" } });
        await tx.sellerSubscription.updateMany({ where: { sellerId: user.seller.id }, data: { status: "CANCELLED" } });
      }
    });
    await audit(prisma, { actorId: u.id, action: "account.delete", targetType: "user", targetId: u.id, ip: req.ip, data: { hadSeller: !!user.seller } });
    return { deleted: true };
  });

  // ── Moderation (Admin → Reports) ──
  app.get("/admin/reports/open", async (req) => {
    await requireStaff(req, "reports.view");
    const reports = await prisma.report.findMany({ where: { status: "OPEN" }, orderBy: { createdAt: "asc" }, take: 200, include: { reporter: { select: { handle: true } } } });
    // Group by target so a moderator sees one row per reported thing, with what it actually is.
    const groups = new Map<string, { targetType: string; targetId: string; reports: typeof reports }>();
    for (const r of reports) {
      const k = `${r.targetType}:${r.targetId}`;
      if (!groups.has(k)) groups.set(k, { targetType: r.targetType, targetId: r.targetId, reports: [] });
      groups.get(k)!.reports.push(r);
    }
    return Promise.all(
      [...groups.values()].map(async (g) => ({
        targetType: g.targetType,
        targetId: g.targetId,
        firstReportedAt: g.reports[0].createdAt,
        reports: g.reports.map((r) => ({ id: r.id, reason: r.reason, reporter: r.reporter.handle, createdAt: r.createdAt })),
        preview: await preview(g.targetType as Target, g.targetId),
      })),
    );
  });

  app.post("/admin/reports/resolve", async (req) => {
    const admin = await requireStaff(req, "content.moderate");
    const b = parse(z.object({ targetType: z.enum(REPORT_TARGETS), targetId: z.string(), action: z.enum(["remove", "suspend_owner", "dismiss"]), note: z.string().trim().max(300).optional() }), req.body);
    const owner = await ownerOf(b.targetType, b.targetId);
    if (owner === undefined) throw notFound("That item");
    const reason = b.note || "Removed after a report for breaking Haven's rules";
    if (b.action === "remove") {
      switch (b.targetType) {
        case "video":
          await prisma.video.update({ where: { id: b.targetId }, data: { status: "REMOVED", removedReason: reason } });
          break;
        case "comment": {
          const c = await prisma.videoComment.findUniqueOrThrow({ where: { id: b.targetId } });
          if (!c.hidden) await prisma.$transaction([prisma.videoComment.update({ where: { id: c.id }, data: { hidden: true } }), prisma.video.update({ where: { id: c.videoId }, data: { commentCount: { decrement: 1 } } })]);
          break;
        }
        case "chat": {
          const m = await prisma.streamChatMessage.update({ where: { id: b.targetId }, data: { hidden: true } });
          emit(`stream:${m.streamId}`, "stream:chat", { id: m.id, hidden: true });
          break;
        }
        case "product":
          await prisma.product.update({ where: { id: b.targetId }, data: { status: "REMOVED" } });
          break;
        case "stream":
          await prisma.livestream.update({ where: { id: b.targetId }, data: { status: "ENDED" } });
          emit(`stream:${b.targetId}`, "stream:status", { status: "ENDED" });
          break;
        case "user":
          throw badRequest("To act on a person, suspend them instead");
      }
      if (owner) await notify({ userId: owner, type: b.targetType === "video" ? "moderation.video_removed" : "moderation.product_removed", title: "Something you posted was removed", body: reason });
    }
    if (b.action === "suspend_owner") {
      if (!owner) throw badRequest("This item has no owner to suspend");
      const target = await prisma.user.findUniqueOrThrow({ where: { id: owner } });
      if (target.staffRole) throw forbidden("Staff accounts can't be suspended here. The owner manages them in Admin → Staff.");
      await prisma.$transaction([
        prisma.user.update({ where: { id: owner }, data: { status: "SUSPENDED" } }),
        prisma.session.updateMany({ where: { userId: owner, revokedAt: null }, data: { revokedAt: new Date() } }),
      ]);
    }
    const n = await prisma.report.updateMany({ where: { targetType: b.targetType, targetId: b.targetId, status: "OPEN" }, data: { status: b.action === "dismiss" ? "DISMISSED" : "ACTIONED", resolvedAt: new Date(), resolvedBy: admin.id } });
    await audit(prisma, { actorId: admin.id, action: `moderation.report.${b.action}`, targetType: b.targetType, targetId: b.targetId, data: { reports: n.count, owner, note: b.note } });
    return { ok: true, resolved: n.count };
  });
}

async function preview(type: Target, id: string) {
  switch (type) {
    case "video": {
      const v = await prisma.video.findUnique({ where: { id }, select: { caption: true, status: true, posterUrl: true, creator: { select: { handle: true } } } });
      return v && { text: v.caption || "(no caption)", by: v.creator.handle, status: v.status, image: v.posterUrl, link: `/videos/${id}` };
    }
    case "comment": {
      const c = await prisma.videoComment.findUnique({ where: { id }, select: { body: true, hidden: true, videoId: true, user: { select: { handle: true } } } });
      return c && { text: c.body, by: c.user.handle, status: c.hidden ? "REMOVED" : "VISIBLE", link: `/videos/${c.videoId}` };
    }
    case "chat": {
      const m = await prisma.streamChatMessage.findUnique({ where: { id }, select: { body: true, hidden: true, streamId: true, user: { select: { handle: true } } } });
      return m && { text: m.body, by: m.user?.handle ?? "AI host", status: m.hidden ? "REMOVED" : "VISIBLE", link: `/live/${m.streamId}` };
    }
    case "stream": {
      const s = await prisma.livestream.findUnique({ where: { id }, select: { title: true, status: true, seller: { select: { user: { select: { handle: true } } } } } });
      return s && { text: s.title, by: s.seller.user.handle, status: s.status, link: `/live/${id}` };
    }
    case "product": {
      const p = await prisma.product.findUnique({ where: { id }, select: { title: true, status: true, seller: { select: { user: { select: { handle: true } } } } } });
      return p && { text: p.title, by: p.seller.user.handle, status: p.status, link: `/p/${id}` };
    }
    case "user": {
      const u = await prisma.user.findUnique({ where: { id }, select: { handle: true, displayName: true, bio: true, status: true } });
      return u && { text: `${u.displayName}${u.bio ? `: ${u.bio}` : ""}`, by: u.handle, status: u.status, link: `/u/${u.handle}` };
    }
  }
}
