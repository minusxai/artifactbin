#!/usr/bin/env bash
set -euo pipefail
# WebKit uses the matching image for its OS libraries. Other shards use the
# pinned host Node and browsers already proved by the prepare action.
if [ "${PAGEGI_CI_BROWSER_IMAGE:?Run the prepare action before CI tests}" = false ]; then
  export PAGEGI_BROWSER_DIAGNOSTICS_DIR="$RUNNER_TEMP/pagegi-browser-diagnostics"
  mkdir -p "$PAGEGI_BROWSER_DIAGNOSTICS_DIR"
  exec node --import tsx scripts/ci/run.ts "$@"
fi
mkdir -p "$RUNNER_TEMP/pagegi-browser-diagnostics"
exec docker run --rm --init --network host --ipc host \
  --mount "type=bind,src=$GITHUB_WORKSPACE,dst=$GITHUB_WORKSPACE" \
  --mount "type=bind,src=$(command -v node),dst=/usr/local/bin/node,readonly" \
  --mount "type=bind,src=$(command -v docker),dst=/usr/local/bin/docker,readonly" \
  --mount type=bind,src=/var/run/docker.sock,dst=/var/run/docker.sock \
  --mount "type=bind,src=$RUNNER_TEMP/pagegi-browser-diagnostics,dst=/tmp/pagegi-browser-diagnostics" \
  --workdir "$GITHUB_WORKSPACE" \
  --env CI=true \
  --env NODE_COMPILE_CACHE=/tmp/pagegi-node-cache \
  mcr.microsoft.com/playwright:v1.56.1-noble \
  node --import tsx scripts/ci/run.ts "$@"
