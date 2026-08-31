-- The schemas the split shape's deployment truth declares (roles.sql):
--   CREATE SCHEMA app  AUTHORIZATION artifactbin_app;
--   CREATE SCHEMA auth AUTHORIZATION artifactbin_proxy;
-- This fixture runs one trusted user against one database, so there are no
-- roles to carve — only the SCHEMAS, so the app's boot DDL (unqualified,
-- following the search_path its DATABASE_URL carries) lands in `app` and the
-- proxy's token reader finds `app.tokens` where it looks. `auth` the proxy
-- also ensures itself at boot; created here too so the truth is one file.
--
-- Runs once, on the postgres volume's FIRST init (docker-entrypoint-initdb.d).
CREATE SCHEMA IF NOT EXISTS app;
CREATE SCHEMA IF NOT EXISTS auth;
