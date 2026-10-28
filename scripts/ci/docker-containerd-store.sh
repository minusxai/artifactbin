#!/usr/bin/env bash
# CI runners only: switch this ephemeral runner's Docker Engine to the containerd image store, the store whose
# built-in BuildKit can import and export a build cache (`cache_from`/`cache_to`, type=local). The classic store
# exports inline caches only, so the pinned Caddy compile in deploy/company/ci-smoke.mjs could never be reused
# across runs. Never run this on a machine anyone keeps: images in the classic store are not migrated.
# A daemon that does not come back on the new store is a warning, not a failure: ci-smoke.mjs then builds uncached.
set -euo pipefail
config=/etc/docker/daemon.json
current='{}'
if sudo test -s "$config"; then current=$(sudo cat "$config"); fi
jq '.features["containerd-snapshotter"] = true' <<<"$current" | sudo tee "$config" > /dev/null
sudo systemctl restart docker
if docker info --format '{{json .DriverStatus}}' | grep -q 'io.containerd.snapshotter'; then
  echo 'Docker Engine uses the containerd image store.'
else
  echo '::warning::Docker Engine did not switch to the containerd image store; the Caddy build runs uncached.'
fi
