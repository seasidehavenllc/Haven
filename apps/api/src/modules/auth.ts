import type { FastifyInstance } from "fastify";
import { LoginInput, RegisterInput } from "@haven/shared";
import { prisma } from "../db";
import { hashPassword, issueSession, requireUser, sha256, verifyPassword, signAccessToken } from "../lib/auth";
import { badRequest, conflict, unauthorized } from "../lib/errors";
import { socialConfigured, verifySocialToken } from "../lib/social";
import { z } from "zod";
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
    const owner = await prisma.user.findUnique({ where: { id: s.userId }, select: { status: true } });
    if (owner?.status !== "ACTIVE") throw unauthorized("This account is not active");
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
    // Live chat arrives over the socket, so the apps hide these people's messages themselves.
    const blocks = await prisma.userBlock.findMany({ where: { OR: [{ blockerId: u.id }, { blockedId: u.id }] }, select: { blockerId: true, blockedId: true } });
    return {
      user: { ...publicUser(user), email: user.email, bio: user.bio, hasPassword: !!user.passwordHash, staffRole: user.status === "ACTIVE" ? user.staffRole : null },
      blockedUserIds: [...new Set(blocks.map((b) => (b.blockerId === u.id ? b.blockedId : b.blockerId)))],
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

  /**
   * Sign in with Apple or Google. The client sends the provider's ID token; we verify it, then sign in
   * the linked account, link a verified email to the existing account, or create a new account.
   */
  for (const provider of ["apple", "google"] as const) {
    app.post(`/auth/${provider}`, strict, async (req) => {
      const body = parse(
        z.object({
          idToken: z.string().min(20).max(8000),
          nonce: z.string().max(200).optional(),
          // Apple only sends the name to the app, once, on the first sign-in.
          name: z.string().trim().max(80).optional(),
          role: z.enum(["BUYER", "SELLER"]).default("BUYER"),
        }),
        req.body,
      );
      const id = await verifySocialToken(provider, body.idToken, body.nonce);
      let created = false;
      let user = (await prisma.oAuthAccount.findUnique({ where: { provider_providerId: { provider, providerId: id.sub } }, include: { user: true } }))?.user ?? null;
      if (!user) {
        // Only a provider-verified email may attach to an existing account.
        const byEmail = id.emailVerified && id.email ? await prisma.user.findUnique({ where: { email: id.email } }) : null;
        if (byEmail) {
          user = byEmail;
          await prisma.oAuthAccount.create({ data: { userId: user.id, provider, providerId: id.sub } });
          await audit(prisma, { actorId: user.id, action: `auth.${provider}.link`, ip: req.ip });
        } else {
          if (!id.email) throw badRequest(`Your ${provider === "apple" ? "Apple" : "Google"} account didn't share an email address. Sign up with email instead.`);
          if (!id.emailVerified) throw badRequest("That email address isn't verified with your provider yet.");
          const displayName = (body.name || id.name || id.email.split("@")[0]!).slice(0, 80);
          user = await prisma.user.create({
            data: {
              email: id.email,
              handle: await freeHandle(body.name || id.name || id.email.split("@")[0]!),
              displayName,
              avatarUrl: id.picture,
              roles: (body.role === "SELLER" ? ["BUYER", "SELLER"] : ["BUYER"]) as any,
              oauthAccounts: { create: { provider, providerId: id.sub } },
            },
          });
          created = true;
          await audit(prisma, { actorId: user.id, action: `auth.${provider}.register`, ip: req.ip });
        }
      }
      if (user.status !== "ACTIVE") throw unauthorized("This account is not active");
      await audit(prisma, { actorId: user.id, action: `auth.${provider}.login`, ip: req.ip });
      const tokens = await issueSession(user.id, { ua: req.headers["user-agent"], ip: req.ip });
      return { user: publicUser(user), created, ...tokens };
    });
  }

  app.get("/auth/providers", async () => ({
    apple: socialConfigured("apple"),
    google: socialConfigured("google"),
  }));

  // Exposed for tests / token refresh after role change.
  app.post("/auth/token", async (req) => {
    const u = requireUser(req);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: u.id }, include: { seller: true } });
    return { accessToken: await signAccessToken({ id: user.id, roles: user.roles, sellerId: user.seller?.id ?? null }) };
  });
}

/** A unique handle from a name or email, e.g. "Riley Shaw" -> "rileyshaw" or "rileyshaw_4821". */
async function freeHandle(from: string) {
  let base = from.toLowerCase().normalize("NFKD").replace(/[^a-z0-9_]/g, "").slice(0, 24);
  if (base.length < 3) base = `user${base}`;
  for (let i = 0; i < 6; i++) {
    const h = i === 0 ? base : `${base}_${Math.floor(1000 + Math.random() * 9000)}`;
    if (!(await prisma.user.findUnique({ where: { handle: h } }))) return h;
  }
  return `${base.slice(0, 16)}_${Date.now().toString(36)}`;
}
