# Artifactbin author skill installer

Run `npx https://app.artefactbin.dev/skills/artefactbin-skill.tgz` to install the author skill, then restart your coding agent. The executable only installs the skill; page authoring uses its HTTP API and bundled scripts.

It installs for Claude Code and discovers Codex, Pi and OpenCode from their existing home folders. Running it again upgrades only `artifactbin-author`, preserving unrelated skills. Downloads are validated before replacing an existing skill; a failed replacement restores the previous copy.

For another server, use `npx https://app.artefactbin.dev/skills/artefactbin-skill.tgz --origin https://your-server.example` (or `AF_SERVER`). This also configures the installed examples and scripts for that origin. Account credentials remain in the existing origin-keyed `~/.af/credentials.json`; the installer neither reads nor copies tokens.
