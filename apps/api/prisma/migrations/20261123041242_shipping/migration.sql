-- AlterTable
ALTER TABLE "Shipment" ADD COLUMN     "deliveredAt" TIMESTAMP(3),
ADD COLUMN     "estDeliveryAt" TIMESTAMP(3),
ADD COLUMN     "labelCostCents" INTEGER,
ADD COLUMN     "providerRef" TEXT,
ADD COLUMN     "service" TEXT,
ADD COLUMN     "trackingUrl" TEXT;

-- CreateTable
CREATE TABLE "ShipmentEvent" (
    "id" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "description" TEXT,
    "location" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShipmentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShippingQuote" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "shipmentRef" TEXT NOT NULL,
    "rates" JSONB NOT NULL,
    "parcel" JSONB NOT NULL,
    "purchasedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShippingQuote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SellerShippingProfile" (
    "sellerId" TEXT NOT NULL,
    "flatRateCents" INTEGER NOT NULL DEFAULT 0,
    "perAdditionalItemCents" INTEGER NOT NULL DEFAULT 0,
    "freeOverCents" INTEGER,
    "handlingDays" INTEGER NOT NULL DEFAULT 2,
    "fromName" TEXT,
    "fromCompany" TEXT,
    "fromLine1" TEXT,
    "fromLine2" TEXT,
    "fromCity" TEXT,
    "fromRegion" TEXT,
    "fromPostalCode" TEXT,
    "fromCountry" TEXT DEFAULT 'US',
    "fromPhone" TEXT,
    "parcelLengthIn" DOUBLE PRECISION NOT NULL DEFAULT 10,
    "parcelWidthIn" DOUBLE PRECISION NOT NULL DEFAULT 8,
    "parcelHeightIn" DOUBLE PRECISION NOT NULL DEFAULT 4,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SellerShippingProfile_pkey" PRIMARY KEY ("sellerId")
);

-- CreateTable
CREATE TABLE "SellerLedgerEntry" (
    "id" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "refId" TEXT,
    "memo" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SellerLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ShipmentEvent_shipmentId_status_occurredAt_key" ON "ShipmentEvent"("shipmentId", "status", "occurredAt");

-- CreateIndex
CREATE INDEX "ShippingQuote_orderId_idx" ON "ShippingQuote"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "SellerLedgerEntry_idempotencyKey_key" ON "SellerLedgerEntry"("idempotencyKey");

-- CreateIndex
CREATE INDEX "SellerLedgerEntry_sellerId_createdAt_idx" ON "SellerLedgerEntry"("sellerId", "createdAt");

-- CreateIndex
CREATE INDEX "Shipment_trackingNumber_idx" ON "Shipment"("trackingNumber");

-- CreateIndex
CREATE INDEX "Shipment_orderId_idx" ON "Shipment"("orderId");

-- AddForeignKey
ALTER TABLE "ShipmentEvent" ADD CONSTRAINT "ShipmentEvent_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SellerShippingProfile" ADD CONSTRAINT "SellerShippingProfile_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "SellerAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SellerLedgerEntry" ADD CONSTRAINT "SellerLedgerEntry_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "SellerAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
