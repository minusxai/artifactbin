-- Pagegi v2 schema. Clean break from the 12-character document IDs: a v1 database is set aside, not migrated.
CREATE TABLE IF NOT EXISTS accounts (actor text PRIMARY KEY, salt text, password text, name text, image text, space text NOT NULL DEFAULT gen_random_uuid()::text);
CREATE UNIQUE INDEX IF NOT EXISTS accounts_space ON accounts(space);
CREATE TABLE IF NOT EXISTS sessions (token_hash text PRIMARY KEY, actor text NOT NULL REFERENCES accounts(actor), file_id text, generation integer, expires bigint NOT NULL, purpose text, backend_version text);
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires);
CREATE TABLE IF NOT EXISTS email_challenges (email text PRIMARY KEY, digest text NOT NULL, salt text NOT NULL, expires bigint NOT NULL, attempts integer NOT NULL, sent_at bigint NOT NULL, window_start bigint NOT NULL, sends integer NOT NULL);

-- A v1 database (files without next_node_id) is set aside once as <schema>_v1: its pages are not served,
-- nothing of it is dropped, and accounts carry over. Remove the _v1 schema deliberately when it is no longer wanted.
DO $$ DECLARE t text; aside text := current_schema() || '_v1'; BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'files' AND column_name = 'share_hash')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'files' AND column_name = 'next_node_id') THEN
    EXECUTE format('CREATE SCHEMA IF NOT EXISTS %I', aside);
    FOREACH t IN ARRAY ARRAY['document_ids', 'backend_heads', 'backend_versions', 'comments', 'snapshots', 'sources', 'publications', 'folders', 'files'] LOOP
      EXECUTE format('ALTER TABLE IF EXISTS %I.%I SET SCHEMA %I', current_schema(), t, aside);
    END LOOP;
  END IF;
END $$;

-- Every file ID, page or backend: who owns it, the reservation that created it, and whether a file is published under it.
CREATE TABLE IF NOT EXISTS file_ids (id text PRIMARY KEY CHECK (id ~ '^[A-Za-z0-9]{6}$'), owner text NOT NULL REFERENCES accounts(actor), reservation_key text, ordinal integer, kind text CHECK (kind IN ('page','backend')), published boolean NOT NULL DEFAULT false, created_at bigint NOT NULL, CHECK (published = (kind IS NOT NULL)));
CREATE UNIQUE INDEX IF NOT EXISTS file_ids_reservation ON file_ids(owner, reservation_key, ordinal) WHERE reservation_key IS NOT NULL;

-- Pages. head is the current integer version as text, so sources and comments key on it.
-- seed: the published data-af="state" block, where each viewer's own local state starts.
CREATE TABLE IF NOT EXISTS files (id text PRIMARY KEY REFERENCES file_ids(id), owner text NOT NULL REFERENCES accounts(actor), share_hash text NOT NULL, generation integer NOT NULL, head text NOT NULL CHECK (head ~ '^[1-9][0-9]*$'), sequence bigint NOT NULL DEFAULT 0, share text, path text, access jsonb, seed jsonb, next_node_id integer NOT NULL DEFAULT 1, source_digest text);
-- Local state is per viewer now: the old server-held shared state becomes the page's seed, once.
ALTER TABLE files ADD COLUMN IF NOT EXISTS seed jsonb;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'files' AND column_name = 'shared') THEN
    UPDATE files SET seed = shared->'snapshot'->'state' WHERE seed IS NULL AND jsonb_typeof(shared->'snapshot'->'state') = 'object';
    ALTER TABLE files DROP COLUMN shared;
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS files_owner_path ON files(owner,path);
CREATE TABLE IF NOT EXISTS folders (owner text NOT NULL REFERENCES accounts(actor), path text NOT NULL, PRIMARY KEY(owner,path));
-- One row per saved version; node_ids are never reassigned by later versions.
CREATE TABLE IF NOT EXISTS sources (file_id text NOT NULL REFERENCES files(id), revision text NOT NULL, content text NOT NULL, node_ids jsonb NOT NULL DEFAULT '[]'::jsonb, digest text, PRIMARY KEY(file_id,revision));
CREATE TABLE IF NOT EXISTS snapshots (file_id text NOT NULL REFERENCES files(id), id text NOT NULL, source_revision text NOT NULL, schema_version integer NOT NULL, state jsonb NOT NULL, view jsonb NOT NULL, rendered text, PRIMARY KEY(file_id,id), FOREIGN KEY(file_id,source_revision) REFERENCES sources(file_id,revision));
CREATE TABLE IF NOT EXISTS comments (file_id text NOT NULL REFERENCES files(id), id text NOT NULL, node_id text, quote text NOT NULL, body text NOT NULL, source_revision text NOT NULL, parent_id text, app_state_id text, published_by text NOT NULL REFERENCES accounts(actor), created_at text NOT NULL, revision integer NOT NULL, resolved boolean NOT NULL, fingerprint text NOT NULL, sequence bigint NOT NULL, PRIMARY KEY(file_id,id), UNIQUE(file_id,sequence), FOREIGN KEY(file_id,source_revision) REFERENCES sources(file_id,revision), FOREIGN KEY(file_id,app_state_id) REFERENCES snapshots(file_id,id), FOREIGN KEY(file_id,parent_id) REFERENCES comments(file_id,id) DEFERRABLE INITIALLY DEFERRED);
-- Publish idempotency: owner and requestId identify the first result.
CREATE TABLE IF NOT EXISTS publications (request_key text PRIMARY KEY, file_id text NOT NULL REFERENCES files(id), fingerprint text NOT NULL, path text NOT NULL);
CREATE TABLE IF NOT EXISTS migrations (id text PRIMARY KEY, completed_at timestamptz NOT NULL DEFAULT now());
-- Comment polling: the page change counter (files.sequence) when a comment was created or last edited. NULL on rows written before it existed means its sequence.
ALTER TABLE comments ADD COLUMN IF NOT EXISTS changed bigint;
CREATE INDEX IF NOT EXISTS comments_changed ON comments(file_id, (COALESCE(changed, sequence)));
-- Idempotency-Key results for page saves and comments, per page and account, kept for IDEMPOTENCY_TTL_MS (src/server/af-api-contracts.ts).
CREATE TABLE IF NOT EXISTS idempotency_keys (file_id text NOT NULL, actor text NOT NULL, key text NOT NULL, fingerprint text NOT NULL, status integer NOT NULL, response jsonb NOT NULL, created_at bigint NOT NULL, PRIMARY KEY(file_id, actor, key));
CREATE INDEX IF NOT EXISTS idempotency_keys_created ON idempotency_keys(created_at);
-- IDs of deleted pages. Their file_ids rows are gone; these are never handed out again.
CREATE TABLE IF NOT EXISTS retired_file_ids (id text PRIMARY KEY, retired_at bigint NOT NULL);
-- Account secrets: values a lambda reads as `env`, encrypted at rest under PAGEGI_SECRETS_KEY (src/server/secrets-contracts.ts). Times are epoch milliseconds.
CREATE TABLE IF NOT EXISTS account_secrets (actor text NOT NULL REFERENCES accounts(actor), name text NOT NULL CHECK (name ~ '^[A-Z][A-Z0-9_]{0,63}$'), ciphertext text NOT NULL, created_at bigint NOT NULL, updated_at bigint NOT NULL, PRIMARY KEY(actor, name));
-- Account handles: the optional public name in /@<handle>/<path> addresses, stored lowercase (src/server/handles-contracts.ts). Existing accounts have none.
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS handle text CHECK (handle ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(handle) BETWEEN 3 AND 32);
CREATE UNIQUE INDEX IF NOT EXISTS accounts_handle ON accounts(handle);

-- Imported comments can outlive their original source; never attach them to another version.
ALTER TABLE comments ALTER COLUMN source_revision DROP NOT NULL;
ALTER TABLE comments ADD COLUMN IF NOT EXISTS context_status jsonb;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'comments'::regclass AND conname = 'comments_context_status') THEN
    ALTER TABLE comments ADD CONSTRAINT comments_context_status CHECK (COALESCE((
      (source_revision IS NOT NULL AND context_status IS NULL) OR
      (source_revision IS NULL AND node_id IS NULL AND app_state_id IS NULL AND context_status IS NOT NULL
       AND context_status->>'status' = 'unavailable'
       AND context_status->>'reason' = 'not-retained'
       AND jsonb_typeof(context_status->'originalRevision') = 'string'
       AND length(context_status->>'originalRevision') > 0)
    ), false));
  END IF;
END $$;
-- Non-login group principals preserve ownership while keeping real actors distinct.
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS principal_kind text NOT NULL DEFAULT 'user' CHECK (principal_kind IN ('user','group'));
CREATE TABLE IF NOT EXISTS groups (owner text PRIMARY KEY REFERENCES accounts(actor), active boolean NOT NULL DEFAULT true);
CREATE TABLE IF NOT EXISTS group_memberships (owner text NOT NULL REFERENCES groups(owner), actor text NOT NULL REFERENCES accounts(actor), role text NOT NULL CHECK (role IN ('viewer','editor')), PRIMARY KEY(owner,actor));
CREATE INDEX IF NOT EXISTS group_memberships_actor ON group_memberships(actor,owner);
CREATE OR REPLACE FUNCTION enforce_group_principal() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.actor ~ '^legacy-(user|token|orphan):[a-f0-9]{64}$' AND (NEW.salt IS NOT NULL OR NEW.password IS NOT NULL OR NEW.handle IS NOT NULL) THEN RAISE EXCEPTION 'Archival principals cannot have login credentials'; END IF;
 IF NEW.principal_kind='group' AND (NEW.actor NOT LIKE 'group:%' OR NEW.salt IS NOT NULL OR NEW.password IS NOT NULL) THEN RAISE EXCEPTION 'Groups cannot have login credentials'; END IF;
 IF TG_OP='UPDATE' AND NEW.principal_kind<>OLD.principal_kind THEN RAISE EXCEPTION 'Principal kinds are immutable'; END IF;
 RETURN NEW; END $$;
DROP TRIGGER IF EXISTS group_principal_guard ON accounts;
CREATE TRIGGER group_principal_guard BEFORE INSERT OR UPDATE ON accounts FOR EACH ROW EXECUTE FUNCTION enforce_group_principal();
CREATE OR REPLACE FUNCTION enforce_person_session() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.actor ~ '^legacy-(user|token|orphan):[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Archival principals cannot authenticate'; END IF;
 IF NOT EXISTS(SELECT 1 FROM accounts WHERE actor=NEW.actor AND principal_kind='user') THEN RAISE EXCEPTION 'Only users can authenticate'; END IF;
 RETURN NEW; END $$;
DROP TRIGGER IF EXISTS person_session_guard ON sessions;
CREATE TRIGGER person_session_guard BEFORE INSERT OR UPDATE ON sessions FOR EACH ROW EXECUTE FUNCTION enforce_person_session();
CREATE OR REPLACE FUNCTION enforce_group_membership() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_TABLE_NAME='groups' THEN
  IF NOT EXISTS(SELECT 1 FROM accounts WHERE actor=NEW.owner AND principal_kind='group') THEN RAISE EXCEPTION 'Group requires a group principal'; END IF;
 ELSE
  IF NOT EXISTS(SELECT 1 FROM accounts WHERE actor=NEW.actor AND principal_kind='user') THEN RAISE EXCEPTION 'Group member requires a user principal'; END IF;
 END IF;
 RETURN NEW; END $$;
DROP TRIGGER IF EXISTS group_owner_guard ON groups;
CREATE TRIGGER group_owner_guard BEFORE INSERT OR UPDATE ON groups FOR EACH ROW EXECUTE FUNCTION enforce_group_membership();
DROP TRIGGER IF EXISTS group_member_guard ON group_memberships;
CREATE TRIGGER group_member_guard BEFORE INSERT OR UPDATE ON group_memberships FOR EACH ROW EXECUTE FUNCTION enforce_group_membership();

-- Immutable imported binary descriptors belong to their own HTML page and exact saved revision.
-- Only verified SHA-256 names resolve in the private, read-only media mount; no authored paths.
CREATE TABLE IF NOT EXISTS page_assets (
  page_id text NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  revision text NOT NULL CHECK (revision ~ '^[1-9][0-9]*$'),
  variant text NOT NULL CHECK (variant IN ('original','small')),
  sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  content_type text NOT NULL CHECK (content_type ~ '^[A-Za-z0-9!#$&^_.+-]+/[A-Za-z0-9!#$&^_.+-]+$'),
  filename text,
  byte_length bigint NOT NULL CHECK (byte_length BETWEEN 0 AND 9007199254740991),
  storage_key text NOT NULL CHECK (storage_key = sha256),
  PRIMARY KEY (page_id, revision, variant),
  FOREIGN KEY (page_id, revision) REFERENCES sources(file_id,revision) ON DELETE CASCADE
);
-- Trash keeps the original file, versions, IDs, and quota usage indefinitely.
ALTER TABLE files ADD COLUMN IF NOT EXISTS deleted_at bigint;
ALTER TABLE files ADD COLUMN IF NOT EXISTS trash_path text;
DROP INDEX IF EXISTS files_owner_path;
CREATE UNIQUE INDEX IF NOT EXISTS files_owner_path ON files(owner,path) WHERE deleted_at IS NULL;
CREATE TABLE IF NOT EXISTS trash_folders (id text PRIMARY KEY,owner text NOT NULL REFERENCES accounts(actor),path text NOT NULL,deleted_at bigint NOT NULL,folders jsonb NOT NULL,file_ids jsonb NOT NULL);
ALTER TABLE files ADD COLUMN IF NOT EXISTS trash_batch text;

-- Imported raster proofs. Source object keys stay in private migration receipts.
CREATE TABLE IF NOT EXISTS profile_assets (
  source_namespace text NOT NULL,
  legacy_user_id text NOT NULL,
  asset_id text NOT NULL CHECK (asset_id ~ '^[a-f0-9]{64}$'),
  sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  byte_length bigint NOT NULL CHECK (byte_length > 0),
  width integer NOT NULL CHECK (width > 0),
  height integer NOT NULL CHECK (height > 0),
  content_type text NOT NULL CHECK (content_type = 'image/webp'),
  storage_key text NOT NULL CHECK (storage_key = sha256),
  PRIMARY KEY(source_namespace,asset_id)
);
CREATE TABLE IF NOT EXISTS comment_attachment_assets (
  page_id text NOT NULL,
  comment_id text NOT NULL,
  attachment_id text NOT NULL,
  variant text NOT NULL CHECK (variant IN ('original','preview','thumbnail')),
  name text NOT NULL,
  sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  byte_length bigint NOT NULL CHECK (byte_length > 0),
  width integer NOT NULL CHECK (width > 0),
  height integer NOT NULL CHECK (height > 0),
  content_type text NOT NULL CHECK (content_type = 'image/webp'),
  storage_key text NOT NULL CHECK (storage_key = sha256),
  PRIMARY KEY(page_id,comment_id,attachment_id,variant),
  FOREIGN KEY(page_id,comment_id) REFERENCES comments(file_id,id)
);
