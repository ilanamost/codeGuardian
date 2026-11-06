-- Migration 004 (plan 034, "UI fixes: editable account, multi-file import, working test
-- configuration"): additive and idempotent, so applying it twice, or after `db/schema.sql`
-- already added the column, changes nothing. Apply after 003-github-login.sql. Same intent as
-- the plan 034 block at the end of `db/schema.sql`.
-- The review keeps its test configuration ({ framework, testTypeIdList }, the contract's
-- TestConfig) as JSON. Nullable, no default and no backfill: every existing review reads as the
-- default configuration (Jest; unit, edge and error), whose generated tests are unchanged.
--
-- Rollback (harmless to leave in place; run only after the code is reverted):
--   BEGIN;
--   ALTER TABLE review DROP COLUMN IF EXISTS test_config;
--   COMMIT;

BEGIN;

ALTER TABLE review ADD COLUMN IF NOT EXISTS test_config jsonb NULL;

COMMIT;
