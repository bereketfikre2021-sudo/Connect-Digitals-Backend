-- Add CHECK constraint to prevent negative wallet balances at the DB level.
-- This acts as a last-resort guard even if application code has a bug.
ALTER TABLE "Wallet"
  ADD CONSTRAINT "wallet_balance_non_negative"
  CHECK ("balanceETB" >= 0);
