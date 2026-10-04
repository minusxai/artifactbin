# afbin

Publish and edit artifacts through local files, with offline help and validation. Mirror a local terminal with `afbin remote`.

Command examples use `afbin` as shorthand for `npx --yes @artifactbin/cli@latest` (`npx.cmd` on Windows); use that npm invocation unless you installed a development link.

## Preview and host

```sh
afbin preview report.jsx appendix.jsx
afbin preview . --share
afbin serve --dir ./team --port 7445
afbin config set host http://app.lvh.me:7445
```

Preview writes browser saves to selected local files without publishing. Shared previews allow
anyone who can reach them to edit/comment; stop the foreground process to end the session.
Add assigns stable workspace-local IDs. Preview retains those IDs without sign-in or cloud access, including after publication. Push preserves the local files and creates a separate publication copy whose references use remote IDs.

`serve` owns persistent authenticated hosting. `--dir` holds settings, objects and the default
PGLite database; optional `--db-url postgres://…` or `pglite://…` overrides only that database.
Client defaults/credentials stay separate. There is no managed self daemon. Set the client host to
the origin the server prints (`http://app.lvh.me:7445` by default: `lvh.me` names resolve to 127.0.0.1,
and documents are served on their own origins under it): `http://127.0.0.1:7445` is a different
origin and `afbin auth` refuses it. `--port` selects the listener for this run only; it is
never written back to `server.env`, so a later `afbin serve --dir X` uses the port in that file again.
For a shared host see [team on a network](../../docs/extraction/team.md#team-on-a-network).

## Install and authenticate

Node 22.13 or newer, npm and npx are required. The helper reuses a healthy existing installation or installs official Node 24 LTS into user-owned storage, verifies its checksum, and prepares PATH. No administrator, Homebrew or winget is required.

Windows x64, PowerShell 5.1 or 7:

```powershell
Invoke-RestMethod https://app.artifactbin.dev/chat/ensure-node.ps1 | Invoke-Expression
npx.cmd --yes @artifactbin/cli@latest setup
npx.cmd --yes @artifactbin/cli@latest preview report.jsx
```

macOS arm64/x64 and Linux arm64/x64 (glibc, bash or zsh):

```sh
afbin_node_setup="$(mktemp)" && curl -fsSL https://app.artifactbin.dev/chat/ensure-node.sh -o "$afbin_node_setup" && . "$afbin_node_setup" && rm -f "$afbin_node_setup"
npx --yes @artifactbin/cli@latest setup
npx --yes @artifactbin/cli@latest preview report.jsx
```

The Windows `.cmd` spelling runs under ordinary Restricted PowerShell without changing execution policy. The Unix helper must be sourced so this terminal receives PATH immediately. If a download fails, install Node LTS from https://nodejs.org/en/download and rerun the npx command.

There is one afbin distribution: `@artifactbin/cli` on npm. No standalone executable or self-updater is supported. `@latest` resolves the latest published package when launched online; it does not update a running process hourly. Close a running preview before restarting with a newer package. Pin a version for reproducible use (`npx --yes @artifactbin/cli@VERSION ...`). Warm the npm cache and Chromium before disconnecting, then use `npm exec --offline --yes --package=@artifactbin/cli@VERSION -- afbin ...`. A cold cache cannot install offline. Package installation does not download Chromium; rendering downloads it on first use.

Existing standalone users keep their project files and `~/.artifactbin` state. Remove the old executable from PATH and stop any old processes, then use the commands above. Do not run the old uninstall script when migrating: it can remove credentials and skills. Agents must use npx commands rather than an old `afbin` executable found on PATH.

The default remote server is `https://app.artifactbin.dev`. Explicit `--server`,
`ARTIFACTBIN_URL`, and saved host settings still take precedence. Credentials remain
scoped to their original host; users switching from the old apex host must authenticate
on the new host. `afbin config set host https://app.artifactbin.dev` updates a saved
host preference.

Authentication opens browser approval and saves credentials privately in `~/.artifactbin/hosts/<origin-id>/credentials.env`.
Skill setup supports Claude Code, Codex, pi and OpenCode and remembers your choices. The npm package includes versioned local skill bundles.

```sh
afbin pull <artifact-url> report.jsx
# Edit report.jsx, retaining its YAML fence and body IDs.
afbin validate report.jsx
afbin diff report.jsx
afbin push report.jsx
```

Push publishes a local workspace through its separate publication copy. Local `status`, `diff`, validation and help need no HTTP; `--remote` refreshes a comparison. Portable-workspace `push --dry-run` validates its local dependency graph without HTTP or publication; it does not preflight remote permissions. Normal push may read remote state even when the source is unchanged. `afbin -h`, command `-h`, `afbin help <topic>` and the installed man page
teach the same flags and rules. At a terminal, `afbin help` and `afbin <command> -h` print colour
screens sized to the window; automation, pipes, `--json` and `--output` get the agent brief and plain
text, also available as `afbin help brief` and `afbin help commands`. `NO_COLOR` and `FORCE_COLOR`
apply to every command.

Local workspaces keep identity, comments, history and recovery state in their `.artifactbin` directory; copy that directory with the project to continue on another machine. Publication copies and their remote-ID mappings also live there. Credentials and client settings remain under `~/.artifactbin` (`ARTIFACTBIN_HOME` moves it), separately from local workspace state. Forced remote overwrites retain replaced bytes under `~/.artifactbin/backups/local` and report that path.

A command reference is `<url|id|path>[@version]`; existing filenames win. Published references in
markup use `ref:<id>`: `<Import name="d" src="ref:<id>" />` reads a dataset or folder as `d.<table>`, and a
connected Postgres query runs inside it with `<Query source="ref:<id>">`. SQL names tables; `$query` binds a result.
Old reference spellings are rejected. Register files with add and reference their IDs. Local-path references in artifact source are refused.

For automation, use `setup --yes --json --harness pi --harness opencode`, or `--harness none`.
A pending browser approval returns its URL and expiry; approve it and rerun setup. `--yes` does not
approve the browser or imply `--force`. No noninteractive prompt waits for input.

Connected commands may show an update notice at most hourly; notices never install or replace software. Local commands and pinned invocations make no update-check request. A compatible old package continues normally. An incompatible request fails before applying changes and reports the required version with the npx command to run. `@latest` is launch-time npm resolution, not background installation.

A server must deploy its new release pointer after the release has published before users discover it.

## Local development

From the repository root (Node 22+, plus Python/make/C++ on Linux for node-pty):

```sh
npm ci
npm run build -w services/cli
node services/cli/dist/afbin.mjs remote claude --chrome
```

Use `npm link -w services/cli` to install the `afbin` command locally, then:

```sh
afbin remote --name codex2 codex
afbin remote pi
afbin remote opencode
afbin --server http://localhost:6401
afbin remote --server http://localhost:6401 claude --chrome
```

The flags prompt accepts quoted arguments (for example `--model "my model"`) without shell expansion. If no supported harness is installed, afbin explains how to install one or run an explicit executable.

`afbin remote --history history.md claude` runs in the background by default, including from another agent without a local TTY. Use `--foreground` for an attached terminal. Names default to the executable name; use `--name claude2` for another instance. New names contain lowercase letters, digits, underscores and hyphens, starting with a letter (maximum 32 characters). Stop with `afbin remote --stop <id>`.

Managed harnesses receive automatic permission defaults unless explicitly overridden;
see [permission defaults](../../docs/remote-review.md#permission-defaults) for the flags and how to retain approvals.

Put afbin options **before** the command; everything after the command goes to the harness unchanged. Your working directory, environment, installed skills, and local input/output remain available. The CLI starts the executable directly, without constructing a shell command string. You can explicitly run a shell too: `afbin remote bash`.

Open the printed session link, or `/chat` on the selected server, and sign into the same artifactbin account. Select a session, swipe up/down to scroll terminal history (or use Scroll up, Scroll down, and Latest output), and use the terminal directly, the message box, or the Enter/Escape/arrow buttons. **Switch to mobile** and **Switch to desktop** resize the shared terminal. The selected size stays in effect even when the local terminal sends input or automatic replies. **Stop agent** ends a managed background worker and its child process group. With `--foreground`, **Disconnect** removes remote access and leaves the local command running; Ctrl+C goes to that command as usual.

The browser retries temporary failures indefinitely with capped backoff and a “Reconnecting…” status, preserving the visible terminal. Successful polls clear that status. Full-screen agents may manage their own history separately from terminal scrollback. Disconnect stops relay retries; bounded in-memory disconnect records last up to one hour.

## Auth

The first command that needs the server opens browser authentication automatically, saves the
connection with owner-only permissions and resumes the command. Run `afbin auth` to sign in
deliberately; local skills install eagerly on first use and update with `afbin update`.

On remote/headless machines, skip the browser with `afbin auth --email <email>`. It sends an
email OTP and returns `otp_required` (exit 2); ask the user for the code, then run
`afbin auth --email <email> --otp <code>` to finish without opening a browser or resending the code.
Pass the same `--server <origin>` to both commands for another server. This explicitly selects the
email account, replacing saved credentials only after successful authentication.

If browser launch fails, authentication exits immediately with `browser_unavailable`. Browser
approval waits at most 45 seconds in automation, or the five-minute pairing window interactively.
The waiting message and timeout errors recommend email login; retry the original command after
signing in. Email login does not transfer artifacts owned by a guest browser.

For an artifact created in the browser, run `afbin auth <artifact-url>` (plus `--server <origin>`
for another server). A connection that can already edit continues immediately. Otherwise the
owning browser approves connecting the CLI to its identity; guests can choose **Continue as guest**
without logging in. Browser and CLI then share existing and future artifacts. Approving a different
identity replaces the saved CLI connection for that server; denial leaves it unchanged.

`ARTIFACTBIN_URL` and `ARTIFACTBIN_TOKEN` can supply a connection; saved credentials are
used only for their matching server origin. The installer passes the origin it was served from
to `afbin setup --server`, which records a self-hosted origin as the client default in
`~/.artifactbin/config.json` (the first origin recorded stays; the public server needs no record). A directory tracks one server and
account; a command that selects another server is refused by name before any request. HTTP is restricted to localhost development. Tokens are
sent in authorization headers, never session URLs. No legacy credential file is read.

Bare commands offer a picker of installed agent executables. The harness itself must be installed.

## Artifact comments

Type `@` in an artifact comment or reply and select one of your online sessions.
Mentions identify that exact session and can only address your own account's agents.
Managed sessions hold queued comments until the harness acknowledges readiness and
allow one active request at a time. Delivery is acknowledged by the worker;
working, blocked and completed states come from correlated agent replies.

The agent reads the artifact and thread through its CLI, acknowledges the request,
verifies its work and posts a correlated final reply. Agent replies do not trigger
more requests. Pending work and refusal receipts are durable; a relay restart marks
in-flight work uncertain rather than replaying it. A new tagged comment can
supersede blocked or uncertain work. Foreground sessions retain direct terminal
input behavior. See [remote review](../../docs/remote-review.md) for the complete
readiness, request and stop protocol.

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

## Lambdas

Publish a JSX artifact whose Helmet script default-exports an async function,
then `afbin runs start <artifact> --request <stable-id> --input input.json --json`.
Poll `afbin runs status <runId>` for its terminal status, output and receipt;
`afbin runs events <runId>` reads emitted events and `afbin runs cancel <runId>`
requests cancellation. `afbin help lambdas` has complete authoring examples.
Source dev includes a local runner; packaged hosts need the
[separate signed runner](../runner/README.md). Cron schedules use the app's HTTP API.

## V0 boundaries

The relay uses authenticated HTTP polling (~200 ms runner / 250 ms viewer), so it works through the existing app proxy and a custom host without a separate WebSocket service. It forwards terminal bytes, including screen redraws and menus. It is a terminal mirror, with a convenient message box.

Run **one app process**: sessions and bounded terminal scrollback live in memory. Temporary relay failures retry with exponential backoff (0.5–10 seconds), preserving the pending exchange sequence. The CLI reports connection loss and successful reconnection. After an app restart or session expiry, it restores the same session link and replays a local terminal snapshot without restarting the command. Registration is idempotent and uses an account-scoped recovery credential that is never exposed to viewers. Open browsers detect a new relay generation and reload the snapshot. Multi-replica routing remains unsupported. During an outage, the CLI keeps up to 1 MiB of recent unsent output plus the pending exchange, discards older output if necessary, and keeps local work running. The CLI also retains an in-memory terminal snapshot with 1,000 scrollback lines of acknowledged output. Skipped outage output is reported on reconnection; screen state may be incomplete until the agent redraws if the unsent buffer overflows. Authentication failures (401/403) stop retries and explain how to authenticate and restart remote access. Sessions become offline after 30 seconds without a heartbeat and expire after one hour without activity. Limits: 10 sessions per account, 200 total, 1 MiB replay per session plus 1,000 terminal scrollback lines, 128 KiB pending input. Foreground sessions end with their terminal. The default managed mode survives launcher exit, reserves its identity durably and queues explicit comment mentions; see [remote review](../../docs/remote-review.md) for readiness, stop and interrupted delivery.

The account and the app server can access the terminal content and input. Keep this server within the trust boundary of the machine you are controlling. V0 does not provide end-to-end encryption, public session sharing, readiness detection, or guaranteed delivery after a server restart.

## Publishing a CLI release

Run `npm run release:cli` in the CLI PR. Main CI builds `npm run build -w services/cli`, then `npm run pack:release -w services/cli` creates one tarball with an isolated npm consumer shrinkwrap. That exact artifact is installed outside the checkout on Windows x64 and macOS/Linux arm64/x64, with Node 22 and 24. Native acceptance verifies SQLite, sharp, node-pty shutdown, warmed offline npm execution, preview and exports. Chromium stays lazy at package install.

Successful main CI triggers `release-cli.yml`, resolves any tested-run receipt, and publishes the tested tarball to npm using OIDC trusted publishing. Configure `@artifactbin/cli`'s trusted publisher for this repository and workflow before the first release; no npm bearer token is embedded in installers or repository files. The package is public and immutable per version. There are no SEA/executable or platform-specific runtime release assets in this release path. The GitHub release records the same tested tarball for traceability.

No local production build or npm publication is part of ordinary development. Use FAST validate and focused tests, then the combined PR's final CI matrix. Clean Windows 11 desktop policies remain separate from the native Windows Server runner's coverage.
