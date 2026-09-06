# afbin remote (V0)

Run a regular local agent terminal and access the same terminal from a desktop or mobile browser. Claude Code, Codex, Pi, OpenCode, or another interactive command can run inside the PTY; no harness protocol or plugin is required for terminal access.

## Install

Once the `afbin-v0.1.0` GitHub Release is published and the app is deployed:

```sh
curl -fsSL https://artifactbin.dev/chat/install.sh | sh
export PATH="$HOME/.local/bin:$PATH"
afbin auth
afbin remote claude --chrome
# Or: afbin remote codex
```

Sign into artifactbin.dev, follow the auth prompt to generate and paste an account token, then open
https://artifactbin.dev/chat. The harness must already be installed. The installer needs curl and
sha256sum or shasum, but no Node runtime or sudo. It supports macOS and Linux on arm64 and x64;
Windows users can use WSL. It checks SHA-256 before replacing an existing installation. Re-run it to
reinstall, or select a published version/location:

```sh
curl -fsSL https://artifactbin.dev/chat/install.sh | sh -s -- --version 0.1.0 --dir "$HOME/.local/bin"
```

The existing `/install.sh` installs the self-hosted server; `/chat/install.sh` installs only this CLI.

From the repository root (Node 22+, plus Python/make/C++ on Linux for node-pty):

```sh
npm ci
npm run build -w services/cli
node services/cli/dist/afbin.mjs auth
node services/cli/dist/afbin.mjs remote claude --chrome
```

Use `npm link -w services/cli` to install the `afbin` command locally, then:

```sh
afbin remote --name Backend codex
afbin remote pi
afbin remote opencode
afbin auth --server http://localhost:6401
afbin remote --server http://localhost:6401 claude --chrome
```

Put afbin options **before** the command; everything after the command goes to the harness unchanged. Your working directory, environment, installed skills, MCP configuration, and local input/output remain available. The CLI starts the executable directly, without constructing a shell command string. You can explicitly run a shell too: `afbin remote bash`.

Open the printed session link, or `/chat` on the selected server, and sign into the same artifactbin account. Select a session and choose **Take control**. Use the terminal directly, the message box, or the mobile Enter/Escape/arrow buttons. Local typing takes control back. **Disconnect** removes remote access and leaves the local command running; Ctrl+C goes to the command as usual.

## Auth

`afbin auth` asks you to open the server's `/tokens/new` page while signed in and paste its token (hidden input). It validates that the token belongs to an account and saves it with owner-only permissions in the same file used by artifactbin skills:

```dotenv
ARTIFACTBIN_URL=https://artifactbin.dev
ARTIFACTBIN_TOKEN=your_token
```

Location: `~/.artifactbin.env`. `afbin remote` reuses a valid saved token without another login. Missing or expired credentials direct you to `afbin auth`. Legacy `~/.config/artifact-bin/config.json` (`url`, `token`) is read as a fallback. An anonymous token must first be claimed by an account.

`ARTIFACTBIN_URL` and `ARTIFACTBIN_TOKEN` can explicitly supply a connection. Saved credentials are used only for their matching server origin; changing a host does not send the saved production token to it. Authentication sends a bearer header, never a token in the session URL. HTTP is allowed only for localhost development; other hosts require HTTPS. The paste-token flow replaces the most recent connection, consistent with the existing skills.

## Artifact comments

Type `@` in an artifact comment or reply and select one of your online sessions. The comment stores a readable link to that exact session. After saving the comment, the server queues a single-line JSON notification containing the artifact, annotation and comment IDs, author, and body, followed by Enter. It does not wait for the harness to become idle. The harness handles the input according to its current screen, just as if you typed locally.

The agent can use its existing artifactbin plugin/MCP/API to read the artifact and respond. The relay does not parse replies or post comments itself. Agent-authored replies do not generate more notifications. V0 only allows you to invoke **your own account's sessions**. Offline, disconnected, or full sessions receive no notification; the comment is still saved. There is no historical comment replay. Mention links identify a session, so restarting a command creates a new mention target.

## Embedded use

The CLI exports the same PTY lifecycle for another TypeScript/JavaScript CLI:

```ts
import { loadConnection, runRemote } from '@artifactbin/cli';
const connection = await loadConnection();
if (!connection) throw new Error('Run afbin auth first');
const exitCode = await runRemote({
  connection, command: 'claude', args: ['--chrome'],
  onSession: url => console.error(url),
});
```

`interactive: false`, `onOutput`, and an AbortSignal support embedding in a process without a local TTY. The server relay is `services/app/lib/remote/registry.ts`; thin authenticated HTTP routes wrap its account-scoped interface. Wire types live in `services/contracts/src/remote.ts`.

## Standalone executable

```sh
npm run build:binary -w services/cli
# services/cli/dist/afbin-<platform>-<arch>[.exe]
```

Build on each target OS/architecture using Node 22. The build creates a [Node single executable application](https://nodejs.org/docs/latest-v22.x/api/single-executable-applications.html), embeds node-pty and its native helper, and applies ad-hoc signing on macOS. It needs no separately installed Node runtime or node_modules on the destination. Native files extract into a private temporary directory for the process lifetime. macOS arm64 is verified locally; other platforms need their own build and smoke test. Public macOS distribution would additionally need your signing/notarization process. No binaries are committed.

## V0 boundaries

The relay uses authenticated HTTP polling (~200 ms runner / 250 ms viewer), so it works through the existing app proxy and a custom host without a separate WebSocket service. It forwards terminal bytes, including screen redraws and menus. It is a terminal mirror, with a convenient message box.

Run **one app process**: sessions and bounded terminal scrollback live in memory. An app restart or multi-replica routing loses the connection. Brief network errors retry exchanges without duplicating input/output; auth failure or a missing session disables remote access and leaves the local command running. A long outage or excessive output disables the relay to keep local work available. Sessions become offline after 30 seconds without a heartbeat and expire after one hour without activity. Limits: 10 sessions per account, 200 total, 1 MiB replay per session plus 1,000 terminal scrollback lines, 128 KiB pending input. Closing the local terminal ends the process; this does not implement persistent background sessions.

The account and the app server can access the terminal content and input. Keep this server within the trust boundary of the machine you are controlling. V0 does not provide end-to-end encryption, public session sharing, readiness detection, or guaranteed delivery after a server restart.

## Publishing a CLI release

CI builds and smoke-tests macOS/Linux on arm64/x64 and uploads the executables as workflow artifacts.
`Publish afbin CLI` rebuilds and tests an exact source commit, then publishes a versioned GitHub Release
with `SHA256SUMS`. The release stays a draft until all assets are attached. Existing releases are not overwritten.

1. Update `services/cli/package.json` and the default `version` in `services/app/public/chat/install.sh`.
2. Merge and wait for CI to pass on the exact main commit to release.
3. Tag that commit `afbin-v0.1.0` (matching the package version) and push the tag. Failed workflow runs can
   be retried from GitHub Actions. It refuses commits outside main or without passing CI.
4. Verify the release assets, then deploy the app serving the corresponding installer. For a rollback,
   deploy an installer pinned to the previous release; users can also pass `--version` explicitly.

Publish the first release before advertising the install command. A missing release produces a clear
download error and leaves any existing installation untouched.
