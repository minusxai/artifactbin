#!/bin/sh
# Compatibility URL: the only supported afbin distribution is now npm.
# This entry prepares Node, then runs npm; it never downloads an afbin executable.
set -eu
  origin=''
if [ -z "$origin" ]; then origin=https://app.artifactbin.dev; fi
if [ "$#" -gt 0 ]; then
  printf '%s\n' 'Install Node with /chat/ensure-node.sh, then run npx --yes @afbin/cli@latest setup. Legacy installer flags are no longer supported.' >&2
  exit 1
fi
afbin_node_setup=$(mktemp)
trap 'rm -f "$afbin_node_setup"' EXIT HUP INT TERM
curl -fsSL "$origin/chat/ensure-node.sh" -o "$afbin_node_setup"
# The helper needs bash/zsh, and changes this process PATH before launching npm.
# curl | sh consumes stdin. Restore the controlling terminal for the setup checklist.
if ( : </dev/tty ) 2>/dev/null; then
  bash -c '. "$1" && npx --yes @afbin/cli@latest setup --server "$2"' bash "$afbin_node_setup" "$origin" </dev/tty
else
  bash -c '. "$1" && npx --yes @afbin/cli@latest setup --server "$2"' bash "$afbin_node_setup" "$origin"
fi
printf '%s\n' 'Open a new terminal, then use afbin <command>.'
