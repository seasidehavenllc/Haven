import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { RolePermissions, StaffRoleInfo, StaffRoles, can, type StaffRole } from "@haven/shared";
import { prisma } from "../db";
import { requireStaff, requireUser } from "../lib/auth";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors";
import { parse } from "../lib/validate";
import { audit } from "../lib/audit";
import { notify } from "../notify";
import { refundPayment } from "../payments";
import { emit } from "../realtime";
import { maskEmail } from "./admin";

/** Largest total refund on one order this role can give, in cents. Null means no limit. */
export async function refundLimitCents(role: StaffRole): Promise<number | null> {
  if (role === "OWNER") return null;
  const s = await prisma.platformSettings.upsert({ where: { id: "global" }, update: {}, create: { id: "global" } });
  return role === "MANAGER" ? s.managerRefundLimitCents : s.supportRefundLimitCents;
}

/** Show the city, region and country; hide the name, street and postcode. */
function maskAddress(a: any) {
  if (!a || typeof a !== "object") return null;
  return { name: a.name ? `${String(a.name).slice(0, 1)}•••` : null, line1: "•••", line2: null, city: a.city ?? null, region: a.region ?? null, postalCode: "•••", country: a.country ?? null, masked: true };
}
const maskRef = (ref: string | null | undefined) => (ref ? `•••${ref.slice(-4)}` : null);

export async function staffRoutes(app: FastifyInstance) {
  // ── What the signed-in person can see in the admin panel ──
  app.get("/admin/me", async (req) => {
    const u = requireUser(req);
    const user = await prisma.user.findUnique({ where: { id: u.id }, select: { staffRole: true, status: true } });
    if (!user?.staffRole || user.status !== "ACTIVE") return { role: null, permissions: [], refundLimitCents: 0 };
    return { role: user.staffRole, permissions: RolePermissions[user.staffRole], refundLimitCents: await refundLimitCents(user.staffRole) };
  });

  // ── Staff: the owner gives and takes away roles by email ──
  app.get("/admin/staff", async (req) => {
    await requireStaff(req, "staff.manage");
    return prisma.user.findMany({ where: { staffRole: { not: null } }, select: { id: true, email: true, handle: true, displayName: true, staffRole: true, status: true }, orderBy: { createdAt: "asc" } });
  });

  /**
   * Find the account for an email so the owner can check it's the right person before giving a role.
   * Emails aren't verified at sign-up, so the owner confirms the handle and name, not just the email.
   */
  app.get("/admin/staff/lookup", async (req) => {
    await requireStaff(req, "staff.manage");
    const { email } = parse(z.object({ email: z.string().trim().toLowerCase().email() }), req.query);
    const u = await prisma.user.findUnique({ where: { email }, select: { id: true, email: true, handle: true, displayName: true, staffRole: true, status: true, createdAt: true } });
    if (!u || u.status === "DELETED") throw notFound("No Haven account uses this email yet. Ask them to sign up in the app first");
    return u;
  });

  app.post("/admin/staff", async (req) => {
    const owner = await requireStaff(req, "staff.manage");
    const b = parse(z.object({ email: z.string().trim().toLowerCase().email(), role: z.enum(StaffRoles) }), req.body);
    const user = await prisma.user.findUnique({ where: { email: b.email } });
    if (!user || user.status === "DELETED") throw notFound("No Haven account uses this email yet. Ask them to sign up in the app first");
    if (user.status !== "ACTIVE") throw conflict("This account is suspended or banned");
    if (user.id === owner.id) throw badRequest("You can't change your own role");
    if (user.staffRole === "OWNER" && b.role !== "OWNER") {
      const owners = await prisma.user.count({ where: { staffRole: "OWNER", status: "ACTIVE" } });
      if (owners <= 1) throw conflict("Haven needs at least one owner");
    }
    if (user.staffRole === b.role) return { userId: user.id, handle: user.handle, role: b.role };
    await prisma.user.update({ where: { id: user.id }, data: { staffRole: b.role } });
    await audit(prisma, { actorId: owner.id, action: "staff.role.set", targetType: "user", targetId: user.id, data: { from: user.staffRole, to: b.role, email: user.email, handle: user.handle }, ip: req.ip });
    await notify({ userId: user.id, type: "support.message", title: "You've been added to the Haven team", body: `Your role: ${StaffRoleInfo[b.role].name}. Open Admin from your profile.`, link: "/admin" });
    return { userId: user.id, handle: user.handle, role: b.role };
  });

  app.delete("/admin/staff/:userId", async (req) => {
    const owner = await requireStaff(req, "staff.manage");
    const { userId } = req.params as { userId: string };
    if (userId === owner.id) throw badRequest("You can't remove your own role");
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user?.staffRole) throw notFound("Staff member");
    // Owners from before staff roles also carry the old ADMIN role; take it away too.
    await prisma.user.update({ where: { id: userId }, data: { staffRole: null, roles: user.roles.filter((r) => r !== "ADMIN") } });
    await audit(prisma, { actorId: owner.id, action: "staff.role.remove", targetType: "user", targetId: userId, data: { from: user.staffRole, email: user.email, handle: user.handle }, ip: req.ip });
    return { ok: true };
  });

  // ── One person, for support: account, orders, contact ──
  app.get("/admin/users/:id", async (req) => {
    const staff = await requireStaff(req, "users.view");
    const { id } = req.params as { id: string };
    const u = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true, email: true, handle: true, displayName: true, roles: true, staffRole: true, status: true, createdAt: true,
        seller: { select: { id: true, businessName: true, status: true } },
        addresses: true,
        orders: { orderBy: { createdAt: "desc" }, take: 25, select: { id: true, status: true, totalCents: true, createdAt: true, isTest: true, seller: { select: { businessName: true } } } },
      },
    });
    if (!u) throw notFound("User");
    const pii = can(staff.staffRole, "pii.view");
    await audit(prisma, { actorId: staff.id, action: "admin.user.view", targetType: "user", targetId: id, ip: req.ip });
    return { ...u, email: pii ? u.email : maskEmail(u.email), addresses: pii ? u.addresses : u.addresses.map(maskAddress), piiMasked: !pii };
  });

  app.post("/admin/users/:id/message", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req) => {
    const staff = await requireStaff(req, "users.message");
    const { id } = req.params as { id: string };
    const b = parse(z.object({ title: z.string().trim().min(2).max(120).default("A message from Haven support"), body: z.string().trim().min(2).max(2000), orderId: z.string().optional() }), req.body);
    const u = await prisma.user.findUnique({ where: { id } });
    if (!u || u.status === "DELETED") throw notFound("User");
    await notify({ userId: id, type: "support.message", title: b.title, body: b.body, link: b.orderId ? "/orders" : null, data: b.orderId ? { orderId: b.orderId } : undefined });
    await audit(prisma, { actorId: staff.id, action: "admin.user.message", targetType: "user", targetId: id, data: { title: b.title, body: b.body, orderId: b.orderId }, ip: req.ip });
    return { ok: true };
  });

  // ── Orders ──
  app.get("/admin/orders", async (req) => {
    const staff = await requireStaff(req, "orders.view");
    const q = parse(z.object({ q: z.string().trim().max(200).optional(), status: z.string().optional() }), req.query);
    const term = q.q?.replace(/^#/, "");
    const orders = await prisma.order.findMany({
      where: {
        ...(q.status ? { status: q.status as any } : {}),
        ...(term
          ? {
              OR: [
                { id: term },
                { id: { endsWith: term.toLowerCase() } },
                { buyer: { email: { equals: term.toLowerCase() } } },
                { buyer: { handle: { equals: term.replace(/^@/, ""), mode: "insensitive" } } },
                { seller: { businessName: { contains: term, mode: "insensitive" } } },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: { id: true, status: true, totalCents: true, currency: true, createdAt: true, isTest: true, buyer: { select: { id: true, handle: true, email: true } }, seller: { select: { id: true, businessName: true } } },
    });
    const pii = can(staff.staffRole, "pii.view");
    return orders.map((o) => ({ ...o, buyer: { ...o.buyer, email: pii ? o.buyer.email : maskEmail(o.buyer.email) } }));
  });

  app.get("/admin/orders/:id", async (req) => {
    const staff = await requireStaff(req, "orders.view");
    const o = await prisma.order.findUnique({
      where: { id: (req.params as { id: string }).id },
      include: {
        items: { select: { titleSnapshot: true, unitPriceCents: true, quantity: true } },
        shipments: { select: { carrier: true, service: true, trackingNumber: true, trackingUrl: true, status: true, deliveredAt: true, createdAt: true } },
        refunds: { orderBy: { createdAt: "asc" } },
        buyer: { select: { id: true, handle: true, email: true, displayName: true } },
        seller: { select: { id: true, businessName: true } },
      },
    });
    if (!o) throw notFound("Order");
    const pii = can(staff.staffRole, "pii.view");
    const payment = await prisma.payment.findUnique({ where: { checkoutId: o.checkoutGroupId }, select: { provider: true, providerRef: true, status: true } });
    const refunded = o.refunds.filter((r) => r.status !== "FAILED").reduce((s, r) => s + r.amountCents, 0);
    const limit = can(staff.staffRole, "orders.refund") ? await refundLimitCents(staff.staffRole) : 0;
    return {
      ...o,
      buyer: { ...o.buyer, email: pii ? o.buyer.email : maskEmail(o.buyer.email) },
      shippingAddress: pii ? o.shippingAddress : maskAddress(o.shippingAddress),
      // The fee is a finance figure.
      platformFeeCents: can(staff.staffRole, "finance.view") ? o.platformFeeCents : undefined,
      refunds: o.refunds.map((r) => ({ ...r, providerRef: pii ? r.providerRef : maskRef(r.providerRef) })),
      payment: payment && { provider: payment.provider, status: payment.status, ref: staff.staffRole === "OWNER" ? payment.providerRef : maskRef(payment.providerRef) },
      refundedCents: refunded,
      // What this staff member can still refund on this order.
      refundableCents: Math.max(0, Math.min(o.totalCents - refunded, limit == null ? Infinity : limit - refunded)),
      piiMasked: !pii,
    };
  });

  app.post("/admin/orders/:id/refund", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req) => {
    const staff = await requireStaff(req, "orders.refund");
    const id = (req.params as { id: string }).id;
    const b = parse(z.object({ amountCents: z.number().int().positive(), reason: z.string().trim().min(3).max(500), restock: z.boolean().default(false) }), req.body);
    const limit = await refundLimitCents(staff.staffRole);

    // Lock the order so two staff can't refund past the total at the same moment.
    const { refund, order, payment, fully } = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT id FROM "Order" WHERE id = ${id} FOR UPDATE`;
      const order = await tx.order.findUnique({ where: { id }, include: { refunds: true } });
      if (!order) throw notFound("Order");
      if (["PENDING_PAYMENT", "CANCELLED"].includes(order.status)) throw conflict("This order was never paid");
      const payment = await tx.payment.findUnique({ where: { checkoutId: order.checkoutGroupId } });
      if (!payment) throw conflict("No payment found for this order");
      const already = order.refunds.filter((r) => r.status !== "FAILED").reduce((s, r) => s + r.amountCents, 0);
      if (already + b.amountCents > order.totalCents) throw badRequest(`Only $${((order.totalCents - already) / 100).toFixed(2)} is left to refund on this order`);
      if (limit != null && already + b.amountCents > limit)
        throw forbidden(`Your role can refund up to $${(limit / 100).toFixed(2)} per order${already ? ` ($${(already / 100).toFixed(2)} already refunded)` : ""}. Ask the owner for anything larger.`);
      const refund = await tx.refund.create({ data: { orderId: id, amountCents: b.amountCents, reason: b.reason, status: "PROCESSING" } });
      return { refund, order, payment, fully: already + b.amountCents === order.totalCents };
    });

    let result;
    try {
      result = await refundPayment({ provider: payment.provider, providerRef: payment.providerRef, amountCents: b.amountCents, idempotencyKey: `refund:${refund.id}`, reason: b.reason });
    } catch (e) {
      await prisma.refund.update({ where: { id: refund.id }, data: { status: "FAILED" } });
      await audit(prisma, { actorId: staff.id, action: "admin.order.refund_failed", targetType: "order", targetId: id, data: { amountCents: b.amountCents, error: (e as Error).message }, ip: req.ip });
      throw e;
    }
    await prisma.$transaction(async (tx) => {
      await tx.refund.update({ where: { id: refund.id }, data: { status: result.status, providerRef: result.providerRef } });
      if (fully) await tx.order.update({ where: { id }, data: { status: "REFUNDED" } });
      if (fully && b.restock) {
        const items = await tx.orderItem.findMany({ where: { orderId: id } });
        for (const it of items) {
          await tx.$executeRaw`UPDATE "ProductVariant" SET quantity = quantity + ${it.quantity}, version = version + 1 WHERE id = ${it.variantId}`;
          await tx.inventoryEvent.create({ data: { variantId: it.variantId, delta: it.quantity, reason: "CANCEL_RESTORE", refId: refund.id } });
        }
      }
    });
    await audit(prisma, { actorId: staff.id, action: "admin.order.refund", targetType: "order", targetId: id, data: { amountCents: b.amountCents, reason: b.reason, full: fully, refundId: refund.id, role: staff.staffRole }, ip: req.ip });
    const money = `$${(b.amountCents / 100).toFixed(2)}`;
    const seller = await prisma.sellerAccount.findUnique({ where: { id: order.sellerId }, select: { userId: true } });
    await notify([
      { userId: order.buyerId, type: "order.refunded", title: "You've been refunded", body: `${money} for order ${order.id.slice(-6)}. It can take 5 to 10 days to reach your card.`, link: "/orders", data: { orderId: id } },
      ...(seller ? [{ userId: seller.userId, type: "order.refunded", title: "An order was refunded", body: `Haven support refunded ${money} on order ${order.id.slice(-6)}: ${b.reason}`, link: "/seller/orders", data: { orderId: id } }] : []),
    ]);
    return { ok: true, refundId: refund.id, status: result.status, fullyRefunded: fully };
  });

  // ── Live shows ──
  app.get("/admin/streams", async (req) => {
    await requireStaff(req, "shows.manage");
    return prisma.livestream.findMany({
      where: { status: { in: ["LIVE", "PAUSED", "SCHEDULED"] } },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      take: 100,
      select: { id: true, title: true, status: true, mode: true, createdAt: true, seller: { select: { id: true, businessName: true, user: { select: { handle: true } } } } },
    });
  });

  app.post("/admin/streams/:id/end", async (req) => {
    const staff = await requireStaff(req, "shows.manage");
    const id = (req.params as { id: string }).id;
    const { reason } = parse(z.object({ reason: z.string().trim().min(3).max(300) }), req.body);
    const s = await prisma.livestream.findUnique({ where: { id }, include: { seller: true } });
    if (!s) throw notFound("Show");
    if (s.status === "ENDED") return { ok: true };
    await prisma.livestream.update({ where: { id }, data: { status: "ENDED" } });
    emit(`stream:${id}`, "stream:status", { status: "ENDED" });
    await notify({ userId: s.seller.userId, type: "moderation.product_removed", title: "Your show was ended by Haven", body: reason });
    await audit(prisma, { actorId: staff.id, action: "moderation.stream.end", targetType: "stream", targetId: id, data: { reason }, ip: req.ip });
    return { ok: true };
  });
}
