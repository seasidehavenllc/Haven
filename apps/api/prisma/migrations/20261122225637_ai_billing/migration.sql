-- DropIndex
DROP INDEX "AiCreditTransaction_usageRecordId_key";

-- CreateTable
CREATE TABLE "AiBillingCharge" (
    "id" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "planKey" TEXT,
    "packKey" TEXT,
    "amountCents" INTEGER NOT NULL,
    "provider" TEXT NOT NULL,
    "providerRef" TEXT NOT NULL,
    "isTest" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'SUCCEEDED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiBillingCharge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiCreditPack" (
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "credits" INTEGER NOT NULL,
    "priceCents" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "AiCreditPack_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "AiBillingCharge_providerRef_key" ON "AiBillingCharge"("providerRef");

-- CreateIndex
CREATE INDEX "AiBillingCharge_createdAt_idx" ON "AiBillingCharge"("createdAt");

-- CreateIndex
CREATE INDEX "AiBillingCharge_sellerId_createdAt_idx" ON "AiBillingCharge"("sellerId", "createdAt");

-- CreateIndex
CREATE INDEX "AiCreditTransaction_usageRecordId_idx" ON "AiCreditTransaction"("usageRecordId");

-- AddForeignKey
ALTER TABLE "AiBillingCharge" ADD CONSTRAINT "AiBillingCharge_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "SellerAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
