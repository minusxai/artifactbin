# afbin

Publish and edit artifacts through local files, with offline help and validation. Mirror a local terminal with `afbin remote`.

Install it once as described in [Install and authenticate](#install-and-authenticate); every example below is `afbin <command>`.

## Preview and host

`preview` runs in the foreground until Ctrl+C. Run a preview command by itself; do not chain it with `&&` or pipe it to `tail`, because it stays open. Use another terminal for other commands while preview runs, or stop it with Ctrl+C before continuing in the same terminal. Automation should retain the handle to its preview child and stop only that process.

```sh
afbin preview --port 7474
afbin preview report.jsx appendix.jsx
afbin preview . --share
afbin serve --dir ./team --port 7445
afbin config set host http://app.lvh.me:7445
```

With no paths, `afbin preview --port 7474` starts an empty preview service; it does not select other files in the current directory. Open the printed URL to **Import an HTML file**, or choose **Connect to server** in your `.jsx.html` file and enter `http://localhost:7474`. Confirm the title, comment count and workspace filename, then choose **Import and open**. The server imports a workspace copy using the same validation and conflict checks as `afbin import`, and opens the existing full editor. The original HTML file stays unchanged; browser edits/comments then save to the workspace. Nothing is published. HTML payloads are limited to 25 MB; encoded JSON requests are separately limited to 50 MB, so unusually escaped files may reach the transport limit earlier.

A custom hosted preview service uses an HTTPS reverse proxy and `afbin preview --public-url https://preview.example.com`; the explicit public origin enables its Host/Origin checks and does not broaden the listener. Use `--share` only if the proxy or users must reach the listener from another machine. This is a preview-service connection, separate from account hosting through `serve`. Everyone who can reach a preview service can import, edit and comment within its workspace.

The same **Connect to server** action can target a hosted artifactbin origin. The hosted server recognizes the embedded artifact ID, checks sign-in and edit permission, and requires an explicit apply before updating the original. It uses the existing guarded JSONB update protocol against the verified downloaded baseline, so independent edits can coexist and overlapping edits report conflicts. Local preview imports remain workspace operations.

Default HTML downloads/exports use `<artifact-id>-<URL-slug>.jsx.html`; explicit output paths and names already opened or chosen in Save are retained. The embedded ID survives renaming.

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

The complete installer below prepares Node and installs afbin and agent skills in one command. For Node only, use `curl -fsSL https://app.artifactbin.dev/chat/install-node.sh | bash`, then reopen the terminal; PowerShell uses `Invoke-RestMethod https://app.artifactbin.dev/chat/install-node.ps1 | Invoke-Expression`. Node 22.13 or newer, npm and npx are required. The helper reuses a healthy existing installation or installs official Node 24 LTS into user-owned storage, verifies its checksum, and prepares PATH. No administrator, Homebrew or winget is required.

Windows x64, PowerShell 5.1 or 7:

```powershell
Invoke-RestMethod https://app.artifactbin.dev/chat/install.ps1 | Invoke-Expression
afbin.cmd preview report.jsx
```

Windows installation acceptance runs in the existing `cli-bootstrap` CI job,
using a fresh non-administrator account and Restricted PowerShell 5.1. It installs
official Node from a Node-free PATH, runs real npm setup against the exact candidate
tarball, verifies Claude/Codex skills and repeat setup, then opens a fresh shell to
check the global `afbin.cmd` version and a local SQL query. If setup prints a PATH
instruction, the test follows it before opening the new shell. Candidate metadata
is served by a loopback scoped registry; package bytes and npm installation are
unchanged. Dependencies reuse that account's preceding cold npx install cache.
Each native phase prints its duration; this is an installer check, not a browser gate.
After publishing, dispatch `Published Windows install smoke` with the expected
latest version. It uses the public helper and `npx.cmd --yes @afbin/cli@latest setup`
on a fresh account/cache, with explicit harness choices and JSON output for
automation. It checks the installed version instead of accepting a stale latest.
This separate smoke run adds no time to the required PR check chain.

macOS arm64/x64 and Linux arm64/x64 (glibc, bash or zsh):

```sh
curl -fsSL https://app.artifactbin.dev/chat/install.sh | sh
# Open a new terminal before using afbin.
afbin preview report.jsx
```

`setup` installs the `afbin` command and the agent skills; run it once. The Windows `.cmd` spellings (`npx.cmd`, `afbin.cmd`) run under ordinary Restricted PowerShell without changing execution policy. Open a new terminal after running the Unix installer so it receives the persisted PATH. If a download fails, install Node LTS from https://nodejs.org/en/download and rerun the setup line. If an old `afbin` reports `cli_npm_required`, run the setup line once.

There is one afbin distribution: `@afbin/cli` on npm. No standalone executable. `setup` installs the `afbin` command globally through npm and `afbin update` installs the version the selected server names (else the latest); neither replaces a running process. Close a running preview before restarting with a newer package. For a pinned or offline run, warm the npm cache and Chromium before disconnecting, then use `npm exec --offline --yes --package=@afbin/cli@VERSION -- afbin ...`. A cold cache cannot install offline. Package installation does not download Chromium; rendering downloads it on first use.

Existing standalone installs migrate themselves: their updater downloads a small bootstrap that installs the npm package on its next run and removes itself. To migrate now, run the setup line above; it backs up and removes the old executable. Do not run the old uninstall script first.

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

After a successful connected command saves and prints its result, a global npm installation automatically installs the exact newer version advertised by that server, at most once per hour. Installation runs in the foreground; the next invocation uses the new package and refreshes managed skills. Set `CLI__DISABLE_AUTO_UPDATES=true` or `afbin config set updates false` to disable it. The legacy `CLI__AUTO_UPDATE=0` switch remains supported. Local commands, dry runs, development copies, project/npm exec installations, version pins, offline runs, managed workers and session/remote commands skip automatic installation. There is no update-only HTTP request and no command replay. Concurrent attempts share a lock; npm calls time out after two minutes. Update failures are reported on stderr without changing the completed command’s output or exit status. npm upgrades in place: close other running previews/sessions before upgrading; an interrupted installation can require rerunning setup. An incompatible request fails before applying changes and reports the required version; `afbin update` remains available to install it.

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

`afbin remote --history history.md claude` runs in the background by default, including from another agent without a local TTY. A new managed Claude conversation without a caller-supplied session selector receives a stable Claude session UUID and prints `afbin remote --resume <local-session-id>` when its launch arguments are in the safe persistence allowlist (model, permission mode, output format, effort, max turns and selected boolean flags). Launches with other options or prompt text pass through unchanged and print that resume is unavailable; their arguments are not saved. The resume command starts a new remote relay and resumes the same Claude conversation in its original working directory and Claude config directory. It works after the prior agent exits. A running agent must be stopped before resuming. Caller-supplied Claude `--resume`, `--continue` or `--session-id` choices stay in effect. Use `--session <id>` to attach to the existing live relay instead. Use `--foreground` for an attached terminal. Names default to the executable name; use `--name claude2` for another instance. New names contain lowercase letters, digits, underscores and hyphens, starting with a letter (maximum 32 characters). Stop with `afbin remote --stop <id>`.

Managed harnesses receive automatic permission defaults unless explicitly overridden;
see [permission defaults](../../docs/remote-review.md#permission-defaults) for the flags and how to retain approvals. The generated private afbin helper restores only this session’s Artifactbin context when a harness filters shell environment variables. It uses a private, memory-only local socket on macOS and Linux; secrets stay out of helper files and command arguments. An explicit sandbox may block that socket. Approve only the exact readiness command through the harness’s existing approval flow when prompted; its sandbox and shell environment policy stay unchanged. If approval is denied or unavailable, the agent reports the block and waits for you. Windows retains inherited environment behavior; the private socket bridge is not supported there.

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
signing in.

For an artifact created in the browser, run `afbin auth <artifact-url>` (plus `--server <origin>`
for another server). A connection that can already edit continues immediately. Otherwise the
owning browser logs in with email and approves connecting the CLI to its account. Browser and CLI then share existing and future artifacts. Approving a different
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
import { loadConnection, runRemote } from '@afbin/cli';
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
[separate signed runner](../runner/README.md). Local preview, editing, SQL queries,
comments and exports run on your machine without that service. Executing a
published Lambda uses the selected server's runner; packaged `afbin serve`
requires `RUNNER__SERVICE_URL` and its signing secret, and otherwise returns
`runner_unavailable`. It does not install or start a local JavaScript execution
sandbox.

Publish a program definition using the same push/pull workflow as other files.
The `.program.json` suffix distinguishes it from JSON dataset rows:

```json
{"version":1,"command":["node","-e","console.log('hello')"],"env":{"REGION":"east"}}
```

```sh
afbin push worker.program.json --json
# Edit the definition, then push the same path to update the artifact.
afbin pull worker.program.json --json
# An untracked program ID pulls to <id>.program.json by default.
afbin pull abc123 --json
```

Program JSON carries its command, optional compute settings and nonsecret string
environment configuration. Identity and revisions remain in workspace tracking.
The server validates execution and environment policy. Programs use `runs start`
and `schedule` with the same artifact ID as document handlers.

Create a schedule for any executable artifact, including a program artifact:

```sh
afbin schedule create --artifact abc123 --cron '0 9 * * *' --timezone Asia/Kolkata --input '{"region":"east"}' --max-attempts 3 --retry-backoff 60 --json
afbin schedule list --json
afbin schedule get sch_123 --json
afbin schedule update sch_123 --cron '0 10 * * *' --input null --json
afbin schedule pause sch_123 --json
afbin schedule resume sch_123 --json
afbin schedule run sch_123 --json
afbin schedule history sch_123 --json
afbin schedule delete sch_123 --json
```

Schedules reference the live published artifact: every attempt resolves its
current source and authorization, without a version pin. Schedule `--input`
takes inline JSON; omitted create input uses the server default. Cron and IANA
timezone validation belong to the server. `--max-attempts` and `--retry-backoff`
configure occurrence retries. Manual `run` saves its request identity before
submission; after an uncertain response repeat the same command and arguments
in the same workspace to recover it. Use `--request <stable-id>` to supply a
caller identity. History reports occurrences, attempts and their run results.
These commands use the same authenticated HTTP API as the scheduling UI.

## V0 boundaries

The relay uses authenticated HTTP polling (~200 ms runner / 250 ms viewer), so it works through the existing app proxy and a custom host without a separate WebSocket service. It forwards terminal bytes, including screen redraws and menus. It is a terminal mirror, with a convenient message box.

Run **one app process**: sessions and bounded terminal scrollback live in memory. Temporary relay failures retry with exponential backoff (0.5–10 seconds), preserving the pending exchange sequence. The CLI reports connection loss and successful reconnection. After an app restart or session expiry, it restores the same session link and replays a local terminal snapshot without restarting the command. Registration is idempotent and uses an account-scoped recovery credential that is never exposed to viewers. Open browsers detect a new relay generation and reload the snapshot. Multi-replica routing remains unsupported. During an outage, the CLI keeps up to 1 MiB of recent unsent output plus the pending exchange, discards older output if necessary, and keeps local work running. The CLI also retains an in-memory terminal snapshot with 1,000 scrollback lines of acknowledged output. Skipped outage output is reported on reconnection; screen state may be incomplete until the agent redraws if the unsent buffer overflows. Authentication failures (401/403) stop retries and explain how to authenticate and restart remote access. Sessions become offline after 30 seconds without a heartbeat and expire after one hour without activity. Limits: 10 sessions per account, 200 total, 1 MiB replay per session plus 1,000 terminal scrollback lines, 128 KiB pending input. Foreground sessions end with their terminal. The default managed mode survives launcher exit, reserves its identity durably and queues explicit comment mentions; see [remote review](../../docs/remote-review.md) for readiness, stop and interrupted delivery.

The account and the app server can access the terminal content and input. Keep this server within the trust boundary of the machine you are controlling. V0 does not provide end-to-end encryption, public session sharing, readiness detection, or guaranteed delivery after a server restart.

## Publishing a CLI release

Run `npm run release:cli` in the CLI PR. Main CI builds `npm run build -w services/cli`, then `npm run pack:release -w services/cli` creates one tarball with an isolated npm consumer shrinkwrap. That exact artifact is installed outside the checkout on Windows x64 and macOS/Linux arm64/x64, with Node 22 and 24. The official node-pty dependency is pinned to 1.2.0-beta.15 because its npm tarball includes native prebuilds for all supported architectures, including Linux; installation does not require a compiler. This prerelease pin must pass the Node22/24 native matrix. Native acceptance verifies SQLite, sharp, node-pty shutdown, warmed offline npm execution, preview and exports. Chromium stays lazy at package install.

The public `cli-pack` job signs the exact tarball with npm's Sigstore/SLSA provenance helper from the pinned Node 22.22.3/npm 10.9.8 toolchain. Its `.tgz.sigstore` bundle identifies that build's real source commit and GitHub run. A companion `.tgz.build.json` receipt records the actual checkout SHA and API head SHA separately: an owned PR's tested merge SHA differs from its head SHA. Release validation checks the receipt against the selected run and signed payload, then cryptographically verifies the bundle and its owned CI workflow certificate identity. Owned PR builds can be signed and reused through a tested-run receipt; fork PR builds cannot sign. Successful main CI triggers `release-cli.yml`, which checks the bundle against the selected build run and publishes those same bytes and that same bundle. It never substitutes the later release workflow's source SHA for the build's SHA.

**First publication of `@afbin/cli`:** npm requires a package to exist before configuring a trusted publisher. The release workflow detects a missing package, prints the exact commands, and stops without creating a GitHub release. Merge the product PR only after its checks are green. After main CI produces the signed candidate and publication is approved:

1. Use the maintainer's verified npm login (`npm whoami`; run `npm login` if necessary). This first publish may require the account's 2FA confirmation.
2. Copy the download command from the waiting release workflow log. It includes the selected **build run ID**, including any reused tested-run receipt:
   ```sh
   gh run download <selected-build-run-id> --repo minusxai/artifactbin --name afbin-npm-release --dir afbin-first-release
   ```
3. For this release, publish the downloaded package with its downloaded signature. Do not rebuild it locally:
   ```sh
   npm publish afbin-first-release/afbin-cli-0.4.0.tgz --access public --provenance-file afbin-first-release/afbin-cli-0.4.0.tgz.sigstore --ignore-scripts
   ```
   `--provenance-file` attaches and cryptographically verifies the original build's signed provenance, taking precedence over automatic generation. Do not also supply `--provenance` or `--provenance=false`; npm rejects both combinations. No placeholder package or CI bootstrap token is needed.
4. Check a clean registry installation and signed provenance before advancing deployment:
   ```sh
   npm install --prefix afbin-registry-check @afbin/cli@0.4.0 --no-audit --no-fund
   (cd afbin-registry-check && npx --yes npm@11.19.0 audit signatures --json --include-attestations)
   ```
   Require a successful audit with no invalid/missing signatures or attestations and a verified `@afbin/cli@0.4.0` provenance entry. The resumed release checks registry integrity against the downloaded tarball; downstream deployment verification repeats the integrity/provenance checks before serving installers. In npm's package settings, add the GitHub trusted publisher: owner `minusxai`, repository `artifactbin`, workflow `release-cli.yml`, no environment. **Allow direct publish**, because new trust configurations default to staging only. Alternatively, with npm 11.15 or newer:
   ```sh
   npm trust github @afbin/cli --repo minusxai/artifactbin --file release-cli.yml --allow-publish
   ```
5. Resume the waiting **release workflow run**, whose ID differs from the build ID:
   ```sh
   gh run rerun <waiting-release-run-id> --repo minusxai/artifactbin
   ```
   This verifies npm's immutable version contains the exact tested bytes and creates the GitHub release. It needs no additional version bump or app build. Only after registry installation/provenance verification and release creation should deployment advance the app source pin and serve the npm-only front page. This task does not change the downstream deployment pin.

Subsequent releases publish through OIDC, with the signed build bundle supplied explicitly. A registry outage fails visibly; a different tarball under an existing version is rejected. The GitHub release is recorded only after npm publication or matching existing registry bytes, so downstream deployment verification keeps its publish-before-server order. No npm bearer token is embedded in installers or repository files.

The package is public and immutable per version. GitHub records the tested tarball for traceability. Official npm references: [trusted publishing](https://docs.npmjs.com/trusted-publishers/), [trusted publisher prerequisites and direct publish](https://docs.npmjs.com/cli/v11/commands/npm-trust/), and [publishing with a provenance file](https://docs.npmjs.com/cli/v11/commands/npm-publish/). First-package registry acceptance remains unobserved until the approved publication; local tests and CI signing do not claim that registry proof.

No local production build or npm publication is part of ordinary development. Use FAST validate and focused tests, then the combined PR's final CI matrix. Clean Windows 11 desktop policies remain separate from the native Windows Server runner's coverage.

Upload an attachment to a published document’s declared dataset import with `afbin upload receipt.pdf --in abc123 --name expenses --json`. The receipt contains `ref`, `url`, `name`, `contentType` and `size`; store the returned reference with the document’s declared mutation when needed. Uploading creates the file without changing dataset rows. Use `--idempotency-key <key>` to recover the same upload after an uncertain response; keep the same document, import and bytes. Only declared imports and authorized dataset writers may upload.
