# afbin

Publish and edit artifacts through local files, with offline help and validation. Mirror a local terminal with `afbin remote`.

## Install and authenticate

```sh
curl -fsSL https://artifactbin.dev/chat/install.sh | sh
```

The installer needs only `curl` and a POSIX shell: it downloads the standalone executable for this
platform, verifies its published SHA-256 and installs it in `~/.local/bin` (`--dir` and `--version`
select another destination or release). A failed verification leaves an existing installation
untouched. Self-hosted servers serve the same script, pinned to the release they were built with;
`/install.sh` is the separate self-hosted **server** installer.

Setup opens browser authentication automatically and saves credentials privately in
`~/.artifactbin/.env`. It offers a preselected checklist of detected Claude Code, Codex, pi and
OpenCode skills; uncheck integrations you do not want. Choices are remembered. Standalone executables
for macOS/Linux arm64/x64 and versioned local skill bundles are published in GitHub releases.

```sh
afbin pull <artifact-url> report.jsx
# Edit report.jsx, retaining its YAML fence and body IDs.
afbin validate report.jsx
afbin diff report.jsx
afbin push report.jsx
```

Push also creates a new artifact from a new JSX file. `status`, `diff`, validation, help and unchanged
pushes make no HTTP request. Use `--remote` to refresh a comparison. `push --dry-run` preflights without
saving files or publishing. `afbin -h`, command `-h`, `afbin help <topic>` and the installed man page
teach the same flags and rules.

Nothing is written into your working directory. All local state — which files are tracked, the server
state last accepted, account resources, Markdown conversions and interrupted operations — lives in one
private SQLite database at `~/.artifactbin/state.sqlite` (`ARTIFACTBIN_HOME` moves it), and a tracked
file is recorded by the SHA-256 of its bytes rather than by a copy of them. There is nothing to commit
and nothing to add to `.gitignore`. A forced overwrite keeps the replaced bytes under
`~/.artifactbin/backups/local` and prints that absolute path. Images, PDFs and files are identified by
content hash, so publishing bytes you already own reuses that artifact instead of uploading them again.

A command reference is `<url|id|path>[@version]`; existing filenames win. Published references in
markup use `ref:<id>`, including Query/Mutation sources. SQL names tables; `$query` binds a result.
Old reference spellings are rejected. Relative dependencies publish with their document.

For automation, use `setup --yes --json --harness pi --harness opencode`, or `--harness none`.
A pending browser approval returns its URL and expiry; approve it and rerun setup. `--yes` does not
approve the browser or imply `--force`. No noninteractive prompt waits for input.

`afbin update` explicitly updates the standalone executable and the selected local skills, with
checksums and recoverable backups. It asks the selected server for the release it speaks
(`/chat/release.json`) and takes the bytes from that published release. `afbin update --dry-run`
resolves the release and reports the binary and skill changes without installing anything.
An installation that did not come from the verified
installer is reported, never overwritten. Setup and update mark a skill written for a harness that
reads its skills at startup (Claude Code, Codex) `restart_required` and name it on stderr. Ordinary commands never poll releases. Use
`afbin update -h` for selection and recovery options.

## Local development

From the repository root (Node 22+, plus Python/make/C++ on Linux for node-pty):

```sh
npm ci
npm run build -w services/cli
node services/cli/dist/afbin.mjs remote claude --chrome
```

Use `npm link -w services/cli` to install the `afbin` command locally, then:

```sh
afbin remote --name Backend codex
afbin remote pi
afbin remote opencode
afbin --server http://localhost:6401
afbin remote --server http://localhost:6401 claude --chrome
```

The flags prompt accepts quoted arguments (for example `--model "my model"`) without shell expansion. If no supported harness is installed, afbin explains how to install one or run an explicit executable.

Put afbin options **before** the command; everything after the command goes to the harness unchanged. Your working directory, environment, installed skills, and local input/output remain available. The CLI starts the executable directly, without constructing a shell command string. You can explicitly run a shell too: `afbin remote bash`.

Open the printed session link, or `/chat` on the selected server, and sign into the same artifactbin account. Select a session, swipe up/down to scroll terminal history (or use Scroll up, Scroll down, and Latest output), and use the terminal directly, the message box, or the Enter/Escape/arrow buttons. **Switch to mobile** and **Switch to desktop** resize the shared terminal. The selected size stays in effect even when the local terminal sends input or automatic replies. **Disconnect** removes remote access and leaves the local command running; Ctrl+C goes to the command as usual.

The browser retries temporary failures indefinitely with capped backoff and a “Reconnecting…” status, preserving the visible terminal. Successful polls clear that status. Full-screen agents may manage their own history separately from terminal scrollback. Disconnect stops relay retries; bounded in-memory disconnect records last up to one hour.

## Auth

The first command that needs the server opens browser authentication automatically, saves the
connection with owner-only permissions and resumes the command. Run `afbin auth` to sign in
deliberately; local skills install eagerly on first use and update with `afbin update`.
`ARTIFACTBIN_URL` and `ARTIFACTBIN_TOKEN` can supply a connection; saved credentials are
used only for their matching server origin. HTTP is restricted to localhost development. Tokens are
sent in authorization headers, never session URLs. No legacy credential file is read.

Bare commands offer a picker of installed agent executables. The harness itself must be installed.

## Artifact comments

Type `@` in an artifact comment or reply and select one of your online sessions. The comment stores a readable link to that exact session. After saving the comment, the server queues a single-line JSON notification containing the artifact, annotation and comment IDs, author, and body, followed by Enter. It does not wait for the harness to become idle. The harness handles the input according to its current screen, just as if you typed locally.

The agent can use its artifactbin CLI and installed local skill to read the artifact and respond. The relay does not parse replies or post comments itself. Agent-authored replies do not generate more notifications. V0 only allows you to invoke **your own account's sessions**. Offline, disconnected, or full sessions receive no notification; the comment is still saved. There is no historical comment replay. Mention links identify a session, so restarting a command creates a new mention target.

## Embedded use

The CLI exports the same PTY lifecycle for another TypeScript/JavaScript CLI:

```ts
import { loadConnection, runRemote } from '@artifactbin/cli';
const connection = await loadConnection();
if (!connection) throw new Error('Run afbin auth to sign in first');
const exitCode = await runRemote({
  connection, command: 'claude', args: ['--chrome'],
  onSession: url => console.error(url),
});
```

`onSession` is called again after session recovery, with the same URL when the server supports recovery. `interactive: false`, `onOutput`, and an AbortSignal support embedding in a process without a local TTY. The server relay is `services/app/lib/remote/registry.ts`; thin authenticated HTTP routes wrap its account-scoped interface. Wire types live in `services/contracts/src/remote.ts`.

## Standalone executable

```sh
npm run build:binary -w services/cli
# services/cli/dist/afbin-<platform>-<arch>[.exe]
```

Build on each target OS/architecture using Node 22. The build creates a [Node single executable application](https://nodejs.org/docs/latest-v22.x/api/single-executable-applications.html), embeds node-pty and its native helper, and applies ad-hoc signing on macOS. It needs no separately installed Node runtime or node_modules on the destination. Native files extract into a private temporary directory for the process lifetime. Each of the four release targets has its own build and smoke gate. Public macOS distribution would additionally need your signing/notarization process. No binaries are committed.

## V0 boundaries

The relay uses authenticated HTTP polling (~200 ms runner / 250 ms viewer), so it works through the existing app proxy and a custom host without a separate WebSocket service. It forwards terminal bytes, including screen redraws and menus. It is a terminal mirror, with a convenient message box.

Run **one app process**: sessions and bounded terminal scrollback live in memory. Temporary relay failures retry with exponential backoff (0.5–10 seconds), preserving the pending exchange sequence. The CLI reports connection loss and successful reconnection. After an app restart or session expiry, it restores the same session link and replays a local terminal snapshot without restarting the command. Registration is idempotent and uses an account-scoped recovery credential that is never exposed to viewers. Open browsers detect a new relay generation and reload the snapshot. Multi-replica routing remains unsupported. During an outage, the CLI keeps up to 1 MiB of recent unsent output plus the pending exchange, discards older output if necessary, and keeps local work running. The CLI also retains an in-memory terminal snapshot with 1,000 scrollback lines of acknowledged output. Skipped outage output is reported on reconnection; screen state may be incomplete until the agent redraws if the unsent buffer overflows. Authentication failures (401/403) stop retries and explain how to authenticate and restart remote access. Sessions become offline after 30 seconds without a heartbeat and expire after one hour without activity. Limits: 10 sessions per account, 200 total, 1 MiB replay per session plus 1,000 terminal scrollback lines, 128 KiB pending input. Closing the local terminal ends the process; this does not implement persistent background sessions.

The account and the app server can access the terminal content and input. Keep this server within the trust boundary of the machine you are controlling. V0 does not provide end-to-end encryption, public session sharing, readiness detection, or guaranteed delivery after a server restart.

## Publishing a CLI release

CI builds and smoke-tests macOS/Linux on arm64/x64 and uploads the executables as workflow artifacts.
After a successful push build on main, `Release tested afbin CLI` automatically tags and publishes
those exact binaries with `SHA256SUMS`. It does not execute downloaded artifacts. Existing published
versions are skipped; partial drafts can be recovered by rerunning the workflow.

1. Run `npm run release:cli` from the repository root. This defaults to a patch bump
   (for example, 0.1.1 → 0.1.2) and updates the package, lockfile, and installer together.
2. Commit and merge the release PR. Once main CI passes, the tag and release are created automatically.
3. Verify the release workflow succeeds before deploying the app serving the corresponding installer.
   For a rollback, deploy an installer pinned to a previous release; users can also pass `--version` explicitly.

Unrelated merges do not create additional releases. Stale main CI completions are skipped in favor of
the newer main build. The tag-triggered `Publish afbin CLI` workflow remains available for manual
recovery; tags created with the automatic workflow's GitHub token do not trigger a duplicate build.

A missing release produces a clear download error and leaves any existing installation untouched.
