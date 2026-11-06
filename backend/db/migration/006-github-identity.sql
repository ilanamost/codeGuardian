-- Migration 006 (plan 040, "GitHub sign-in"): additive and idempotent, so applying it twice, or
-- after `db/schema.sql` already added it, changes nothing. Apply after 005-failure-reason.sql.
-- Same intent as the plan 040 block at the end of `db/schema.sql`.
-- (1) `account_identity`: the sign-in identity of an account. The key is the provider's numeric
-- user id (for GitHub, never the login: logins can be renamed and reused); `login` is only for
-- display. One identity per provider per account (the unique index on org_id and provider). No
-- token is stored.
-- (2) `account.password_hash` becomes nullable: an account created by "Continue with GitHub" has
-- no password. Every existing row keeps its hash.
--
-- Rollback (run only after the code is reverted; an account without a password hash must get a
-- hash or be deleted first, or SET NOT NULL fails):
--   BEGIN;
--   DROP TABLE IF EXISTS account_identity;
--   ALTER TABLE account ALTER COLUMN password_hash SET NOT NULL;
--   COMMIT;

BEGIN;

CREATE TABLE IF NOT EXISTS account_identity (
  provider text NOT NULL CHECK (provider IN ('github')),
  provider_user_id text NOT NULL,
  org_id text NOT NULL REFERENCES account(org_id) ON DELETE CASCADE,
  login text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, provider_user_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS account_identity_org_id_provider_idx ON account_identity (org_id, provider);

ALTER TABLE account ALTER COLUMN password_hash DROP NOT NULL;

COMMIT;
