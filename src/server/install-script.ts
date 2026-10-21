/**
 * GET /install.sh: `curl -fsSL <origin>/install.sh | sh` installs the author
 * skill for every coding agent on the machine. It downloads the skill archive
 * from this server and extracts it into each harness's skills folder that is
 * present (Claude Code's always), replacing an older copy, so running it again
 * upgrades the skill. It needs only sh, curl and tar.
 */
import { SKILL_ARCHIVE_PATH } from "../af-contracts.ts";

/** Discovery markers are alternatives; upgrades replace only this skill after validation. */
export interface SkillInstallTarget {
  harness: string;
  folder: string;
  markers: readonly string[];
}
/** Each harness's skills folder and the directories that identify its installation. */
export const SKILL_FOLDERS: readonly SkillInstallTarget[] = [
  { harness: "Claude Code", folder: ".claude/skills", markers: [".claude"] },
  { harness: "Codex", folder: ".agents/skills", markers: [".agents", ".codex"] },
  { harness: "Pi", folder: ".pi/agent/skills", markers: [".pi"] },
  { harness: "OpenCode", folder: ".config/opencode/skills", markers: [".config/opencode"] },
];

export function installScript(origin: string): string {
  const base = origin.replace(/\/+$/, "");
  const folders = SKILL_FOLDERS.map((f) => `"${f.folder}" "${f.markers[0]}" "${f.markers[1] ?? f.markers[0]}"`).join(" ");
  return `#!/bin/sh
# Installs the Artifactbin author skill for your coding agents.
# Usage: curl -fsSL ${base}/install.sh | sh
set -eu
archive="${base}${SKILL_ARCHIVE_PATH}"
tmp=$(mktemp -d "\${TMPDIR:-/tmp}/pagegi-install.XXXXXX")
stage=
folder=
cleanup() {
  status=$?
  # The download goes first, whatever happens to the backup below.
  rm -rf "$tmp"
  if [ -n "$stage" ]; then
    if [ -e "$stage/previous" ] || [ -L "$stage/previous" ]; then
      if ! [ -e "$folder/pagegi-author" ] && ! [ -L "$folder/pagegi-author" ]; then
        # Leave the backup intact if restoration itself fails.
        mv "$stage/previous" "$folder/pagegi-author" || exit 1
      fi
    fi
    rm -rf "$stage"
  fi
  exit "$status"
}
trap cleanup 0
trap 'exit 1' HUP INT TERM
curl -fsSL "$archive" -o "$tmp/skill.tgz"
# The server archive contains only regular files/directories under this root.
# Validate before extraction, so unrelated paths and links never reach a skills folder.
tar -tzf "$tmp/skill.tgz" > "$tmp/names"
while IFS= read -r entry; do
  case "$entry" in
    /*|../*|*/../*|*/..) echo "Invalid skill archive path" >&2; exit 1 ;;
    pagegi-author/|pagegi-author/*) ;;
    *) echo "Unexpected skill archive entry" >&2; exit 1 ;;
  esac
done < "$tmp/names"
tar -tvzf "$tmp/skill.tgz" > "$tmp/types"
while IFS= read -r entry; do
  case "$entry" in [-d]*) ;; *) echo "Unsupported skill archive entry" >&2; exit 1 ;; esac
done < "$tmp/types"
mkdir "$tmp/extracted"
tar -xzf "$tmp/skill.tgz" -C "$tmp/extracted"
[ -f "$tmp/extracted/pagegi-author/SKILL.md" ] || { echo "Missing SKILL.md" >&2; exit 1; }
installed=0
set -- ${folders}
while [ $# -ge 3 ]; do
  folder="$HOME/$1"; marker="$HOME/$2"; alternate="$HOME/$3"; shift 3
  # Claude Code's folder is always used; another harness's only when that harness is present.
  if [ "$folder" = "$HOME/.claude/skills" ] || [ -d "$marker" ] || [ -d "$alternate" ]; then
    mkdir -p "$folder"
    stage=$(mktemp -d "$folder/.pagegi-author.XXXXXX")
    cp -R "$tmp/extracted/pagegi-author" "$stage/pagegi-author"
    if [ -e "$folder/pagegi-author" ] || [ -L "$folder/pagegi-author" ]; then
      mv "$folder/pagegi-author" "$stage/previous"
    fi
    # Both renames stay on the destination filesystem; the exit trap restores on failure.
    mv "$stage/pagegi-author" "$folder/pagegi-author"
    rm -rf "$stage"
    stage=
    echo "Installed Artifactbin author skill in $folder"
    installed=$((installed + 1))
  fi
done
echo "Done: the skill is in $installed folder(s). Restart your coding agent so it loads it. Its scripts need Node.js 20.10+."
`;
}
