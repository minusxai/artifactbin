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
