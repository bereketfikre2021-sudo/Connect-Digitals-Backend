-- =============================================================================
-- Broadcast System
-- Adds the Broadcast, BroadcastDelivery and BroadcastDraft tables plus all
-- required enums for the admin Telegram notification/broadcast feature.
-- =============================================================================

-- ── Enums ─────────────────────────────────────────────────────────────────────

CREATE TYPE "BroadcastMessageType" AS ENUM ('TEXT', 'PHOTO', 'VIDEO', 'DOCUMENT');

CREATE TYPE "BroadcastStatus" AS ENUM ('DRAFT', 'SENDING', 'COMPLETED', 'FAILED', 'CANCELLED');

CREATE TYPE "BroadcastAudienceType" AS ENUM ('ALL_USERS');

CREATE TYPE "BroadcastDeliveryStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'BLOCKED');

-- ── Broadcast ─────────────────────────────────────────────────────────────────

CREATE TABLE "Broadcast" (
  "id"              TEXT                      NOT NULL,
  "createdBy"       TEXT                      NOT NULL,
  "messageType"     "BroadcastMessageType"    NOT NULL,
  "text"            TEXT,
  "caption"         TEXT,
  "mediaFileId"     TEXT,
  "buttons"         JSONB,
  "audienceType"    "BroadcastAudienceType"   NOT NULL DEFAULT 'ALL_USERS',
  "status"          "BroadcastStatus"         NOT NULL DEFAULT 'DRAFT',
  "totalRecipients" INTEGER                   NOT NULL DEFAULT 0,
  "sentCount"       INTEGER                   NOT NULL DEFAULT 0,
  "failedCount"     INTEGER                   NOT NULL DEFAULT 0,
  "blockedCount"    INTEGER                   NOT NULL DEFAULT 0,
  "createdAt"       TIMESTAMP(3)              NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt"       TIMESTAMP(3),
  "completedAt"     TIMESTAMP(3),
  CONSTRAINT "Broadcast_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Broadcast_status_idx"    ON "Broadcast"("status");
CREATE INDEX "Broadcast_createdBy_idx" ON "Broadcast"("createdBy");
CREATE INDEX "Broadcast_createdAt_idx" ON "Broadcast"("createdAt");

-- ── BroadcastDelivery ─────────────────────────────────────────────────────────

CREATE TABLE "BroadcastDelivery" (
  "id"                TEXT                      NOT NULL,
  "broadcastId"       TEXT                      NOT NULL,
  "telegramUserId"    TEXT                      NOT NULL,
  "status"            "BroadcastDeliveryStatus" NOT NULL DEFAULT 'PENDING',
  "telegramMessageId" INTEGER,
  "errorCode"         TEXT,
  "errorMessage"      TEXT,
  "sentAt"            TIMESTAMP(3),
  "createdAt"         TIMESTAMP(3)              NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BroadcastDelivery_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BroadcastDelivery_broadcastId_telegramUserId_key"
  ON "BroadcastDelivery"("broadcastId", "telegramUserId");

CREATE INDEX "BroadcastDelivery_broadcastId_idx"    ON "BroadcastDelivery"("broadcastId");
CREATE INDEX "BroadcastDelivery_telegramUserId_idx" ON "BroadcastDelivery"("telegramUserId");
CREATE INDEX "BroadcastDelivery_status_idx"         ON "BroadcastDelivery"("status");

ALTER TABLE "BroadcastDelivery"
  ADD CONSTRAINT "BroadcastDelivery_broadcastId_fkey"
  FOREIGN KEY ("broadcastId") REFERENCES "Broadcast"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ── BroadcastDraft ────────────────────────────────────────────────────────────

CREATE TABLE "BroadcastDraft" (
  "id"              TEXT         NOT NULL,
  "telegramAdminId" TEXT         NOT NULL,
  "step"            TEXT         NOT NULL DEFAULT 'type_select',
  "payload"         JSONB        NOT NULL DEFAULT '{}',
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt"       TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BroadcastDraft_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BroadcastDraft_telegramAdminId_key" ON "BroadcastDraft"("telegramAdminId");
CREATE INDEX "BroadcastDraft_telegramAdminId_idx" ON "BroadcastDraft"("telegramAdminId");
CREATE INDEX "BroadcastDraft_expiresAt_idx"        ON "BroadcastDraft"("expiresAt");
