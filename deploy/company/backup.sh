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
# /data/chromium is the package's re-installable browser download (hundreds of MB, most of the archive time);
# the restored app reinstalls it on its first export, or at once with `afbin setup --service chromium`.
docker compose run -T --rm --no-deps --entrypoint tar volume-init -C /data --exclude=./chromium -czf - . >"$destination/artifacts.tar.gz"
mkdir -p packages
set -- packages backup.sh restore.sh .env config secrets Caddyfile dns-provider.caddy compose.yaml Dockerfile Caddy.Dockerfile caddy-entrypoint.sh
# New images share this build input; older deployment contexts did not have it.
[ ! -f patch-npm.mjs ] || set -- "$@" patch-npm.mjs
[ ! -d runtime-source ] || set -- "$@" runtime-source
tar -czf "$destination/configuration.tar.gz" "$@"
printf '%s\n' 'Consistent backup complete. Contains login/provider secrets: encrypt and copy off this server.' >&2
