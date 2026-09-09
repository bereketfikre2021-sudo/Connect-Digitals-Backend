-- Fix AuditLog foreign key conflict.
--
-- The init migration created TWO foreign keys on the same actorId column:
--   AuditLog_adminActor_fkey    → AdminUser(id)
--   AuditLog_customerActor_fkey → User(id)
--
-- PostgreSQL enforces BOTH constraints, which means inserting an admin audit
-- log entry (actorId = AdminUser.id) violates the customerActor_fkey because
-- that ID does not exist in the User table — causing P2003 on every admin login.
--
-- Fix: drop the customerActor_fkey. The adminActor_fkey alone is correct for
-- admin-originated log entries. Customer-originated entries use actorType=CUSTOMER
-- but the actorId constraint was never reliably enforceable on a shared column.
-- The actorType enum is the discriminator; FK enforcement here causes more harm
-- than it prevents.

ALTER TABLE "AuditLog"
  DROP CONSTRAINT IF EXISTS "AuditLog_customerActor_fkey";
