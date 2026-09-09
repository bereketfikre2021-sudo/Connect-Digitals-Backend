-- Add brandLogoUrl column to AdminUser.
-- This column was present in the Prisma schema but was never included in
-- the initial migration, causing P2022 errors on every auth/me and logo
-- settings request.

ALTER TABLE "AdminUser"
  ADD COLUMN IF NOT EXISTS "brandLogoUrl" TEXT;
