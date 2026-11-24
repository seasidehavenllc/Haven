-- Staff roles for the admin panel
CREATE TYPE "StaffRole" AS ENUM ('OWNER', 'MANAGER', 'SUPPORT');

ALTER TABLE "User" ADD COLUMN "staffRole" "StaffRole";

-- Everyone who was an admin before keeps full access as an owner.
UPDATE "User" SET "staffRole" = 'OWNER' WHERE 'ADMIN' = ANY("roles");

ALTER TABLE "PlatformSettings" ADD COLUMN "managerRefundLimitCents" INTEGER NOT NULL DEFAULT 50000,
ADD COLUMN "supportRefundLimitCents" INTEGER NOT NULL DEFAULT 10000;

CREATE INDEX "AuditLog_actorId_createdAt_idx" ON "AuditLog"("actorId", "createdAt");
