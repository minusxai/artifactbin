#!/bin/sh
set -eu

# Removes what install.sh and afbin itself write for the current user, and nothing else:
# the executable, ~/.artifactbin (sign-in, settings) and afbin-managed agent skills.
main() {
  install_dir="${HOME}/.local/bin"
  keep_state=0
  dry_run=0
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --dir)
        [ "$#" -ge 2 ] || { echo "Missing value for $1" >&2; return 1; }
        install_dir=$2
        shift 2;;
      --keep-state) keep_state=1; shift;;
      --dry-run) dry_run=1; shift;;
      --help|-h)
        cat <<'USAGE'
Uninstall afbin: sh uninstall.sh [--dir PATH] [--keep-state] [--dry-run]
  --dir PATH    where install.sh put the executable (default ~/.local/bin)
  --keep-state  keep ~/.artifactbin and ~/.cache/afbin (sign-in, choices, downloads)
  --dry-run     list what would be removed without removing anything
Removes the executable, ~/.artifactbin, cached downloads and afbin-managed agent skills.
Project files (afbin.lock, pulled artifacts) are never touched.
USAGE
        return 0;;
      *) echo "Unknown option: $1" >&2; return 1;;
    esac
  done
  state_dir="${ARTIFACTBIN_HOME:-$HOME/.artifactbin}"
  config_home="${XDG_CONFIG_HOME:-$HOME/.config}"
  found=0
  verb=Removed
  [ "$dry_run" -eq 0 ] || verb='Would remove'

  exe="$install_dir/afbin"
  if [ -L "$exe" ]; then
    echo "Left $exe in place: a symlink, not installed by install.sh."
  elif [ -f "$exe" ]; then
    found=1; wipe "$exe"; echo "$verb $exe (executable)"
  fi

  if [ -d "$state_dir" ]; then
    backups="$state_dir/skill-backups"
    if [ "$keep_state" -eq 1 ]; then
      echo "Kept $state_dir (sign-in and settings)."
    elif [ -d "$backups" ] && [ -n "$(ls -A "$backups")" ]; then
      # Backups hold the user's own files that afbin replaced; only they decide when those go.
      found=1
      for entry in "$state_dir"/* "$state_dir"/.[!.]* "$state_dir"/..?*; do
        { [ -e "$entry" ] || [ -L "$entry" ]; } && [ "$entry" != "$backups" ] || continue
        wipe "$entry"
      done
      echo "$verb sign-in and settings from $state_dir"
      echo "Kept $backups: copies of skills afbin replaced; delete it yourself when you no longer need them."
    else
      found=1; wipe "$state_dir"; echo "$verb $state_dir (sign-in and settings)"
    fi
  fi

  cache_dir="${XDG_CACHE_HOME:-$HOME/.cache}/afbin"
  if [ -d "$cache_dir" ]; then
    if [ "$keep_state" -eq 1 ]; then echo "Kept $cache_dir (downloads)."
    else found=1; wipe "$cache_dir"; echo "$verb $cache_dir (downloads)"; fi
  fi

  # The same destinations afbin installs skills into; a directory without the manifest is not ours.
  for skill in \
    "${CLAUDE_CONFIG_DIR:-$HOME/.claude}/skills/artifactbin" \
    "${CODEX_HOME:-$HOME/.codex}/skills/artifactbin" \
    "${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}/skills/artifactbin" \
    "${OPENCODE_CONFIG_DIR:-$config_home/opencode}/skills/artifactbin"
  do
    [ -d "$skill" ] || continue
    if [ ! -f "$skill/.afbin-skill.json" ]; then
      echo "Left $skill in place: not managed by afbin."
      continue
    fi
    found=1
    if [ -L "$skill" ]; then
      physical=$(cd -P "$skill" && pwd -P) || { echo "Cannot resolve $skill" >&2; return 1; }
      wipe "$physical"; wipe "$skill"
      echo "$verb $skill -> $physical (afbin-managed skill)"
    else
      wipe "$skill"; echo "$verb $skill (afbin-managed skill)"
    fi
  done

  # Anything else named afbin on PATH did not come from install.sh: report it, never remove it.
  set -f; IFS=:
  for dir in $PATH; do
    [ -n "$dir" ] && [ "$dir" != "$install_dir" ] || continue
    if [ -L "$dir/afbin" ]; then
      echo "Another afbin remains at $dir/afbin (symlink to $(readlink "$dir/afbin")); remove it separately."
    elif [ -e "$dir/afbin" ]; then
      echo "Another afbin remains at $dir/afbin; remove it separately."
    fi
  done
  unset IFS; set +f

  if [ "$found" -eq 0 ]; then echo 'Nothing to remove: afbin is not installed for this user.'
  elif [ "$dry_run" -eq 1 ]; then echo 'Dry run: nothing was changed.'
  else echo 'afbin is uninstalled. Project files such as afbin.lock and pulled artifacts stay in place.'; fi
}

wipe() { [ "$dry_run" -eq 1 ] || rm -rf "$1"; }

# A function keeps a piped download from executing an incomplete script.
main "$@"
