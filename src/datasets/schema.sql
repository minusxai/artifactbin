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
 page_id text NOT NULL REFERENCES files(id) ON DELETE CASCADE, source_namespace text NOT NULL, legacy_user_id text NOT NULL,
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
