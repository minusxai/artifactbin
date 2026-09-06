#!/bin/sh
set -eu

main() {
  version=0.1.0
  install_dir="${HOME}/.local/bin"
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --version|--dir)
        [ "$#" -ge 2 ] || { echo "Missing value for $1" >&2; return 1; }
        case "$1" in --version) version=$2;; --dir) install_dir=$2;; esac
        shift 2;;
      --help|-h)
        echo 'Install afbin: sh install.sh [--version 0.1.0] [--dir PATH]'
        return 0;;
      *) echo "Unknown option: $1" >&2; return 1;;
    esac
  done
  printf '%s\n' "$version" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$' || {
    echo 'Version must be MAJOR.MINOR.PATCH' >&2; return 1;
  }
  case "$(uname -s)" in Darwin) platform=darwin;; Linux) platform=linux;;
    *) echo 'Unsupported OS. Use macOS or Linux (Windows users: use WSL).' >&2; return 1;; esac
  case "$(uname -m)" in arm64|aarch64) arch=arm64;; x86_64|amd64) arch=x64;;
    *) echo 'Unsupported architecture. Use arm64 or x86_64.' >&2; return 1;; esac
  command -v curl >/dev/null 2>&1 || { echo 'curl is required.' >&2; return 1; }
  if command -v sha256sum >/dev/null 2>&1; then hash_tool=sha256sum
  elif command -v shasum >/dev/null 2>&1; then hash_tool=shasum
  else echo 'sha256sum or shasum is required.' >&2; return 1; fi

  umask 077
  download_dir=$(mktemp -d "${TMPDIR:-/tmp}/afbin-install.XXXXXX")
  staged=''
  trap 'rm -rf "$download_dir"; [ -z "$staged" ] || rm -f "$staged"' EXIT
  trap 'exit 1' HUP INT TERM
  asset="afbin-$platform-$arch"
  release="https://github.com/minusxai/artifactbin/releases/download/afbin-v$version"
  echo "Downloading afbin $version ($platform/$arch)…"
  for file in "$asset" SHA256SUMS; do
    curl --proto '=https' --proto-redir '=https' --tlsv1.2 -fsSL --retry 2 \
      --connect-timeout 10 --max-time 180 "$release/$file" -o "$download_dir/$file" || {
      echo "Download failed. Check that release afbin-v$version includes $asset." >&2; return 1;
    }
  done
  expected=$(awk -v asset="$asset" '$2 == asset { print $1 }' "$download_dir/SHA256SUMS")
  if [ "$hash_tool" = sha256sum ]; then actual=$(sha256sum "$download_dir/$asset")
  else actual=$(shasum -a 256 "$download_dir/$asset"); fi
  actual=${actual%% *}
  [ -n "$expected" ] && [ "$actual" = "$expected" ] || {
    echo 'Checksum verification failed; existing installation was not changed.' >&2; return 1;
  }
  mkdir -p "$install_dir"
  staged=$(mktemp "$install_dir/.afbin.XXXXXX")
  cp "$download_dir/$asset" "$staged"
  chmod 755 "$staged"
  mv -f "$staged" "$install_dir/afbin"
  staged=''
  printf '\nInstalled afbin %s to %s/afbin\n' "$version" "$install_dir"
  case ":$PATH:" in
    *":$install_dir:"*) ;;
    *)
      if [ "$install_dir" = "$HOME/.local/bin" ]; then
        printf '\nRun this in your terminal (and add it to your shell profile):\n  export PATH="$HOME/.local/bin:$PATH"\n'
      else printf 'Add %s to your PATH, or run the executable by its full path.\n' "$install_dir"; fi;;
  esac
  printf '\nNext:\n  afbin auth\n  afbin remote claude\n\nOpen https://artifactbin.dev/chat to see your session.\n'
}

# A function keeps a piped download from executing an incomplete installer.
main "$@"
