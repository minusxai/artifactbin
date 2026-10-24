# Source this file in bash/zsh: it prepares Node and updates this terminal's PATH.
# No afbin package, updater or credential is installed by this helper.
afbin_ensure_node() {
  # npm 11 preserves the CLI consumer lock; npm 12 removes shrinkwrap support.
  afbin_node_ready() {
    command -v node >/dev/null 2>&1 && node -e 'const [a,b,c]=process.versions.node.split(".").map(Number);process.exit(a===22&&(b>23||b===23&&c>=4)||a===24&&(b>22||b===22&&c>=1)||a===26&&(b>12||b===12&&c>=1)||a>26?0:1)' >/dev/null 2>&1 && command -v npm >/dev/null 2>&1 && node -e 'const v=process.argv[1];const [a,b,c]=v.split(".").map(Number);let ok=/^\d+\.\d+\.\d+$/.test(v)&&(a===11&&(b>19||b===19&&c>=1));if(ok&&v==="11.19.1"){try{const fs=require("node:fs"),p=require("node:path"),bin=fs.realpathSync(process.argv[2]),root=process.platform==="win32"?p.join(p.dirname(bin),"node_modules/npm"):p.dirname(p.dirname(bin));ok=[["brace-expansion","5.0.12"],["ip-address","10.7.4"],["postcss-selector-parser","7.1.6"],["undici","6.29.1"]].every(([name,version])=>JSON.parse(fs.readFileSync(p.join(root,"node_modules",name,"package.json"))).version===version)}catch{ok=false}}process.exit(ok?0:1)' "$(npm --version 2>/dev/null)" "$(command -v npm)" >/dev/null 2>&1 && command -v npx >/dev/null 2>&1 && npx --version >/dev/null 2>&1
  }
  if afbin_node_ready; then printf '%s\n' 'Node and npm/npx are ready.'; return 0; fi
  local afbin_node_version=24.22.1 afbin_node_os afbin_node_arch afbin_node_file afbin_node_stage afbin_node_dir afbin_node_hash afbin_node_actual afbin_node_export afbin_node_rc
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
    npm install --global --prefix "$afbin_node_dir" --no-audit --no-fund npm@11.19.1 || { printf '%s\n' 'npm update failed. Install Node LTS: https://nodejs.org/en/download' >&2; return 1; }
    afbin_node_stage=$(mktemp -d) || return 1
    if ! npm install --prefix "$afbin_node_stage" --ignore-scripts --no-package-lock --no-audit --no-fund brace-expansion@5.0.12 ip-address@10.7.4 postcss-selector-parser@7.1.6 undici@6.29.1; then rm -rf "$afbin_node_stage"; return 1; fi
    for afbin_node_file in brace-expansion ip-address postcss-selector-parser undici; do
      rm -rf "$afbin_node_dir/lib/node_modules/npm/node_modules/$afbin_node_file"
      cp -R "$afbin_node_stage/node_modules/$afbin_node_file" "$afbin_node_dir/lib/node_modules/npm/node_modules/$afbin_node_file" || { rm -rf "$afbin_node_stage"; return 1; }
    done
    rm -rf "$afbin_node_stage"
    afbin_node_ready || { printf '%s\n' 'Node installed but npm/npx could not run. Install Node LTS: https://nodejs.org/en/download' >&2; return 1; }
  fi
  # HOME-relative declaration remains valid if a home directory contains spaces.
  afbin_node_export="export PATH=\"\$HOME/.artifactbin/node-v$afbin_node_version-$afbin_node_os-$afbin_node_arch/bin:\$PATH\" # artifactbin Node"
  for afbin_node_rc in "$HOME/.profile" "$HOME/.bashrc" "$HOME/.bash_profile" "$HOME/.zshrc"; do
    if ! grep -Fqx "$afbin_node_export" "$afbin_node_rc" 2>/dev/null; then printf '\n%s\n' "$afbin_node_export" >> "$afbin_node_rc" || return 1; fi
  done
  printf '%s\n' 'Node and npm/npx are ready. Next: npx --yes @afbin/cli@latest setup'
}
afbin_ensure_node
