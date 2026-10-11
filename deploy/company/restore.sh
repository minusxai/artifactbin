#!/bin/sh
# Restore only into a new deployment directory and empty data volumes.
set -eu
cd "$(dirname "$0")"
umask 077
[ "$#" = 1 ] || { echo 'Usage: ./restore.sh /absolute/backup-directory' >&2; exit 1; }
source=$(cd "$1" && pwd)
for file in database.dump artifacts.tar.gz configuration.tar.gz; do [ -s "$source/$file" ] || { echo "Missing $file" >&2; exit 1; }; done
[ ! -e .env ] && [ ! -e config/server.env ] || { echo 'Restore requires a fresh deployment directory; existing secrets will not be overwritten' >&2; exit 1; }
# The archive is trusted operator output; never restore an untrusted archive.
tar -xzf "$source/configuration.tar.gz"
docker compose build
docker compose up -d --wait postgres
docker compose run -T --rm volume-init
count=$(docker compose exec -T postgres psql -U artifactbin -d artifactbin -Atc "SELECT count(*) FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema')")
[ "$count" = 0 ] || { echo 'Database is not empty; restore refused' >&2; exit 1; }
docker compose run -T --rm --no-deps --entrypoint sh volume-init -c 'test -z "$(ls -A /data)"' || { echo 'Artifact volume is not empty; restore refused' >&2; exit 1; }
docker compose exec -T postgres pg_restore -U artifactbin -d artifactbin --exit-on-error <"$source/database.dump"
docker compose run -T --rm --no-deps --entrypoint tar volume-init -C /data -xzf - <"$source/artifacts.tar.gz"
docker compose up -d
printf '%s\n' 'Restore completed. Verify owner login, a private document and CLI read before reopening access.' >&2
