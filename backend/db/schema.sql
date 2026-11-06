-- AI Code Reviewer: standalone, idempotent bootstrap for a full local setup (plan 022).
-- `npm run db:setup` applies it to DATABASE_URL and `npm run db:setup:test` to TEST_DATABASE_URL;
-- `npm run dev` and `npm start` run it first. Safe to run any number of times: it only creates
-- what is missing and never drops or rewrites data.
-- Keep it aligned with `db/migration/*.sql` (`.rule/database-rules.md`).
-- The default settings, the demo account and the GitHub state rows are seeded by the backend
-- on start (they come from `src/data/*.json`); this script seeds only the `org` row.

CREATE TABLE IF NOT EXISTS org (
  id text PRIMARY KEY,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb
);

INSERT INTO org (id, name) VALUES ('default', 'Default') ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS review (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES org(id),
  title text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'queued', 'in_progress', 'completed', 'failed', 'cancelled')),
  language text NOT NULL,
  content text NOT NULL,
  quality_score double precision NOT NULL DEFAULT 0,
  saved_name text NULL,
  saved_language text NULL,
  saved_code text NULL,
  saved_at timestamptz NULL,
  run integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL,
  analyzed_at timestamptz NOT NULL,
  deleted_at timestamptz NULL,
  -- Insertion order: breaks created_at ties so History keeps newest first, like the memory store.
  insert_order bigint GENERATED ALWAYS AS IDENTITY
);

CREATE INDEX IF NOT EXISTS review_org_id_created_at_idx ON review (org_id, created_at DESC, insert_order DESC) WHERE deleted_at IS NULL;

-- One row per item, in the analyzer's order (`position`), deleted with their review. The
-- primary key (review_id, position) is the index on review_id.
CREATE TABLE IF NOT EXISTS finding (
  review_id text NOT NULL REFERENCES review(id) ON DELETE CASCADE,
  position integer NOT NULL,
  org_id text NOT NULL REFERENCES org(id),
  id text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('info', 'low', 'medium', 'high', 'critical')),
  category text NOT NULL,
  message text NOT NULL,
  detail text NOT NULL,
  line_start integer NOT NULL,
  PRIMARY KEY (review_id, position)
);

CREATE TABLE IF NOT EXISTS suggestion (
  review_id text NOT NULL REFERENCES review(id) ON DELETE CASCADE,
  position integer NOT NULL,
  org_id text NOT NULL REFERENCES org(id),
  id text NOT NULL,
  title text NOT NULL,
  detail text NOT NULL,
  PRIMARY KEY (review_id, position)
);

CREATE TABLE IF NOT EXISTS generated_test (
  review_id text NOT NULL REFERENCES review(id) ON DELETE CASCADE,
  position integer NOT NULL,
  org_id text NOT NULL REFERENCES org(id),
  id text NOT NULL,
  source_file text NOT NULL,
  test_file text NOT NULL,
  language text NOT NULL,
  repo text NULL,
  code text NOT NULL,
  alt_code text NOT NULL,
  PRIMARY KEY (review_id, position)
);

-- One settings document per org, the shape of the `Settings` DTO.
CREATE TABLE IF NOT EXISTS setting (
  org_id text PRIMARY KEY REFERENCES org(id),
  data jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- One account per org (plan 028: every registered account gets its own org). Only a scrypt hash
-- of the password is kept. `avatar_url` is unused since plan 028 (the photo is `account_avatar`).
CREATE TABLE IF NOT EXISTS account (
  org_id text PRIMARY KEY REFERENCES org(id),
  full_name text NOT NULL,
  email text NOT NULL,
  avatar_url text NULL,
  member_since text NOT NULL,
  password_hash text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS github_connection (
  org_id text PRIMARY KEY REFERENCES org(id),
  connected boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS support_request (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id text NOT NULL REFERENCES org(id),
  ticket text NOT NULL,
  issue_type text NOT NULL,
  email text NOT NULL,
  review_id text NOT NULL,
  priority text NOT NULL,
  description text NOT NULL,
  created_at timestamptz NOT NULL
);

-- Support tickets are SUP-1001 to SUP-9999, then wrap (`TICKET` in src/utils/constants.ts).
CREATE SEQUENCE IF NOT EXISTS support_ticket_seq START 1001 MINVALUE 1001 MAXVALUE 9999 CYCLE;

-- Plan 028 (same as db/migration/002-session.sql, additive and idempotent): the sign-in user
-- name, the unique indexes, sessions and the profile photo. A database built before keeps its
-- `default` data; the demo account gets its user name when missing (Open Question 8).
ALTER TABLE account ADD COLUMN IF NOT EXISTS username text;
UPDATE account SET username = 'john.doe' WHERE org_id = 'default' AND username IS NULL;
ALTER TABLE account ALTER COLUMN username SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS account_username_lower_idx ON account (lower(username));
CREATE UNIQUE INDEX IF NOT EXISTS account_email_lower_idx ON account (lower(email));

-- Only the SHA-256 hash of the session id is kept, never the id.
CREATE TABLE IF NOT EXISTS session (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES account(org_id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  absolute_expires_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS session_org_id_idx ON session (org_id);

-- The profile photo as uploaded (PNG, JPEG or WebP, at most 2 MB, checked by magic bytes).
CREATE TABLE IF NOT EXISTS account_avatar (
  org_id text PRIMARY KEY REFERENCES account(org_id) ON DELETE CASCADE,
  content_type text NOT NULL CHECK (content_type IN ('image/png', 'image/jpeg', 'image/webp')),
  data bytea NOT NULL,
  digest text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS support_request_org_id_idx ON support_request (org_id);

-- Plan 030 (same as db/migration/003-github-login.sql, additive and idempotent): the connected
-- GitHub user's login and display name. Nullable: a row is connected only when `connected` is
-- true and `login` is set, so a row from before reads as not connected.
ALTER TABLE github_connection ADD COLUMN IF NOT EXISTS login text;
ALTER TABLE github_connection ADD COLUMN IF NOT EXISTS display_name text;

-- Plan 034 (same as db/migration/004-test-config.sql, additive and idempotent): the review's test
-- configuration ({ framework, testTypeIdList }, the contract's TestConfig). Nullable: a review
-- without one (every review from before) reads as the default configuration.
ALTER TABLE review ADD COLUMN IF NOT EXISTS test_config jsonb NULL;

-- Plan 039 (same as db/migration/005-failure-reason.sql, additive and idempotent): why a review
-- failed (the contract's FailureReason). Nullable: set only on a failed review, cleared by a new
-- run, and null on every review from before.
ALTER TABLE review ADD COLUMN IF NOT EXISTS failure_reason text NULL;

-- Plan 040 (same as db/migration/006-github-identity.sql, additive and idempotent): the sign-in
-- identity of an account ("Continue with GitHub") and a nullable password hash. The identity key
-- is GitHub's numeric user id, never the login; one identity per provider per account; no token.
-- An account created through GitHub has no password (`password_hash` NULL).
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
