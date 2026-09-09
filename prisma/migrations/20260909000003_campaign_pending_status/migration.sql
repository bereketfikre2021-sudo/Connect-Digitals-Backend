-- Add PENDING value to CampaignStatus enum.
-- The initial migration created CampaignStatus without PENDING:
--   ('DRAFT', 'ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED', 'FAILED')
-- The Prisma schema and backend code reference PENDING (status transitions
-- DRAFT → PENDING → ACTIVE), so the campaigns list and detail endpoints
-- crash with an invalid enum value error.

ALTER TYPE "CampaignStatus" ADD VALUE IF NOT EXISTS 'PENDING' AFTER 'DRAFT';
