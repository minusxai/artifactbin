#!/bin/sh
# Runs only on a fresh, independent PostgreSQL volume; never against another deployment.
set -eu
: "${ARTEFACTV2_APP_DATABASE_PASSWORD:?application database password is required}"
# psql reads the password from the environment inside SQL: no password in process arguments.
psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set=ON_ERROR_STOP=1 <<'SQL'
\getenv app_password ARTEFACTV2_APP_DATABASE_PASSWORD
CREATE ROLE artefactv2 LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD :'app_password';
REVOKE ALL ON DATABASE artefactv2 FROM PUBLIC;
REVOKE CONNECT ON DATABASE postgres FROM PUBLIC;
REVOKE CONNECT ON DATABASE template1 FROM PUBLIC;
GRANT CONNECT, CREATE, TEMPORARY ON DATABASE artefactv2 TO artefactv2;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
ALTER SCHEMA public OWNER TO artefactv2;
SQL
