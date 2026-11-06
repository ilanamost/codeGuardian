-- Migration 003 (plan 030, "Real GitHub repositories in the wizard"): additive. Apply once, after
-- 002-session.sql. Same intent as the plan 030 block at the end of `db/schema.sql`.
-- The GitHub connection row of an org keeps the connected user's GitHub `login` and display
-- name. Both are nullable: a row is connected only when `connected` is true AND `login` is set,
-- so every existing row (the mock flag of plans 022 and 028, without a login) reads as not
-- connected. No token is stored.
--
-- Rollback (harmless to leave in place; run only after the code is reverted):
--   BEGIN;
--   ALTER TABLE github_connection DROP COLUMN IF EXISTS display_name;
--   ALTER TABLE github_connection DROP COLUMN IF EXISTS login;
--   COMMIT;

BEGIN;

ALTER TABLE github_connection ADD COLUMN login text;
ALTER TABLE github_connection ADD COLUMN display_name text;

COMMIT;
