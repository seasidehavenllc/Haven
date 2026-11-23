import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { createHash, randomBytes } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Role } from "@prisma/client";
import { env } from "../env";
import { prisma } from "../db";
import { forbidden, unauthorized } from "./errors";

const secret = new TextEncoder().encode(env.JWT_SECRET);
const ACCESS_TTL = "15m";
const REFRESH_DAYS = 30;

export const hashPassword = (pw: string) => bcrypt.hash(pw, 12);
export const verifyPassword = (pw: string, hash: string) => bcrypt.compare(pw, hash);
export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export interface AuthUser {
  id: string;
  roles: Role[];
  sellerId: string | null;
}

export async function signAccessToken(u: AuthUser) {
  return new SignJWT({ roles: u.roles, sid: u.sellerId })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(u.id)
    .setIssuedAt()
    .setExpirationTime(ACCESS_TTL)
    .sign(secret);
}

export async function verifyAccessToken(token: string): Promise<AuthUser> {
  const { payload } = await jwtVerify(token, secret, { algorithms: ["HS256"] });
  return { id: payload.sub!, roles: (payload.roles as Role[]) ?? [], sellerId: (payload.sid as string) ?? null };
}

/** Issue access + rotating refresh token. Refresh tokens are stored hashed. */
export async function issueSession(userId: string, meta: { ua?: string; ip?: string }) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { seller: true } });
  const refreshToken = randomBytes(48).toString("base64url");
  await prisma.session.create({
    data: {
      userId,
      refreshTokenHash: sha256(refreshToken),
      userAgent: meta.ua?.slice(0, 300),
      ip: meta.ip,
      expiresAt: new Date(Date.now() + REFRESH_DAYS * 864e5),
    },
  });
  const accessToken = await signAccessToken({ id: user.id, roles: user.roles, sellerId: user.seller?.id ?? null });
  return { accessToken, refreshToken };
}

declare module "fastify" {
  interface FastifyRequest {
    user: AuthUser | null;
  }
}

export async function attachUser(req: FastifyRequest) {
  req.user = null;
  const h = req.headers.authorization;
  if (!h?.startsWith("Bearer ")) return;
  try {
    req.user = await verifyAccessToken(h.slice(7));
  } catch {
    req.user = null;
  }
}

export function requireUser(req: FastifyRequest): AuthUser {
  if (!req.user) throw unauthorized();
  return req.user;
}

export function requireRole(req: FastifyRequest, role: Role): AuthUser {
  const u = requireUser(req);
  if (!u.roles.includes(role) && !u.roles.includes("ADMIN")) throw forbidden(`${role} role required`);
  return u;
}

/** Sellers act on their own account. Re-checks DB status so suspensions apply immediately. */
export async function requireSeller(req: FastifyRequest) {
  const u = requireUser(req);
  const seller = await prisma.sellerAccount.findUnique({ where: { userId: u.id } });
  if (!seller) throw forbidden("Seller account required");
  if (seller.status !== "APPROVED") throw forbidden(`Seller account is ${seller.status.toLowerCase()}`);
  return { user: u, seller };
}

export async function requireAdmin(req: FastifyRequest) {
  const u = requireUser(req);
  const fresh = await prisma.user.findUnique({ where: { id: u.id } });
  if (!fresh?.roles.includes("ADMIN") || fresh.status !== "ACTIVE") throw forbidden("Admin only");
  return u;
}

export type Reply = FastifyReply;
