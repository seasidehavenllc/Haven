import { prisma, type Tx } from "../db";
export function audit(
  db: Tx | typeof prisma,
  e: { actorId?: string | null; action: string; targetType?: string; targetId?: string; data?: unknown; ip?: string },
) {
  return db.auditLog.create({
    data: { actorId: e.actorId ?? null, action: e.action, targetType: e.targetType, targetId: e.targetId, data: (e.data ?? undefined) as any, ip: e.ip },
  });
}
