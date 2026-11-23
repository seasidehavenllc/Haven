import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db";
import { requireUser } from "../lib/auth";
import { parse } from "../lib/validate";
import { emailProvider, pushProvider } from "../notify";

/** Types a user can mute. Transactional ones (orders, payments, moderation) can't be muted. */
export const MUTABLE_TYPES = ["stream.live", "auction.outbid", "social.follow", "video.like", "video.comment", "marketing"] as const;

export async function notificationRoutes(app: FastifyInstance) {
  app.get("/notifications", async (req) => {
    const u = requireUser(req);
    const { before } = (req.query ?? {}) as { before?: string };
    return prisma.notification.findMany({ where: { userId: u.id, ...(before ? { createdAt: { lt: new Date(before) } } : {}) }, orderBy: { createdAt: "desc" }, take: 50 });
  });

  app.get("/notifications/unread-count", async (req) => {
    const u = requireUser(req);
    return { count: await prisma.notification.count({ where: { userId: u.id, readAt: null } }) };
  });

  /** Mark specific notifications read, or all of them when no ids are given. */
  app.post("/notifications/read", async (req) => {
    const u = requireUser(req);
    const { ids } = parse(z.object({ ids: z.array(z.string()).max(200).optional() }), req.body ?? {});
    await prisma.notification.updateMany({ where: { userId: u.id, readAt: null, ...(ids ? { id: { in: ids } } : {}) }, data: { readAt: new Date() } });
    return { ok: true };
  });

  app.get("/me/notification-preferences", async (req) => {
    const u = requireUser(req);
    const p = await prisma.notificationPreference.findUnique({ where: { userId: u.id } });
    return {
      push: p?.push ?? true,
      email: p?.email ?? true,
      mutedTypes: p?.mutedTypes ?? [],
      mutableTypes: MUTABLE_TYPES,
      channels: { push: pushProvider.configured(), email: emailProvider.configured() },
    };
  });

  app.put("/me/notification-preferences", async (req) => {
    const u = requireUser(req);
    const body = parse(z.object({ push: z.boolean(), email: z.boolean(), mutedTypes: z.array(z.enum(MUTABLE_TYPES)).max(MUTABLE_TYPES.length) }), req.body);
    await prisma.notificationPreference.upsert({ where: { userId: u.id }, create: { userId: u.id, ...body }, update: body });
    return { ok: true };
  });

  /** The mobile app registers its Expo push token after the user allows notifications. */
  app.post("/me/push-devices", async (req) => {
    const u = requireUser(req);
    const { token, platform } = parse(z.object({ token: z.string().regex(/^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$/, "Not an Expo push token"), platform: z.enum(["ios", "android"]) }), req.body);
    // A token belongs to one device; if someone else signs in on it, it moves to them.
    await prisma.pushDevice.upsert({ where: { token }, create: { token, platform, userId: u.id }, update: { userId: u.id, platform } });
    return { ok: true };
  });

  app.delete("/me/push-devices/:token", async (req) => {
    const u = requireUser(req);
    await prisma.pushDevice.deleteMany({ where: { token: (req.params as any).token, userId: u.id } });
    return { ok: true };
  });
}
