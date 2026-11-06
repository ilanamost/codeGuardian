-- Migration 001 (plan 022): the initial PostgreSQL schema. Same intent as `db/schema.sql`
-- (the idempotent bootstrap that `npm run db:setup` applies); this file is the versioned
-- record of the change, for a database that is migrated step by step instead. Apply it once,
-- to an empty database. Any later schema change adds `002-*.sql` here and updates schema.sql.

BEGIN;

CREATE TABLE org (
  id text PRIMARY KEY,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb
);

INSERT INTO org (id, name) VALUES ('default', 'Default') ON CONFLICT (id) DO NOTHING;

CREATE TABLE review (
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

CREATE INDEX review_org_id_created_at_idx ON review (org_id, created_at DESC, insert_order DESC) WHERE deleted_at IS NULL;

-- One row per item, in the analyzer's order (`position`), deleted with their review. The
-- primary key (review_id, position) is the index on review_id.
CREATE TABLE finding (
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

CREATE TABLE suggestion (
  review_id text NOT NULL REFERENCES review(id) ON DELETE CASCADE,
  position integer NOT NULL,
  org_id text NOT NULL REFERENCES org(id),
  id text NOT NULL,
  title text NOT NULL,
  detail text NOT NULL,
  PRIMARY KEY (review_id, position)
);

CREATE TABLE generated_test (
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
CREATE TABLE setting (
  org_id text PRIMARY KEY REFERENCES org(id),
  data jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- One account per org until auth arrives. Only a scrypt hash of the password is kept.
CREATE TABLE account (
  org_id text PRIMARY KEY REFERENCES org(id),
  full_name text NOT NULL,
  email text NOT NULL,
  avatar_url text NULL,
  member_since text NOT NULL,
  password_hash text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE github_connection (
  org_id text PRIMARY KEY REFERENCES org(id),
  connected boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE support_request (
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
CREATE SEQUENCE support_ticket_seq START 1001 MINVALUE 1001 MAXVALUE 9999 CYCLE;

COMMIT;
