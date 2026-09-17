# afbin

Publish and edit artifacts through local files, with offline help and validation. Mirror a local terminal with `afbin remote`.

## Preview and host

```sh
afbin preview report.jsx appendix.jsx
afbin preview . --share
afbin serve --dir ./team --port 7445
afbin config set host http://localhost:7445
```

Preview writes browser saves to selected local files without publishing. Shared previews allow
anyone who can reach them to edit/comment; stop the foreground process to end the session.
Add assigns stable IDs; preview and push use those IDs without rewriting artifact references.
Preview still works after publication using the workspace host/account.

`serve` owns persistent authenticated hosting. `--dir` holds settings, objects and the default
PGLite database; optional `--db-url postgres://…` or `pglite://…` overrides only that database.
Client defaults/credentials stay separate. There is no managed self daemon.

## Install and authenticate

```sh
curl -fsSL https://app.artifactbin.dev/chat/install.sh | sh
```

The installer needs `curl`, `gzip`, a SHA-256 tool and a POSIX shell: it downloads the standalone executable for this
platform as gzip, verifies both compressed and executable SHA-256 checksums and installs it in `~/.local/bin` (`--dir` and `--version`
select another destination or release). A failed verification leaves an existing installation
untouched; an installation that already is the requested release is left alone without a download,
and verified downloads are kept in `~/.cache/afbin` so a reinstall never fetches twice. The installer
then runs `afbin setup`: a checklist starts with detected agents selected (or your saved choices).
Use ↑/↓ to move, Space to toggle and Enter to install. Skills appear together under an indented
summary, followed by any restart instructions. Run `afbin setup` again to change your selection;
unchecking a previously installed skill leaves its files in place and opts out of future updates.
For an unattended install, use `sh install.sh --yes`; without a terminal the defaults are accepted
automatically, with no sign-in or waiting for browser approval. The interactive installer runs
`afbin auth` after successful skill setup; if sign-in is cancelled, run `afbin auth` later.
Skill setup stays offline. `afbin setup --service sql` explicitly downloads and checks the optional SQL engine. A server with a CLI built beside it
(`npm run build:binary -w services/cli`) serves that build
itself, so `curl http://localhost:3030/chat/install.sh | sh` downloads the binary from that server.
On a terminal the installer colours its output and shows a download progress bar;
`NO_COLOR` turns colour off and `FORCE_COLOR` turns it on elsewhere. Self-hosted servers serve the
same script, pinned to the release they were built with;
`/install.sh` is the separate self-hosted **server** installer.

Standalone releases use Node's small-ICU build: English locale formatting is included; other locale
formatting may fall back to English. Unicode normalization, IDN URLs and the Intl APIs remain.
Core downloads exclude DuckDB. The first local CSV/JSON/document query downloads the matching,
checksummed SQL package, then runs it locally in the CLI's Node runtime. No local rows are uploaded.
Prepare it before disconnecting with `afbin setup --service sql`; later queries reuse the verified
cache under `~/.artifactbin/services/sql` (`ARTIFACTBIN_HOME` relocates it). Each executable pins the
package identity, so a CLI upgrade may need another first-use download. Corrupt cache entries fail
closed with a removal/retry instruction. The npm/source CLI uses its installed DuckDB dependency.
For development or a trusted mirror, `CLI__SERVICE_BASE_URL` accepts an HTTPS base URL with an optional path prefix (HTTP loopback
also works); append `afbin-vVERSION/afbin-sql-OS-ARCH.gz` to that base. A locally built server
uses `CLI__SERVICE_BASE_URL=http://localhost:3030/chat/releases`. Checksums stay pinned in the executable.
Local JSX image export uses the cached preview runtime and lazily downloaded Chromium: `afbin export report.jsx --output report.png`. It renders current local bytes and registered ID dependencies without publishing or rewriting source. A locally registered ID also selects its local file; other IDs and explicit artifact URLs use their server. PNG/JPG support `--page` and `--og`. HTML still requires a published head.

Remove it again with `curl -fsSL https://app.artifactbin.dev/chat/uninstall.sh | sh`. That deletes the
executable, `~/.artifactbin`, cached downloads and the agent skills afbin manages, and never touches
your project files. `--keep-state` keeps your sign-in and the download cache, `--dry-run`
only lists, and `--dir` names a custom executable location.

The default remote server is `https://app.artifactbin.dev`. Explicit `--server`,
`ARTIFACTBIN_URL`, and saved host settings still take precedence. Credentials remain
scoped to their original host; users switching from the old apex host must authenticate
on the new host. `afbin config set host https://app.artifactbin.dev` updates a saved
host preference.

Authentication opens browser approval and saves credentials privately in `~/.artifactbin/hosts/<origin-id>/credentials.env`.
Skill setup supports Claude Code, Codex, pi and OpenCode and remembers your choices. Standalone executables
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
teach the same flags and rules. At a terminal, `afbin help` and `afbin <command> -h` print colour
screens sized to the window; automation, pipes, `--json` and `--output` get the agent brief and plain
text, also available as `afbin help brief` and `afbin help commands`. `NO_COLOR` and `FORCE_COLOR`
apply to every command.

Nothing is written into your working directory. All local state — which files are tracked, the server
state last accepted, account resources, Markdown conversions and interrupted operations — lives in one
private SQLite database at `~/.artifactbin/state.sqlite` (`ARTIFACTBIN_HOME` moves it), and a tracked
file is recorded by the SHA-256 of its bytes rather than by a copy of them. There is nothing to commit
and nothing to add to `.gitignore`. A forced overwrite keeps the replaced bytes under
`~/.artifactbin/backups/local` and prints that absolute path. Images, PDFs and files are identified by
content hash, so publishing bytes you already own reuses that artifact instead of uploading them again.

A command reference is `<url|id|path>[@version]`; existing filenames win. Published references in
markup use `ref:<id>`, including Query/Mutation sources. SQL names tables; `$query` binds a result.
Old reference spellings are rejected. Register files with add and reference their IDs. Local-path references in artifact source are refused.

For automation, use `setup --yes --json --harness pi --harness opencode`, or `--harness none`.
A pending browser approval returns its URL and expiry; approve it and rerun setup. `--yes` does not
approve the browser or imply `--force`. No noninteractive prompt waits for input.

Managed standalone installations check for updates in a detached background process, at most
once a day. Normal commands only inspect local state and launch the worker; they never wait for
update network requests. Failed or interrupted attempts retry after an hour on a later invocation.
The worker uses an OS-held lock (released even after SIGKILL), 30-second download stall timeouts
and a five-minute overall deadline. It downloads checksummed releases from the configured server's
release pointer (`/chat/release.json`) and atomically replaces the executable. Running commands
continue normally; the next invocation runs the new binary and synchronizes selected skills locally.
An older invocation cannot downgrade newer skills. Modified skill files are backed up before updates.
Exactly one previous binary is kept, as `~/.artifactbin/binary-backups/afbin-<replaced version>`; each
successful update prunes the older backups it supersedes. Skill backups follow the same rule: one copy
per harness, as `~/.artifactbin/skill-backups/<harness>-<replaced version>`, older ones pruned.

Export `CLI__AUTO_UPDATE=0` to disable background updates. Export `CLI__VERSION_PIN=X.Y.Z` to
disable automatic changes and restrict explicit updates to that server-advertised release. Pins do
not download arbitrary versions: use the installer's `--version` to install a particular release.
Source/npm installations remain managed by their package manager and never self-update.

`afbin update` still performs an explicit foreground update of the standalone executable and selected
skills, reporting errors and recovering interrupted installations. `afbin update --dry-run` previews
changes. Background workers never write skills, change saved harness selections, authenticate,
or print into the invoking command. Setup and subsequent local skill synchronization report restart
instructions for Claude Code and Codex, which load skills at startup; running sessions do not reload.
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
used only for their matching server origin. The installer passes the origin it was served from
to `afbin setup --server`, which records a self-hosted origin as the default in `.env` (the first
origin recorded stays; the public server needs no record). A directory tracks one server and
account; a command that selects another server is refused by name before any request. HTTP is restricted to localhost development. Tokens are
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

Build on each target OS/architecture using Node 22. The build creates a [Node single executable application](https://nodejs.org/docs/latest-v22.x/api/single-executable-applications.html), embeds node-pty and its native helper, and applies ad-hoc signing on macOS. It needs no separately installed Node runtime or node_modules on the destination. Terminal native files extract into a private temporary directory for the process lifetime; SQL uses the verified persistent cache described above. Each of the four release targets has its own build and smoke gate. Public macOS distribution would additionally need your signing/notarization process. No binaries are committed.

The build downloads the small-ICU Node executable pinned in `runtime-lock.json`, verifies both
compressed and executable SHA-256, and reuses a verified local copy. A cache miss downloads the
same versioned release asset; ordinary builds never compile Node. `CLI__NODE` is an explicit raw-runtime
build/test override. GitHub's dependency cache is only an acceleration layer, not the runtime's
source of availability.

To update Node or its build recipe, change `scripts/small-node.mjs` and run the dedicated
**Build CLI Node runtimes** workflow with a new `cli-node-v<version>-r<revision>` tag. This is the
infrequent source compilation step. It publishes prepared runtimes and upstream notices in a
separate prerelease; it does not advance the user-facing CLI release pointer. Download those
assets into one directory, then run from the repository root:

```sh
node services/cli/scripts/pin-runtime.mjs cli-node-v22.22.3-r2 /path/to/runtime-assets
```

Review and commit the resulting `services/cli/runtime-lock.json`, then require the four-platform
CLI CI to pass using those downloaded bytes. Existing runtime revisions are never overwritten.

Linux and Intel Mac packaging also need Python 3.8–3.14. The build creates a private virtual
environment and installs hash-pinned LIEF 0.17.6 to preserve ELF native symbol lookup and Mach-O
TLS. Python and LIEF are build tools.

## V0 boundaries

The relay uses authenticated HTTP polling (~200 ms runner / 250 ms viewer), so it works through the existing app proxy and a custom host without a separate WebSocket service. It forwards terminal bytes, including screen redraws and menus. It is a terminal mirror, with a convenient message box.

Run **one app process**: sessions and bounded terminal scrollback live in memory. Temporary relay failures retry with exponential backoff (0.5–10 seconds), preserving the pending exchange sequence. The CLI reports connection loss and successful reconnection. After an app restart or session expiry, it restores the same session link and replays a local terminal snapshot without restarting the command. Registration is idempotent and uses an account-scoped recovery credential that is never exposed to viewers. Open browsers detect a new relay generation and reload the snapshot. Multi-replica routing remains unsupported. During an outage, the CLI keeps up to 1 MiB of recent unsent output plus the pending exchange, discards older output if necessary, and keeps local work running. The CLI also retains an in-memory terminal snapshot with 1,000 scrollback lines of acknowledged output. Skipped outage output is reported on reconnection; screen state may be incomplete until the agent redraws if the unsent buffer overflows. Authentication failures (401/403) stop retries and explain how to authenticate and restart remote access. Sessions become offline after 30 seconds without a heartbeat and expire after one hour without activity. Limits: 10 sessions per account, 200 total, 1 MiB replay per session plus 1,000 terminal scrollback lines, 128 KiB pending input. Closing the local terminal ends the process; this does not implement persistent background sessions.

The account and the app server can access the terminal content and input. Keep this server within the trust boundary of the machine you are controlling. V0 does not provide end-to-end encryption, public session sharing, readiness detection, or guaranteed delivery after a server restart.

## Publishing a CLI release

CI builds and smoke-tests macOS/Linux on arm64/x64. A version bump publishes the exact
assets from successful main CI; unrelated merges leave existing releases unchanged.

1. Run `npm run release:cli -- [patch|minor|major]` from the repository root (patch by default).
   This updates the CLI package, lockfile, installer and release pointer together.
2. Run `npm run generate:teaching -w services/cli` and merge the release PR after passing checks.
3. Successful main CI triggers `Release tested afbin CLI`, which tags that exact commit and
   publishes all four tested executables, host runtimes, DuckDB/Chromium packages and checksums.
   The release stays draft until every asset is attached. Published releases are immutable.
4. Deploy a matching server/installer only after publication succeeds. Rollback keeps the
   previous release available; installers also accept `--version` explicitly.

`Publish afbin CLI` remains a manual recovery path for an existing CI-tested main tag; it
rebuilds and tests all four targets before creating a release, and never overwrites one.

The separate `Build CLI Node runtimes` workflow is manual maintenance for a new pinned
Node runtime revision. Ordinary CLI builds download and verify the existing runtime.

A missing release produces a clear download error and leaves any existing installation untouched.

### Standalone download boundaries

The executable carries the CLI and checksum manifests. First preview/serve downloads the versioned `afbin-runtime-<platform>-<arch>.gz` into the private runtime cache. SQL and Chromium retain separate lazy packages. Verified caches work offline; cold first use needs network access. npm installations include their runtime. PGLite in the standalone host includes its ESM runtime, WASM/data and filesystem adapters, without optional extensions, alternate CJS distributions, types or source maps. CI exercises initialization, transactions, restart, preview and real host publication. Size reports separate core, host runtime and SQL; core downloads are capped at 35 MB on all four platforms.
