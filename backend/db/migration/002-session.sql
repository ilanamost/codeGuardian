-- Migration 002 (plan 028, "Session login and registration"): additive. Apply once, after
-- 001-init.sql. Same intent as the plan 028 block at the end of `db/schema.sql`.
-- Every registered account gets its own org, so `account` (primary key `org_id`) now has many
-- rows: the sign-in user name and the email are unique regardless of case. Sessions keep only
-- the SHA-256 hash of the session id. The profile photo is stored as uploaded. Data already in
-- the `default` org is kept: the demo account gets the user name `john.doe` (Open Question 8).

BEGIN;

ALTER TABLE account ADD COLUMN username text;
UPDATE account SET username = 'john.doe' WHERE org_id = 'default' AND username IS NULL;
ALTER TABLE account ALTER COLUMN username SET NOT NULL;
CREATE UNIQUE INDEX account_username_lower_idx ON account (lower(username));
CREATE UNIQUE INDEX account_email_lower_idx ON account (lower(email));

CREATE TABLE session (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES account(org_id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  absolute_expires_at timestamptz NOT NULL
);

CREATE INDEX session_org_id_idx ON session (org_id);

CREATE TABLE account_avatar (
  org_id text PRIMARY KEY REFERENCES account(org_id) ON DELETE CASCADE,
  content_type text NOT NULL CHECK (content_type IN ('image/png', 'image/jpeg', 'image/webp')),
  data bytea NOT NULL,
  digest text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX support_request_org_id_idx ON support_request (org_id);

COMMIT;
