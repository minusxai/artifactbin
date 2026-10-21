#!/usr/bin/env bash
set -euo pipefail
pagegi_setup_mode=$1
pagegi_setup_kind=${2:-validate}
pagegi_setup_shard=${3:-0}
pagegi_setup_engine=${4:-chromium}
start_task() {
    local name=$1; shift
    rm -f "$RUNNER_TEMP/pagegi-$name.status"
    (start=$SECONDS; status=0; "$@" || status=$?; printf '%s\n' "$status" > "$RUNNER_TEMP/pagegi-$name.status"; printf '%s: %ss, exit %s\n' "$name" "$((SECONDS - start))" "$status") > "$RUNNER_TEMP/pagegi-$name.log" 2>&1 &
}
if [ "$pagegi_setup_mode" = start ]; then
  start_task build npm run build
  rm -f "$RUNNER_TEMP/pagegi-browsers.status"
  if [ "${PAGEGI_DEFER_BROWSERS:-false}" != true ]; then
    start_task browsers node --import tsx scripts/ci/prepare-browser-runtime.ts "$pagegi_setup_kind" "$pagegi_setup_shard" 4 "$pagegi_setup_engine"
  fi
  start_task postgres node --import tsx scripts/ci/prepare-postgres.ts "$pagegi_setup_kind" "$pagegi_setup_shard" 4 "$pagegi_setup_engine"
  rm -f "$RUNNER_TEMP/pagegi-backend.status"
  if [ "${PAGEGI_DEFER_BACKEND:-false}" != true ]; then
    start_task backend node --import tsx scripts/ci/prepare-backend.ts "$pagegi_setup_kind" "$pagegi_setup_shard" 4 "$pagegi_setup_engine"
  fi
elif [ "$pagegi_setup_mode" = browsers ]; then
  start_task browsers node --import tsx scripts/ci/prepare-browser-runtime.ts "$pagegi_setup_kind" "$pagegi_setup_shard" 4 "$pagegi_setup_engine"
elif [ "$pagegi_setup_mode" = backend ]; then
  start_task backend node --import tsx scripts/ci/prepare-backend.ts "$pagegi_setup_kind" "$pagegi_setup_shard" 4 "$pagegi_setup_engine"
elif [ "$pagegi_setup_mode" = await ]; then
  pagegi_setup_deadline=$((SECONDS + 180))
  status=0
  for name in build postgres backend browsers; do
    until [ -f "$RUNNER_TEMP/pagegi-$name.status" ]; do
      if (( SECONDS >= pagegi_setup_deadline )); then echo "Timed out waiting for $name" >&2; exit 1; fi
      sleep 0.2
    done
    cat "$RUNNER_TEMP/pagegi-$name.log"
    if [ "$(cat "$RUNNER_TEMP/pagegi-$name.status")" != 0 ]; then status=1; fi
  done
  exit "$status"
else
  echo 'Expected start, browsers, backend, or await' >&2; exit 1
fi
