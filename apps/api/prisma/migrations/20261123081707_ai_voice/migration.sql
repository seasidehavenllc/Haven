-- AlterTable
ALTER TABLE "StreamChatMessage" ADD COLUMN     "audioUrl" TEXT;

-- AlterTable
ALTER TABLE "AiUsageRecord" ADD COLUMN     "idempotencyKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "AiUsageRecord_idempotencyKey_key" ON "AiUsageRecord"("idempotencyKey");
