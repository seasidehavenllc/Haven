import type { FastifyInstance } from "fastify";
import { LoginInput, RegisterInput } from "@haven/shared";
import { prisma } from "../db";
import { hashPassword, issueSession, requireUser, sha256, verifyPassword, signAccessToken } from "../lib/auth";
import { conflict, unauthorized } from "../lib/errors";
import { parse } from "../lib/validate";
import { audit } from "../lib/audit";

export const publicUser = (u: { id: string; handle: string; displayName: string; avatarUrl: string | null; roles: string[] }) => ({
  id: u.id,
  handle: u.handle,
  displayName: u.displayName,
  avatarUrl: u.avatarUrl,
  roles: u.roles,
});

export async function authRoutes(app: FastifyInstance) {
  const strict = { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } };

  app.post("/auth/register", strict, async (req) => {
    const input = parse(RegisterInput, req.body);
    const exists = await prisma.user.findFirst({ where: { OR: [{ email: input.email.toLowerCase() }, { handle: input.handle }] } });
    if (exists) throw conflict("Email or handle is already in use");
    const roles = input.role === "BUYER" ? ["BUYER"] : ["BUYER", input.role];
    const user = await prisma.user.create({
      data: {
        email: input.email.toLowerCase(),
        handle: input.handle,
        displayName: input.displayName,
        passwordHash: await hashPassword(input.password),
        roles: roles as any,
      },
    });
    await audit(prisma, { actorId: user.id, action: "auth.register", ip: req.ip });
    const tokens = await issueSession(user.id, { ua: req.headers["user-agent"], ip: req.ip });
    return { user: publicUser(user), ...tokens };
  });

  app.post("/auth/login", strict, async (req) => {
    const input = parse(LoginInput, req.body);
    const user = await prisma.user.findUnique({ where: { email: input.email.toLowerCase() } });
    // Same error + constant-ish work whether or not the user exists.
    const ok = user?.passwordHash ? await verifyPassword(input.password, user.passwordHash) : await verifyPassword(input.password, "$2b$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinv");
    if (!user || !ok) throw unauthorized("Incorrect email or password");
    if (user.status !== "ACTIVE") throw unauthorized("This account is not active");
    await audit(prisma, { actorId: user.id, action: "auth.login", ip: req.ip });
    const tokens = await issueSession(user.id, { ua: req.headers["user-agent"], ip: req.ip });
    return { user: publicUser(user), ...tokens };
  });

  /** Rotating refresh: old token is revoked; reuse of a revoked token revokes all sessions. */
  app.post("/auth/refresh", strict, async (req) => {
    const { refreshToken } = (req.body ?? {}) as { refreshToken?: string };
    if (!refreshToken) throw unauthorized();
    const s = await prisma.session.findUnique({ where: { refreshTokenHash: sha256(refreshToken) } });
    if (!s) throw unauthorized();
    if (s.revokedAt) {
      await prisma.session.updateMany({ where: { userId: s.userId, revokedAt: null }, data: { revokedAt: new Date() } });
      await audit(prisma, { actorId: s.userId, action: "auth.refresh_reuse_detected", ip: req.ip });
      throw unauthorized();
    }
    if (s.expiresAt < new Date()) throw unauthorized();
    await prisma.session.update({ where: { id: s.id }, data: { revokedAt: new Date() } });
    return issueSession(s.userId, { ua: req.headers["user-agent"], ip: req.ip });
  });

  app.post("/auth/logout", async (req) => {
    const { refreshToken } = (req.body ?? {}) as { refreshToken?: string };
    if (refreshToken) await prisma.session.updateMany({ where: { refreshTokenHash: sha256(refreshToken) }, data: { revokedAt: new Date() } });
    return { ok: true };
  });

  app.get("/me", async (req) => {
    const u = requireUser(req);
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: u.id },
      include: { seller: { include: { storefront: true, subscription: { include: { plan: true } } } } },
    });
    return {
      user: { ...publicUser(user), email: user.email, bio: user.bio },
      seller: user.seller
        ? {
            id: user.seller.id,
            businessName: user.seller.businessName,
            status: user.seller.status,
            aiDisabled: user.seller.aiDisabled,
            storefront: user.seller.storefront,
            plan: user.seller.subscription ? { key: user.seller.subscription.plan.key, name: user.seller.subscription.plan.name, periodEnd: user.seller.subscription.currentPeriodEnd } : null,
          }
        : null,
    };
  });

  /** Social sign-in endpoints exist but refuse until provider credentials are configured. */
  for (const p of ["apple", "google"] as const) {
    app.post(`/auth/${p}`, async (_req, reply) => {
      const envVar = p === "apple" ? "APPLE_CLIENT_ID" : "GOOGLE_OAUTH_CLIENT_ID";
      if (!process.env[envVar]) return reply.code(503).send({ error: "not_configured", message: `${p} sign-in is not configured`, details: { requiredEnv: [envVar] } });
      return reply.code(501).send({ error: "not_implemented", message: `${p} ID-token verification is scheduled for Phase 9` });
    });
  }

  // Exposed for tests / token refresh after role change.
  app.post("/auth/token", async (req) => {
    const u = requireUser(req);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: u.id }, include: { seller: true } });
    return { accessToken: await signAccessToken({ id: user.id, roles: user.roles, sellerId: user.seller?.id ?? null }) };
  });
}
