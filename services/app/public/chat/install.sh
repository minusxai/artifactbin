#!/bin/sh
set -eu

main() {
  version=0.1.11
  install_dir="${HOME}/.local/bin"
  style
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --version|--dir)
        [ "$#" -ge 2 ] || fail "Missing value for $1"
        case "$1" in --version) version=$2;; --dir) install_dir=$2;; esac
        shift 2;;
      --help|-h)
        cat <<'USAGE'
Install afbin: sh install.sh [--version 0.1.11] [--dir PATH]
  --version X.Y.Z   install this release instead of the pinned one
  --dir PATH        install directory (default ~/.local/bin)
Colour follows NO_COLOR and FORCE_COLOR; the download progress bar needs a terminal.
USAGE
        return 0;;
      *) fail "Unknown option: $1";;
    esac
  done
  printf '%s\n' "$version" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$' || fail 'Version must be MAJOR.MINOR.PATCH'
  case "$(uname -s)" in Darwin) platform=darwin; os_label=macOS;; Linux) platform=linux; os_label=Linux;;
    *) fail 'Unsupported OS. Use macOS or Linux (Windows users: use WSL).';; esac
  case "$(uname -m)" in arm64|aarch64) arch=arm64;; x86_64|amd64) arch=x64;;
    *) fail 'Unsupported architecture. Use arm64 or x86_64.';; esac
  command -v curl >/dev/null 2>&1 || fail 'curl is required.'
  if command -v sha256sum >/dev/null 2>&1; then hash_tool=sha256sum
  elif command -v shasum >/dev/null 2>&1; then hash_tool=shasum
  else fail 'sha256sum or shasum is required.'; fi

  headline

  umask 077
  download_dir=$(mktemp -d "${TMPDIR:-/tmp}/afbin-install.XXXXXX")
  staged=''; drawer=''
  trap 'rm -rf "$download_dir"; [ -z "$staged" ] || rm -f "$staged"' EXIT
  trap interrupted HUP INT TERM
  asset="afbin-$platform-$arch"
  release="https://github.com/minusxai/artifactbin/releases/download/afbin-v$version"

  # The checksum list is tiny: fetch it first so a missing release or platform fails before the download.
  fetch SHA256SUMS || fail "Release afbin-v$version could not be fetched (network error, or no such release)." "$(curl_detail)"
  expected=$(awk -v asset="$asset" '$2 == asset { print $1 }' "$download_dir/SHA256SUMS")
  [ -n "$expected" ] || fail "Release afbin-v$version has no build for $os_label $arch."
  done_line "Release afbin-v$version has a $os_label $arch build"

  total=$(content_length "$release/$asset")
  if [ -t 1 ] && [ -t 2 ]; then
    layout "$asset"
    started=$(date +%s)
    progress "$asset" "$total" & drawer=$!
    if fetch "$asset"; then status=0; else status=$?; fi
    : > "$download_dir/done"
    wait "$drawer" || true
    drawer=''
    [ "$status" -eq 0 ] || fail "Download of $asset failed (network error, or the release is incomplete)." "$(curl_detail)"
    done_line "Downloaded $asset ($(human "$(file_size "$download_dir/$asset")"))"
  else
    if [ "$total" -gt 0 ]; then step_line "Downloading $asset ($(human "$total"))"; else step_line "Downloading $asset"; fi
    fetch "$asset" || fail "Download of $asset failed (network error, or the release is incomplete)." "$(curl_detail)"
  fi

  if [ "$hash_tool" = sha256sum ]; then actual=$(sha256sum "$download_dir/$asset")
  else actual=$(shasum -a 256 "$download_dir/$asset"); fi
  actual=${actual%% *}
  [ "$actual" = "$expected" ] || fail 'Checksum verification failed; existing installation was not changed.'
  done_line 'Checksum verified (SHA-256)'

  replaced=0
  [ ! -e "$install_dir/afbin" ] || replaced=1
  mkdir -p "$install_dir"
  staged=$(mktemp "$install_dir/.afbin.XXXXXX")
  cp "$download_dir/$asset" "$staged"
  chmod 755 "$staged"
  mv -f "$staged" "$install_dir/afbin"
  staged=''
  if [ "$replaced" -eq 1 ]; then done_line "Installed afbin $version to $(pretty "$install_dir/afbin") (replaced the previous version)"
  else done_line "Installed afbin $version to $(pretty "$install_dir/afbin")"; fi

  case ":$PATH:" in
    *":$install_dir:"*) ;;
    *)
      printf '\n'
      warn_line "$(pretty "$install_dir") is not on your PATH yet."
      if [ "$install_dir" != "$HOME/.local/bin" ]; then
        say "Add $install_dir to your PATH, or run the executable by its full path."
      elif [ "${SHELL##*/}" = fish ]; then
        say 'Add it once, for this and future shells:'
        say "  ${bold}fish_add_path ~/.local/bin${reset}"
      else
        case "${SHELL##*/}" in zsh) rc='~/.zshrc';; bash) [ "$platform" = darwin ] && rc='~/.bash_profile' || rc='~/.bashrc';; *) rc='';; esac
        say 'Add it for this shell:'
        say "  ${bold}export PATH=\"\$HOME/.local/bin:\$PATH\"${reset}"
        if [ -n "$rc" ]; then
          say "And for future shells, append that line to $rc:"
          say "  ${bold}echo 'export PATH=\"\$HOME/.local/bin:\$PATH\"' >> $rc${reset}"
        else say 'And add the same line to your shell profile for future shells.'; fi
      fi;;
  esac
  printf '\n  %sGet started:%s  afbin help\n' "$bold" "$reset"
  printf '  %safbin signs you in when needed.%s\n\n' "$dim" "$reset"
}

# Colour when writing to a terminal (NO_COLOR wins, FORCE_COLOR forces), at the depth the terminal
# advertises: a 24-bit gradient, its 256-colour approximation, or plain magenta. Glyphs need UTF-8.
style() {
  esc=''; bold=''; dim=''; red=''; green=''; yellow=''; reset=''; c1=''; c2=''; c3=''; c4=''; c5=''
  hide_cursor=''; show_cursor=''
  if [ -z "${NO_COLOR:-}" ] && { [ -n "${FORCE_COLOR:-}" ] || { [ -t 1 ] && [ "${TERM:-}" != dumb ]; }; }; then
    esc=$(printf '\033')
    bold="$esc[1m"; dim="$esc[2m"; red="$esc[31m"; green="$esc[32m"; yellow="$esc[33m"; reset="$esc[0m"
    hide_cursor="$esc[?25l"; show_cursor="$esc[?25h"
    case "${COLORTERM:-}" in
      truecolor|24bit) c1="$esc[38;2;167;139;250m"; c2="$esc[38;2;186;131;240m"; c3="$esc[38;2;205;123;229m"; c4="$esc[38;2;224;116;208m"; c5="$esc[38;2;244;114;182m";;
      *) case "${TERM:-}" in
           *256color*) c1="$esc[38;5;141m"; c2="$esc[38;5;140m"; c3="$esc[38;5;176m"; c4="$esc[38;5;212m"; c5="$esc[38;5;211m";;
           *) c1="$esc[35m"; c2=$c1; c3=$c1; c4=$c1; c5=$c1;;
         esac;;
    esac
  fi
  case "${LC_ALL:-${LC_CTYPE:-${LANG:-}}}" in
    *[Uu][Tt][Ff]-8*|*[Uu][Tt][Ff]8*) ok='✓'; arrow='↓'; warn='!'; bad='✗'; rule_char='─'; block='█'; empty='░';;
    *) ok='ok'; arrow='->'; warn='!'; bad='x'; rule_char='-'; block='#'; empty='-';;
  esac
  # Ask the terminal itself: inside a command substitution, tput would answer for the capture pipe.
  cols=$(stty size < /dev/tty 2>/dev/null | awk '{ print $2 }' || true)
  case "$cols" in ''|*[!0-9]*|0) cols=${COLUMNS:-80};; esac
}
headline() {
  rule_width=$(( cols - 4 )); [ "$rule_width" -le 46 ] || rule_width=46
  printf '\n  %s%sa%sf%sb%si%sn%s %s%s%s\n' "$bold" "$c1" "$c2" "$c3" "$c4" "$c5" "$reset" "$bold" "$version" "$reset"
  printf '  %sGoogle Docs for agents.%s\n' "$dim" "$reset"
  printf '  %s%s\n\n' "$(gradient "$rule_width" "$rule_width" "$rule_char")" "$reset"
}
# COUNT copies of CHAR, coloured along the five-stop gradient laid over WIDTH cells.
gradient() {
  out=''; i=0; stop=-1
  while [ "$i" -lt "$1" ]; do
    s=$(( i * 5 / $2 ))
    if [ "$s" -ne "$stop" ]; then
      stop=$s
      case "$s" in 0) out="$out$c1";; 1) out="$out$c2";; 2) out="$out$c3";; 3) out="$out$c4";; *) out="$out$c5";; esac
    fi
    out="$out$3"; i=$(( i + 1 ))
  done
  printf '%s' "$out"
}
say() { printf '  %s\n' "$1"; }
done_line() { printf '  %s%s%s %s\n' "$green" "$ok" "$reset" "$1"; }
step_line() { printf '  %s%s%s %s\n' "$c1" "$arrow" "$reset" "$1"; }
warn_line() { printf '  %s%s%s %s\n' "$yellow" "$warn" "$reset" "$1"; }
fail() {
  printf '  %s%s %s%s\n' "$red" "$bad" "$1" "$reset" >&2
  [ -z "${2:-}" ] || printf '    %s%s%s\n' "$dim" "$2" "$reset" >&2
  exit 1
}
interrupted() {
  [ -z "$drawer" ] || kill "$drawer" 2>/dev/null
  printf '\n%s%s' "$show_cursor" "$reset" >&2
  fail 'Interrupted; the existing installation was not changed.'
}
pretty() { case "$1" in "$HOME"/*) printf '~%s' "${1#"$HOME"}";; *) printf '%s' "$1";; esac; }
human() {
  if [ "$1" -ge 1048576 ]; then printf '%d MB' $(( ($1 + 524288) / 1048576 ))
  elif [ "$1" -ge 1024 ]; then printf '%d KB' $(( $1 / 1024 ))
  else printf '%d B' "$1"; fi
}
pair() {
  if [ "$2" -ge 1048576 ]; then printf '%d/%d MB' $(( $1 / 1048576 )) $(( ($2 + 524288) / 1048576 ))
  elif [ "$2" -ge 1024 ]; then printf '%d/%d KB' $(( $1 / 1024 )) $(( $2 / 1024 ))
  else printf '%d/%d B' "$1" "$2"; fi
}
duration() { if [ "$1" -ge 60 ]; then printf '%dm %02ds' $(( $1 / 60 )) $(( $1 % 60 )); else printf '%ds' "$1"; fi; }
file_size() { if [ -f "$1" ]; then wc -c < "$1" | tr -d ' '; else echo 0; fi; }

# Download one release file quietly; curl's diagnostics are kept for the failure message.
fetch() {
  curl --proto '=https' --proto-redir '=https' --tlsv1.2 -fsSL --retry 3 --continue-at - \
    --connect-timeout 10 --speed-limit 4096 --speed-time 60 "$release/$1" -o "$download_dir/$1" 2>"$download_dir/curl.err"
}
curl_detail() { [ ! -s "$download_dir/curl.err" ] || tail -n 1 "$download_dir/curl.err"; }
content_length() {
  curl --proto '=https' --proto-redir '=https' --tlsv1.2 -s -I -L --connect-timeout 10 "$1" 2>/dev/null \
    | tr -d '\r' | awk 'tolower($1) == "content-length:" { n = $2 } END { print n + 0 }'
}

# Progress line: "↓ Downloading <asset> ████░░░  54%  87/159 MB  12 MB/s  6s left", sized to the terminal.
layout() {
  prefix_width=$(( 17 + ${#1} ))
  if [ "$cols" -ge 100 ]; then detail=2; reserve=41
  elif [ "$cols" -ge 72 ]; then detail=1; reserve=18
  else detail=0; reserve=5; fi
  bar_width=$(( cols - prefix_width - reserve - 4 ))
  [ "$bar_width" -le 30 ] || bar_width=30
  [ "$bar_width" -ge 6 ] || bar_width=0
  wipe=$(printf "\\r%$(( cols - 1 ))s\\r" '')
}
progress() {
  printf '%s' "$hide_cursor" >&2
  while [ ! -e "$download_dir/done" ]; do
    frame "$1" "$(file_size "$download_dir/$1")" "$2" >&2
    sleep 0.2
  done
  printf '%s%s' "$wipe" "$show_cursor" >&2
}
frame() {
  line="  $c1$arrow$reset Downloading $1 "
  if [ "$3" -gt 0 ]; then
    pct=$(( $2 * 100 / $3 )); [ "$pct" -le 100 ] || pct=100
    if [ "$bar_width" -gt 0 ]; then
      filled=$(( pct * bar_width / 100 ))
      line="$line$(gradient "$filled" "$bar_width" "$block")$reset$dim"
      i=$filled; while [ "$i" -lt "$bar_width" ]; do line="$line$empty"; i=$(( i + 1 )); done
      line="$line$reset"
    fi
    line="$line $bold$(printf '%3d' "$pct")%$reset"
    [ "$detail" -lt 1 ] || line="$line  $dim$(pair "$2" "$3")$reset"
  else
    line="$line $dim$(human "$2")$reset"
  fi
  if [ "$detail" -ge 2 ] && [ "$2" -gt 0 ]; then
    elapsed=$(( $(date +%s) - started ))
    if [ "$elapsed" -ge 1 ]; then
      rate=$(( $2 / elapsed ))
      line="$line  $dim$(human "$rate")/s$reset"
      if [ "$3" -gt "$2" ] && [ "$rate" -gt 0 ]; then line="$line  $dim$(duration $(( ($3 - $2) / rate ))) left$reset"; fi
    fi
  fi
  printf '\r%s    ' "$line"
}

# A function keeps a piped download from executing an incomplete installer.
main "$@"
