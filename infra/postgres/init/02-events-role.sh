#!/bin/sh
# THE SPLIT SHAPE'S ROLES, for the one schema that has an owner other than the
# app: `events`. 01-schemas.sql runs one trusted user against one database and
# carves no roles — the app and the proxy connect as it — but the event log is
# owned by the service that alone WRITES it, and the app's read of it is a
# GRANT. A fixture with no roles could not prove that seam at all, so the two
# roles the grant needs are real here:
#
#   artifactbin_events  owns the `events` schema and connects as itself
#   artifactbin_app     is granted USAGE on it, and SELECT on the table once
#                       the events service's boot DDL has created it
#                       (the events-grants one-shot in docker-compose.lean.yml)
#
# The schema is created HERE rather than by the service, so the service's role
# needs no CREATE on the database — exactly the deployment truth roles.sql
# renders. Both roles share the fixture's one password; a real deployment gives
# each its own and never keeps either in a file.
#
# A shell file rather than more .sql because the passwords come from the
# environment, which psql cannot read from a plain script. Runs once, on the
# postgres volume's FIRST init (docker-entrypoint-initdb.d).
set -e
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<SQL
  CREATE ROLE artifactbin_app    LOGIN PASSWORD '$POSTGRES_PASSWORD';
  CREATE ROLE artifactbin_events LOGIN PASSWORD '$POSTGRES_PASSWORD';
  CREATE SCHEMA events AUTHORIZATION artifactbin_events;
  GRANT USAGE ON SCHEMA events TO artifactbin_app;
SQL
