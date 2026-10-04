#!/bin/sh
# Compatibility URL: the only supported afbin distribution is now npm.
# This entry prepares Node, then runs npm; it never downloads an afbin executable.
set -eu
  version=0.4.0
if [ "$#" -gt 0 ]; then
  printf '%s\n' 'Install Node with /chat/ensure-node.sh, then run npx --yes @artifactbin/cli@latest setup. Legacy installer flags are no longer supported.' >&2
  exit 1
fi
afbin_node_setup=$(mktemp)
trap 'rm -f "$afbin_node_setup"' EXIT HUP INT TERM
curl -fsSL https://app.artifactbin.dev/chat/ensure-node.sh -o "$afbin_node_setup"
# The helper needs bash/zsh, and changes this process PATH before launching npm.
bash -c '. "$1" && npx --yes @artifactbin/cli@latest setup' bash "$afbin_node_setup"
printf '%s\n' 'Open a new terminal, then use npx --yes @artifactbin/cli@latest <command>.'
