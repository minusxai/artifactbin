-- Backend files (brief C). Run after the server schema; every statement is idempotent.

-- One row per published backend file: who owns it and its latest version.
CREATE TABLE IF NOT EXISTS af_backend_files (
  file_id text PRIMARY KEY CHECK (file_id ~ '^[A-Za-z0-9]{6}$'),
  owner text NOT NULL,
  head_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Compiled versions. The version is a digest of the file's source and schema,
-- so an unchanged file keeps its version across
-- saves, image rebuilds and runtime upgrades; a recompile replaces only the
-- deployment.
CREATE TABLE IF NOT EXISTS af_backend_versions (
  file_id text NOT NULL REFERENCES af_backend_files (file_id),
  version text NOT NULL,
  page_id text NOT NULL,
  page_version integer NOT NULL,
  type_defs text NOT NULL,
  deployment jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (file_id, version)
);

-- The backend links of each page version, in page order.
CREATE TABLE IF NOT EXISTS af_page_backends (
  page_id text NOT NULL,
  page_version integer NOT NULL,
  position integer NOT NULL,
  name text NOT NULL,
  file_id text NOT NULL,
  version text NOT NULL,
  PRIMARY KEY (page_id, page_version, position),
  UNIQUE (page_id, page_version, name),
  FOREIGN KEY (file_id, version) REFERENCES af_backend_versions (file_id, version)
);

-- The page version whose links are current.
CREATE TABLE IF NOT EXISTS af_backend_pages (
  page_id text PRIMARY KEY,
  page_version integer NOT NULL
);

-- caps.store: each backend file's one JSON document, shared by every page and
-- viewer that calls the file. version counts writes, for compare-and-swap.
CREATE TABLE IF NOT EXISTS af_backend_stores (
  file_id text PRIMARY KEY REFERENCES af_backend_files (file_id),
  version bigint NOT NULL CHECK (version > 0),
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Backends run for every viewer who can open the page; per-viewer approvals are gone.
DROP TABLE IF EXISTS af_backend_approvals;
