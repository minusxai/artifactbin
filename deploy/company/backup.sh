#!/bin/sh
# One application writer: stop it before taking either half of the snapshot.
set -eu
cd "$(dirname "$0")"
umask 077
mkdir -p backups
exec 9>backups/.lock
flock -n 9 || { echo 'Another backup/restore is running' >&2; exit 1; }
destination=${1:-"backups/$(date -u +%Y%m%dT%H%M%SZ)"}
[ ! -e "$destination" ] || { echo 'Backup destination already exists' >&2; exit 1; }
mkdir -p "$destination"
destination=$(cd "$destination" && pwd)
docker compose stop app
trap 'docker compose start app >&2' EXIT HUP INT TERM
docker compose exec -T postgres pg_dump -U artifactbin -d artifactbin --format=custom >"$destination/database.dump"
docker compose run -T --rm --no-deps --entrypoint tar volume-init -C /data -czf - . >"$destination/artifacts.tar.gz"
mkdir -p packages
tar -czf "$destination/configuration.tar.gz" packages .env config secrets Caddyfile dns-provider.caddy compose.yaml Dockerfile Caddy.Dockerfile caddy-entrypoint.sh
printf '%s\n' 'Consistent backup complete. Contains login/provider secrets: encrypt and copy off this server.' >&2
