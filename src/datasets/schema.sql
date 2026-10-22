-- Private dataset resources have no public routes and no raw row columns.
CREATE TABLE IF NOT EXISTS dataset_resources (
 source_namespace text NOT NULL, legacy_id text NOT NULL, current_version bigint NOT NULL CHECK(current_version > 0),
 policy_revision bigint NOT NULL CHECK(policy_revision >= 0), owner text NOT NULL REFERENCES accounts(actor),
 generation integer NOT NULL CHECK(generation > 0), access jsonb NOT NULL, deleted boolean NOT NULL DEFAULT false,
 snapshot jsonb NOT NULL, PRIMARY KEY(source_namespace,legacy_id)
);
CREATE TABLE IF NOT EXISTS dataset_versions (
 source_namespace text NOT NULL, legacy_id text NOT NULL, version bigint NOT NULL CHECK(version > 0), catalog jsonb NOT NULL, source_catalog jsonb NOT NULL, unavailable_tables jsonb NOT NULL,
 PRIMARY KEY(source_namespace,legacy_id,version), FOREIGN KEY(source_namespace,legacy_id) REFERENCES dataset_resources(source_namespace,legacy_id)
);
CREATE TABLE IF NOT EXISTS dataset_pages (
 page_id text NOT NULL REFERENCES files(id) ON DELETE CASCADE, page_version bigint NOT NULL CHECK(page_version > 0), source_namespace text NOT NULL,
 snapshot jsonb NOT NULL, PRIMARY KEY(page_id,page_version,source_namespace)
);
CREATE TABLE IF NOT EXISTS dataset_bindings (
 backend_id text NOT NULL, backend_version text NOT NULL, page_id text NOT NULL, page_version bigint NOT NULL,
 name text NOT NULL, source_namespace text NOT NULL, dataset_id text NOT NULL, dataset_version bigint NOT NULL,
 descriptor jsonb NOT NULL, PRIMARY KEY(backend_id,backend_version,page_id,page_version,name),
 FOREIGN KEY(page_id,page_version,source_namespace) REFERENCES dataset_pages(page_id,page_version,source_namespace) ON DELETE CASCADE,
 FOREIGN KEY(source_namespace,dataset_id,dataset_version) REFERENCES dataset_versions(source_namespace,legacy_id,version)
);
CREATE TABLE IF NOT EXISTS dataset_principals (
 source_namespace text NOT NULL, actor text NOT NULL REFERENCES accounts(actor), kind text NOT NULL CHECK(kind IN ('user','token')),
 legacy_id text NOT NULL, identity text NOT NULL CHECK(identity IN ('user','guest','testuser')), expires_at timestamptz,
 PRIMARY KEY(source_namespace,actor,kind,legacy_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS dataset_principals_legacy_identity ON dataset_principals(source_namespace,kind,legacy_id);
CREATE UNIQUE INDEX IF NOT EXISTS dataset_principals_user_actor ON dataset_principals(source_namespace,actor) WHERE kind='user';
CREATE TABLE IF NOT EXISTS dataset_groups (
 source_namespace text NOT NULL, owner text NOT NULL REFERENCES groups(owner), legacy_group_id text NOT NULL,
 PRIMARY KEY(source_namespace,legacy_group_id)
);
CREATE TABLE IF NOT EXISTS dataset_page_joins (
 page_id text NOT NULL REFERENCES files(id) ON DELETE CASCADE, source_namespace text NOT NULL, legacy_user_id text NOT NULL, joined_at timestamptz,
 PRIMARY KEY(page_id,source_namespace,legacy_user_id)
);
-- A saved binding/catalog/page snapshot is append-only; policy lives on dataset_resources.
CREATE OR REPLACE FUNCTION immutable_dataset_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Dataset version metadata is immutable'; END $$;
DROP TRIGGER IF EXISTS dataset_versions_immutable ON dataset_versions;
CREATE TRIGGER dataset_versions_immutable BEFORE UPDATE OR DELETE ON dataset_versions FOR EACH ROW EXECUTE FUNCTION immutable_dataset_version();
DROP TRIGGER IF EXISTS dataset_bindings_immutable ON dataset_bindings;
CREATE TRIGGER dataset_bindings_immutable BEFORE UPDATE ON dataset_bindings FOR EACH ROW EXECUTE FUNCTION immutable_dataset_version();
DROP TRIGGER IF EXISTS dataset_pages_immutable ON dataset_pages;
CREATE TRIGGER dataset_pages_immutable BEFORE UPDATE ON dataset_pages FOR EACH ROW EXECUTE FUNCTION immutable_dataset_version();

-- Identity assignments cannot be rewritten; expiry alone may change to revoke eligibility.
DROP TRIGGER IF EXISTS dataset_principals_identity_immutable ON dataset_principals;
CREATE TRIGGER dataset_principals_identity_immutable BEFORE UPDATE OF source_namespace,actor,kind,legacy_id,identity ON dataset_principals FOR EACH ROW EXECUTE FUNCTION immutable_dataset_version();

-- Read-only is the safe default for metadata imported before mutation support.
ALTER TABLE dataset_resources ADD COLUMN IF NOT EXISTS writable boolean NOT NULL DEFAULT false;
-- Authored operations belong to one saved backend/page deployment and immutable Import binding.
CREATE TABLE IF NOT EXISTS dataset_mutation_operations (
 backend_id text NOT NULL, backend_version text NOT NULL, page_id text NOT NULL,
 page_version bigint NOT NULL CHECK(page_version>0), name text NOT NULL,
 source_namespace text NOT NULL, binding_name text NOT NULL, dataset_id text NOT NULL,
 operation jsonb NOT NULL,
 PRIMARY KEY(backend_id,backend_version,page_id,page_version,name),
 FOREIGN KEY(backend_id,backend_version,page_id,page_version,binding_name)
 REFERENCES dataset_bindings(backend_id,backend_version,page_id,page_version,name) ON DELETE CASCADE
);
DROP TRIGGER IF EXISTS dataset_operations_immutable ON dataset_mutation_operations;
CREATE TRIGGER dataset_operations_immutable BEFORE UPDATE ON dataset_mutation_operations FOR EACH ROW EXECUTE FUNCTION immutable_dataset_version();
-- No timeout or reclamation: an uncertain execution remains inflight forever.
CREATE TABLE IF NOT EXISTS dataset_mutation_receipts (
 scope_key text PRIMARY KEY CHECK(scope_key ~ '^[a-f0-9]{64}$'),
 fingerprint text NOT NULL CHECK(fingerprint ~ '^[a-f0-9]{64}$'),
 lease_id text NOT NULL UNIQUE, attempt integer NOT NULL DEFAULT 1 CHECK(attempt=1),
 context jsonb NOT NULL, operation jsonb NOT NULL, request jsonb NOT NULL,
 state text NOT NULL CHECK(state IN ('inflight','committed','refused')),
 result jsonb, refusal text, created_at bigint NOT NULL, completed_at bigint,
 CHECK((state='committed')=(result IS NOT NULL)), CHECK((state='refused')=(refusal IS NOT NULL))
);
-- Durable outbox: consumers may resume by sequence; never rely on process-local callbacks.
CREATE TABLE IF NOT EXISTS dataset_invalidations (
 sequence bigserial PRIMARY KEY, source_namespace text NOT NULL, dataset_id text NOT NULL,
 version bigint NOT NULL, generation integer NOT NULL, created_at bigint NOT NULL,
 UNIQUE(source_namespace,dataset_id,version)
);

ALTER TABLE dataset_page_joins ADD COLUMN IF NOT EXISTS joined_at timestamptz;

-- Serialize accepted-join insertions, removals and timestamp changes with readers
-- holding the executing page row. This also closes phantom insert races.
CREATE OR REPLACE FUNCTION lock_dataset_join_page() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP <> 'INSERT' THEN PERFORM id FROM files WHERE id=OLD.page_id FOR UPDATE; END IF;
 IF TG_OP <> 'DELETE' THEN PERFORM id FROM files WHERE id=NEW.page_id FOR UPDATE; RETURN NEW; END IF;
 RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS dataset_join_page_lock ON dataset_page_joins;
CREATE TRIGGER dataset_join_page_lock BEFORE INSERT OR UPDATE OR DELETE ON dataset_page_joins FOR EACH ROW EXECUTE FUNCTION lock_dataset_join_page();

CREATE TABLE IF NOT EXISTS dataset_member_bindings (
 backend_id text NOT NULL, backend_version text NOT NULL, page_id text NOT NULL REFERENCES files(id) ON DELETE CASCADE,
 page_version bigint NOT NULL CHECK(page_version>0), source_namespace text NOT NULL,
 PRIMARY KEY(backend_id,backend_version,page_id,page_version)
);
DROP TRIGGER IF EXISTS dataset_member_bindings_immutable ON dataset_member_bindings;
CREATE TRIGGER dataset_member_bindings_immutable BEFORE UPDATE ON dataset_member_bindings FOR EACH ROW EXECUTE FUNCTION immutable_dataset_version();

CREATE TABLE IF NOT EXISTS dataset_public_profiles (
 source_namespace text NOT NULL, legacy_user_id text NOT NULL, name text NOT NULL, handle text, image text,
 PRIMARY KEY(source_namespace,legacy_user_id)
);
DROP TRIGGER IF EXISTS dataset_profiles_immutable ON dataset_public_profiles;
CREATE TRIGGER dataset_profiles_immutable BEFORE UPDATE ON dataset_public_profiles FOR EACH ROW EXECUTE FUNCTION immutable_dataset_version();
CREATE TABLE IF NOT EXISTS dataset_person_bindings (
 backend_id text NOT NULL, backend_version text NOT NULL, page_id text NOT NULL REFERENCES files(id) ON DELETE CASCADE,
 page_version bigint NOT NULL, value_name text NOT NULL, source_namespace text NOT NULL, descriptor jsonb NOT NULL,
 PRIMARY KEY(backend_id,backend_version,page_id,page_version,value_name)
);
DROP TRIGGER IF EXISTS dataset_person_bindings_immutable ON dataset_person_bindings;
CREATE TRIGGER dataset_person_bindings_immutable BEFORE UPDATE ON dataset_person_bindings FOR EACH ROW EXECUTE FUNCTION immutable_dataset_version();

-- Offline compiler-owned query declarations. A saved source tuple can never be replaced.
CREATE TABLE IF NOT EXISTS dataset_query_registrations (
 backend_id text NOT NULL, backend_version text NOT NULL, page_id text NOT NULL,
 page_version bigint NOT NULL CHECK(page_version>0), source_sha256 text NOT NULL CHECK(source_sha256 ~ '^[a-f0-9]{64}$'),
 source_namespace text NOT NULL, registration jsonb NOT NULL,
 PRIMARY KEY(backend_id,backend_version,page_id,page_version),
 FOREIGN KEY(page_id,page_version,source_namespace) REFERENCES dataset_pages(page_id,page_version,source_namespace),
 FOREIGN KEY(backend_id,backend_version) REFERENCES af_backend_versions(file_id,version)
);
DROP TRIGGER IF EXISTS dataset_queries_immutable ON dataset_query_registrations;
CREATE TRIGGER dataset_queries_immutable BEFORE UPDATE OR DELETE ON dataset_query_registrations FOR EACH ROW EXECUTE FUNCTION immutable_dataset_version();
