# Transition bootstrap
`afbin` here is a POSIX shell script, not a CLI build: the bootstrap that moves old 0.3.x standalone installs onto the npm package.
Every release publishes it on the GitHub release `afbin-v<version>` under the four old asset names
(`afbin-darwin-arm64`, `afbin-darwin-x64`, `afbin-linux-arm64`, `afbin-linux-x64`), with their manifests and `afbin-skills.json`.
Who downloads it: the 0.3.x background self-updater, which checks it with `--version --json` in an empty environment and swaps it in.
On its first real run it installs `@afbin/cli@$AFBIN_VERSION` through npm, hands the command over and removes itself.
Lockstep rule: `AFBIN_VERSION` equals `services/cli/package.json` and `AFBIN_PROTOCOL` equals `CLI_PROTOCOL_VERSION`.
`npm run release:cli` moves the version line with the other release files; CI treats it as part of a version-only bump.
`services/cli/scripts/transition-assets.mjs build|verify` builds and re-proves the nine release files (run by `pack:release` and the release workflow).
Keep the file executable (mode 755) and POSIX `sh` only; edit the logic, never the two pin lines, by hand.
