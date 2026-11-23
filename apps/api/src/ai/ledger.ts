import { prisma, type Tx } from "../db";

/** Credit balances are always derived from the append-only ledger. */
export async function creditBalance(db: Tx | typeof prisma, sellerId: string) {
  const rows = await db.aiCreditTransaction.groupBy({
    by: ["bucket"],
    where: { sellerId },
    _sum: { amount: true },
  });
  const allowance = rows.find((r) => r.bucket === "allowance")?._sum.amount ?? 0;
  const purchased = rows.find((r) => r.bucket === "purchased")?._sum.amount ?? 0;
  return { allowance, purchased, total: allowance + purchased };
}

/** Serialize all credit mutations for one seller (transaction-scoped Postgres advisory lock). */
export async function lockSeller(tx: Tx, sellerId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"credits:" + sellerId}))`;
}

export async function creditsUsedSince(db: Tx | typeof prisma, sellerId: string, since: Date) {
  const r = await db.aiCreditTransaction.aggregate({
    where: { sellerId, kind: "USAGE", createdAt: { gte: since } },
    _sum: { amount: true },
  });
  return -(r._sum.amount ?? 0);
}

/** Grant a period allowance; idempotent per seller+period. */
export async function grantAllowance(tx: Tx, sellerId: string, credits: number, periodKey: string, note?: string) {
  if (credits <= 0) return;
  await tx.aiCreditTransaction.upsert({
    where: { idempotencyKey: `allowance:${sellerId}:${periodKey}` },
    update: {},
    create: { sellerId, kind: "ALLOWANCE_GRANT", amount: credits, bucket: "allowance", idempotencyKey: `allowance:${sellerId}:${periodKey}`, note },
  });
}

/** Expire unused allowance (keeping rolloverPercent). Idempotent per period. */
export async function expireAllowance(tx: Tx, sellerId: string, rolloverPercent: number, periodKey: string) {
  const { allowance } = await creditBalance(tx, sellerId);
  if (allowance <= 0) return 0;
  const keep = Math.floor((allowance * Math.min(100, Math.max(0, rolloverPercent))) / 100);
  const expire = allowance - keep;
  if (expire <= 0) return 0;
  await tx.aiCreditTransaction.upsert({
    where: { idempotencyKey: `expire:${sellerId}:${periodKey}` },
    update: {},
    create: { sellerId, kind: "ALLOWANCE_EXPIRE", amount: -expire, bucket: "allowance", idempotencyKey: `expire:${sellerId}:${periodKey}` },
  });
  return expire;
}
