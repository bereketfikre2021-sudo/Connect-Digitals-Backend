-- PromoCode table
CREATE TABLE "PromoCode" (
  "id"              TEXT NOT NULL,
  "code"            TEXT NOT NULL,
  "discountPercent" INTEGER NOT NULL,
  "maxUses"         INTEGER,
  "usedCount"       INTEGER NOT NULL DEFAULT 0,
  "minOrderETB"     INTEGER NOT NULL DEFAULT 0,
  "expiresAt"       TIMESTAMP(3),
  "isActive"        BOOLEAN NOT NULL DEFAULT true,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PromoCode_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PromoCode_code_key" ON "PromoCode"("code");
CREATE INDEX "PromoCode_code_idx" ON "PromoCode"("code");
CREATE INDEX "PromoCode_isActive_idx" ON "PromoCode"("isActive");

-- PromoRedemption table
CREATE TABLE "PromoRedemption" (
  "id"          TEXT NOT NULL,
  "promoCodeId" TEXT NOT NULL,
  "userId"      TEXT NOT NULL,
  "orderId"     TEXT NOT NULL,
  "discountETB" INTEGER NOT NULL,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PromoRedemption_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PromoRedemption_orderId_key" ON "PromoRedemption"("orderId");
CREATE INDEX "PromoRedemption_promoCodeId_idx" ON "PromoRedemption"("promoCodeId");
CREATE INDEX "PromoRedemption_userId_idx" ON "PromoRedemption"("userId");

-- Add promo fields to Order
ALTER TABLE "Order" ADD COLUMN "promoCodeId" TEXT;
ALTER TABLE "Order" ADD COLUMN "discountETB" INTEGER NOT NULL DEFAULT 0;

-- Foreign keys
ALTER TABLE "PromoRedemption" ADD CONSTRAINT "PromoRedemption_promoCodeId_fkey"
  FOREIGN KEY ("promoCodeId") REFERENCES "PromoCode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
