#!/usr/bin/env bash

set -euo pipefail

DEFAULT_IMAGE="ghcr.io/minusxai/artifactbin:latest"
IMAGE="${ARTIFACTBIN_IMAGE:-$DEFAULT_IMAGE}"
TARGET_INPUT=""
TARGET_EXPLICIT=0
PORT_OVERRIDE=""
NO_INTERVIEW=0

usage() {
  echo "Usage: install.sh [--no-interview] [--image=<ref>] [--dir=<path>] [--port=<n>] [path]" >&2
}

for arg in "$@"; do
  case "$arg" in
    --no-interview) NO_INTERVIEW=1 ;;
    --image=*) IMAGE=${arg#*=} ;;
    --dir=*) TARGET_INPUT=${arg#*=}; TARGET_EXPLICIT=1 ;;
    --port=*) PORT_OVERRIDE=${arg#*=} ;;
    --help|-h) usage; exit 0 ;;
    --*) echo "Unknown option: $arg" >&2; usage; exit 2 ;;
    *)
      if [[ -n "$TARGET_INPUT" ]]; then
        echo "Only one install directory may be specified." >&2
        exit 2
      fi
      TARGET_INPUT=$arg
      TARGET_EXPLICIT=1
      ;;
  esac
done

if [[ -n "$PORT_OVERRIDE" ]]; then
  if ! [[ "$PORT_OVERRIDE" =~ ^[0-9]+$ ]] ||
     (( PORT_OVERRIDE < 1 || PORT_OVERRIDE > 65535 )); then
    echo "--port must be a number from 1 to 65535." >&2
    exit 2
  fi
fi

echo "[1/6] Checking Docker and system requirements"
if ! command -v docker >/dev/null 2>&1 || ! docker info >/dev/null 2>&1; then
  echo "Docker is required and must be running. Install it from https://docs.docker.com/get-docker/." >&2
  exit 1
fi
if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required to check artifactbin's health." >&2
  exit 1
fi

PLATFORM=""
case "$(uname -m)" in
  arm64|aarch64) PLATFORM=linux/amd64 ;;
esac

if [[ "$TARGET_EXPLICIT" -eq 1 && -z "$TARGET_INPUT" ]]; then
  echo "The custom install directory must not be empty." >&2
  exit 2
fi

# Migration is deliberately limited to the default target. An explicit
# --dir/path is never redirected or moved behind the caller's back.
if [[ "$TARGET_EXPLICIT" -eq 0 ]]; then
  NEW_DEFAULT="$(pwd -P)/artifactbin"
  LEGACY_DEFAULT="$(pwd -P)/artifact-bin"
  LEGACY_CONTAINER=0
  if docker container inspect artifact-bin >/dev/null 2>&1; then
    LEGACY_CONTAINER=1
  fi

  if [[ -e "$NEW_DEFAULT" && -e "$LEGACY_DEFAULT" ]]; then
    echo "Both the legacy and canonical default install directories exist; refusing an ambiguous migration." >&2
    exit 1
  fi
  if [[ -e "$LEGACY_DEFAULT" && ! -d "$LEGACY_DEFAULT" ]]; then
    echo "The legacy default install path exists but is not a directory; refusing migration." >&2
    exit 1
  fi
  if [[ -d "$LEGACY_DEFAULT" ]]; then
    if [[ "$LEGACY_CONTAINER" -eq 1 ]]; then
      echo "Removing the legacy container before migrating its mounted data."
      docker rm -f artifact-bin
    fi
    echo "Migrating the existing default install to $NEW_DEFAULT"
    mv "$LEGACY_DEFAULT" "$NEW_DEFAULT"
  elif [[ "$LEGACY_CONTAINER" -eq 1 ]]; then
    echo "Found legacy container ${LEGACY_DEFAULT##*/} without $LEGACY_DEFAULT; leaving it untouched."
  fi
  TARGET_INPUT=./artifactbin
fi
case "/$TARGET_INPUT/" in
  */../*)
    echo "The install directory must not contain '..'." >&2
    exit 2
    ;;
esac
if [[ "$TARGET_INPUT" = /* ]]; then
  TARGET=${TARGET_INPUT%/}
else
  TARGET="$(pwd -P)/${TARGET_INPUT#./}"
  TARGET=${TARGET%/}
fi
HOME_REAL=$(cd "$HOME" && pwd -P)
if [[ "${ARTIFACTBIN_ANYWHERE:-0}" != "1" ]]; then
  case "$TARGET/" in
    "$HOME_REAL"/*) ;;
    *)
      echo "The install directory must be under HOME ($HOME_REAL). Docker Desktop shares HOME by default; mounts outside it can silently receive nothing. Set ARTIFACTBIN_ANYWHERE=1 to continue anyway." >&2
      exit 1
      ;;
  esac
fi

echo "[2/6] Preparing $TARGET"
mkdir -p "$TARGET/data"
ENV_FILE="$TARGET/.env"
if [[ -f "$ENV_FILE" ]]; then
  UPGRADE=1
  echo "Existing install found — upgrading."
else
  UPGRADE=0
fi

echo "[3/6] Pulling $IMAGE"
pull_image() {
  if [[ -n "$PLATFORM" ]]; then
    docker pull --platform "$PLATFORM" "$IMAGE"
  else
    docker pull "$IMAGE"
  fi
}
if ! pull_image; then
  echo "Could not pull $IMAGE. See Docker's output above." >&2
  exit 1
fi

echo "[4/6] Configuring artifactbin"
if [[ "$UPGRADE" -eq 0 || -n "$PORT_OVERRIDE" ]]; then
  SETUP_ARGS=(node scripts/setup.mjs --out /work/.env --no-next)
  if [[ -n "$PORT_OVERRIDE" ]]; then
    SETUP_ARGS+=(--port "$PORT_OVERRIDE")
  fi
  if [[ "$NO_INTERVIEW" -eq 1 || ! -t 2 ]]; then
    SETUP_ARGS+=(--yes)
    if [[ -n "$PLATFORM" ]]; then
      docker run --rm --platform "$PLATFORM" -v "$TARGET:/work" "$IMAGE" "${SETUP_ARGS[@]}"
    else
      docker run --rm -v "$TARGET:/work" "$IMAGE" "${SETUP_ARGS[@]}"
    fi
  else
    if [[ -n "$PLATFORM" ]]; then
      docker run --rm -it --platform "$PLATFORM" -v "$TARGET:/work" "$IMAGE" "${SETUP_ARGS[@]}" </dev/tty
    else
      docker run --rm -it -v "$TARGET:/work" "$IMAGE" "${SETUP_ARGS[@]}" </dev/tty
    fi
  fi
fi

HOST_PORT=$PORT_OVERRIDE
if [[ -z "$HOST_PORT" ]]; then
  HOST_PORT=$(sed -n 's/^APP__PORT=//p' "$ENV_FILE" | tail -n 1)
  HOST_PORT=${HOST_PORT:-3030}
fi

port_is_busy() {
  (exec 3<>"/dev/tcp/127.0.0.1/$1") >/dev/null 2>&1
}

if port_is_busy "$HOST_PORT" && ! docker container inspect artifactbin >/dev/null 2>&1; then
  SUGGESTED_PORT=$((HOST_PORT + 1))
  while (( SUGGESTED_PORT <= 65535 )) && port_is_busy "$SUGGESTED_PORT"; do
    SUGGESTED_PORT=$((SUGGESTED_PORT + 1))
  done
  echo "Port $HOST_PORT is already in use; artifactbin was not started." >&2
  if (( SUGGESTED_PORT <= 65535 )); then
    echo "Re-run with a free port: curl -fsSL https://artifactbin.dev/install.sh | bash -s -- --dir=\"$TARGET\" --port=$SUGGESTED_PORT" >&2
  fi
  exit 1
fi

echo "[5/6] Starting artifactbin"
docker rm -f artifactbin 2>/dev/null || true
if [[ -n "$PLATFORM" ]]; then
  docker run -d --name artifactbin --restart unless-stopped --platform "$PLATFORM" \
    -p "${ARTIFACTBIN_BIND:-127.0.0.1}:$HOST_PORT:3000" -v "$TARGET/data:/app/data" \
    --env-file "$ENV_FILE" -e APP__PORT=3000 "$IMAGE"
else
  docker run -d --name artifactbin --restart unless-stopped \
    -p "${ARTIFACTBIN_BIND:-127.0.0.1}:$HOST_PORT:3000" -v "$TARGET/data:/app/data" \
    --env-file "$ENV_FILE" -e APP__PORT=3000 "$IMAGE"
fi

echo "[6/6] Waiting for artifactbin"
TIMEOUT=${ARTIFACTBIN_HEALTH_TIMEOUT:-120}
DEADLINE=$((SECONDS + TIMEOUT))
until curl -fsS "http://127.0.0.1:$HOST_PORT/health" >/dev/null 2>&1; do
  if (( SECONDS >= DEADLINE )); then
    echo "artifactbin did not become healthy within ${TIMEOUT}s. Container logs:" >&2
    docker logs --tail 40 artifactbin >&2 || true
    exit 1
  fi
  sleep 1
done

cat <<EOF

artifactbin is ready.
Open http://localhost:$HOST_PORT
To publish from an agent, read http://localhost:$HOST_PORT/docs/artifactbin/SKILL.md
Follow logs: docker logs -f artifactbin
Re-run this command to upgrade.

For public access, put a reverse proxy with TLS in front and set
APP__PUBLIC_BASE_URL in artifactbin/.env to the public URL.
EOF
