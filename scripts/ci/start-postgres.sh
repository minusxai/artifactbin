#!/usr/bin/env bash
set -euo pipefail
docker run --detach --rm --name pagegi-test-db \
  --publish 55432:5432 \
  --env POSTGRES_USER=pagegi --env POSTGRES_PASSWORD=pagegi-local --env POSTGRES_DB=pagegi \
  postgres:17-alpine
pagegi_ready_deadline=$((SECONDS + 30))
while (( SECONDS < pagegi_ready_deadline )); do
  # TCP stays closed during the entrypoint's initial temporary Unix-only server.
  if timeout 2s docker exec pagegi-test-db pg_isready --host 127.0.0.1 --username pagegi --dbname pagegi; then
    printf 'PostgreSQL ready: %ss\n' "$SECONDS"
    exit 0
  fi
  sleep 0.2
done
echo 'PostgreSQL did not become ready' >&2
exit 1
