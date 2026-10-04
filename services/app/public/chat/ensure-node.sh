# Source this file in bash/zsh: it prepares Node and updates this terminal's PATH.
# No afbin package, updater or credential is installed by this helper.
afbin_ensure_node() {
  afbin_node_ready() {
    command -v node >/dev/null 2>&1 && node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||a===22&&b>=13?0:1)' >/dev/null 2>&1 && command -v npm >/dev/null 2>&1 && npm --version >/dev/null 2>&1 && command -v npx >/dev/null 2>&1 && npx --version >/dev/null 2>&1
  }
  if afbin_node_ready; then printf '%s\n' 'Node and npm/npx are ready.'; return 0; fi
  local afbin_node_version=24.21.0 afbin_node_os afbin_node_arch afbin_node_file afbin_node_stage afbin_node_dir afbin_node_hash afbin_node_actual afbin_node_export afbin_node_rc
  afbin_node_os=$(uname -s); afbin_node_arch=$(uname -m)
  case "$afbin_node_os" in Darwin) afbin_node_os=darwin;; Linux) afbin_node_os=linux;; *) printf '%s\n' 'Unsupported OS. Install Node LTS: https://nodejs.org/en/download' >&2; return 1;; esac
  case "$afbin_node_arch" in arm64|aarch64) afbin_node_arch=arm64;; x86_64|amd64) afbin_node_arch=x64;; *) printf '%s\n' 'Unsupported CPU. Install Node LTS: https://nodejs.org/en/download' >&2; return 1;; esac
  afbin_node_dir="$HOME/.artifactbin/node-v$afbin_node_version-$afbin_node_os-$afbin_node_arch"
  if [ -x "$afbin_node_dir/bin/node" ]; then
    PATH="$afbin_node_dir/bin:$PATH"; export PATH
  fi
  if ! afbin_node_ready; then
    afbin_node_file="node-v$afbin_node_version-$afbin_node_os-$afbin_node_arch.tar.gz"
    afbin_node_stage=$(mktemp -d) || return 1
    if ! curl -fsSL "https://nodejs.org/dist/v$afbin_node_version/SHASUMS256.txt" -o "$afbin_node_stage/sums" || ! curl -fsSL "https://nodejs.org/dist/v$afbin_node_version/$afbin_node_file" -o "$afbin_node_stage/$afbin_node_file"; then
      rm -rf "$afbin_node_stage"; printf '%s\n' 'Node download failed. Install Node LTS: https://nodejs.org/en/download' >&2; return 1
    fi
    afbin_node_hash=$(awk -v file="$afbin_node_file" '$2==file {print $1}' "$afbin_node_stage/sums")
    if command -v shasum >/dev/null 2>&1; then afbin_node_actual=$(shasum -a 256 "$afbin_node_stage/$afbin_node_file" | awk '{print $1}'); else afbin_node_actual=$(sha256sum "$afbin_node_stage/$afbin_node_file" | awk '{print $1}'); fi
    if [ "${#afbin_node_hash}" -ne 64 ] || [ "$afbin_node_hash" != "$afbin_node_actual" ]; then rm -rf "$afbin_node_stage"; printf '%s\n' 'Node checksum verification failed. Install Node LTS: https://nodejs.org/en/download' >&2; return 1; fi
    if ! tar -xzf "$afbin_node_stage/$afbin_node_file" -C "$afbin_node_stage"; then rm -rf "$afbin_node_stage"; return 1; fi
    mkdir -p "$HOME/.artifactbin" || return 1
    # Validate before replacing even an unhealthy prior private runtime.
    "$afbin_node_stage/node-v$afbin_node_version-$afbin_node_os-$afbin_node_arch/bin/node" --version >/dev/null || { rm -rf "$afbin_node_stage"; return 1; }
    rm -rf "$afbin_node_dir"
    mv "$afbin_node_stage/node-v$afbin_node_version-$afbin_node_os-$afbin_node_arch" "$afbin_node_dir" || return 1
    rm -rf "$afbin_node_stage"
    PATH="$afbin_node_dir/bin:$PATH"; export PATH
    hash -r 2>/dev/null || true
    afbin_node_ready || { printf '%s\n' 'Node installed but npm/npx could not run. Install Node LTS: https://nodejs.org/en/download' >&2; return 1; }
  fi
  # HOME-relative declaration remains valid if a home directory contains spaces.
  afbin_node_export="export PATH=\"\$HOME/.artifactbin/node-v$afbin_node_version-$afbin_node_os-$afbin_node_arch/bin:\$PATH\" # artifactbin Node"
  for afbin_node_rc in "$HOME/.profile" "$HOME/.bashrc" "$HOME/.bash_profile" "$HOME/.zshrc"; do
    if ! grep -Fqx "$afbin_node_export" "$afbin_node_rc" 2>/dev/null; then printf '\n%s\n' "$afbin_node_export" >> "$afbin_node_rc" || return 1; fi
  done
  printf '%s\n' 'Node and npm/npx are ready. Next: npx --yes @artifactbin/cli@latest setup'
}
afbin_ensure_node
