-- Migration 005 (plan 039, "Review process with an LLM"): additive and idempotent, so applying it
-- twice, or after `db/schema.sql` already added the column, changes nothing. Apply after
-- 004-test-config.sql. Same intent as the plan 039 block at the end of `db/schema.sql`.
-- The review keeps why it failed (the contract's FailureReason: ai_unavailable, ai_rate_limited,
-- ai_timeout, ai_invalid_output, ai_refused, ai_quota_exceeded, internal) so the page can say
-- what happened. Nullable, no default and no backfill: it is set only on a failed review, a new
-- run clears it, and every failed review from before reads as `internal`.
--
-- Rollback (harmless to leave in place; run only after the code is reverted):
--   BEGIN;
--   ALTER TABLE review DROP COLUMN IF EXISTS failure_reason;
--   COMMIT;

BEGIN;

ALTER TABLE review ADD COLUMN IF NOT EXISTS failure_reason text NULL;

COMMIT;
