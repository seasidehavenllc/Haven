import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { createHash, randomBytes } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Role, StaffRole } from "@prisma/client";
import { can, type StaffPermission } from "@haven/shared";
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

/**
 * The approved-seller gate. Every selling and go-live route calls this. It passes only for a person
 * whose seller account is APPROVED (which happens when staff approve their seller application), and
 * re-reads the database on each request, so a suspension applies immediately.
 */
export async function requireSeller(req: FastifyRequest) {
  const u = requireUser(req);
  const seller = await prisma.sellerAccount.findUnique({ where: { userId: u.id } });
  if (!seller) throw forbidden("Seller account required");
  if (seller.status !== "APPROVED") throw forbidden(`Seller account is ${seller.status.toLowerCase()}`);
  return { user: u, seller };
}

/** Same check as requireSeller, by name, for features that gate on "approved seller". */
export const requireApprovedSeller = requireSeller;

/** True when this person can sell and go live right now. For checks that shouldn't throw. */
export async function isApprovedSeller(userId: string) {
  const s = await prisma.sellerAccount.findUnique({ where: { userId }, select: { status: true } });
  return s?.status === "APPROVED";
}

export interface StaffUser extends AuthUser {
  staffRole: StaffRole;
}

/**
 * Admin routes call this with the permission they need. It reads the role fresh from the database on
 * every request, so giving or taking away a role works immediately, with no sign-out needed.
 */
export async function requireStaff(req: FastifyRequest, permission?: StaffPermission): Promise<StaffUser> {
  const u = requireUser(req);
  const fresh = await prisma.user.findUnique({ where: { id: u.id }, select: { staffRole: true, status: true } });
  if (!fresh?.staffRole || fresh.status !== "ACTIVE") throw forbidden("Staff only");
  if (permission && !can(fresh.staffRole, permission)) throw forbidden("Your staff role doesn't allow this");
  return { ...u, staffRole: fresh.staffRole };
}

/** Owner-only routes (fees, AI settings, finances, staff roles). */
export const requireAdmin = (req: FastifyRequest) => requireStaff(req, "settings.manage");

export type Reply = FastifyReply;
