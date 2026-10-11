#!/bin/sh
set -eu
# Wildcard hosting requires an operator-selected provider; do not fall back to HTTP ACME.
grep -Eq '^[[:space:]]*dns[[:space:]]+[a-z0-9_-]+' /etc/caddy/dns-provider.caddy || { echo 'Configure dns-provider.caddy with the selected DNS challenge provider' >&2; exit 1; }
exec caddy "$@"
