# services/cli/src: source map

Where the code for each part of `afbin` lives. This file is for people and agents working on the CLI;
the user guide is [../README.md](../README.md). [test/source-map.test.ts](../test/source-map.test.ts) fails when a
command routed by `dispatch.ts` has no row below, when a path here names a missing file, or when a source
file is not listed: update this map in the same change.

The process starts at `main.ts`, which picks the host process (CLI, preview host, team host, remote worker)
before it imports anything else, then calls `runCli` in `dispatch.ts`. `dispatch.ts` routes every
command through one if-chain over `command`. `account-workspace.ts` routes the account resource kinds
(`--type profile`, `session`, ...) inside push, pull, status, diff, validate and delete.

## Commands

One row per command `dispatch.ts` routes. Handler modules are listed in the order a command reaches them.

| Command | Handler modules | Notes |
|---|---|---|
| `add` | `local-workspace.ts` | `registerLocalFiles` |
| `auth` | `browser-auth.ts`, `loopback-auth.ts`, `email-auth.ts` | no-click loopback sign-in, else device approval; `--email` OTP login |
| `comment` | `local-comments-command.ts`, `read-commands.ts` | local folder first, then `commentCommand` |
| `config` | `config.ts` | `setClientDefault`, inline `get` |
| `delete` | `account-workspace.ts`, `delete.ts` | resources through the account plan; `--type comment` through `deleteComments` |
| `diff` | `comparison.ts` | `diffCommand`, local first, then remote |
| `export` | `export.ts` | `exportResources`, local and then remote |
| `fork` | `fork.ts` | `forkResources` |
| `help` | `teaching.ts`, `help-screen.ts`, `teaching-origin.ts` | also every `--help` |
| `import` | `local-html-import.ts` | `importLocalHtml` |
| `invite` | `dispatch.ts` | inline: `POST /artifacts/<id>/members` |
| `join` | `dispatch.ts` | inline: `POST /artifacts/<id>/members` |
| `list` | `read-commands.ts`, `remote-query.ts`, `account-workspace.ts` | `readCommand`; `--type table` `discoverTables`; `--type session` `listAccountCollection` |
| `log` | `local-history.ts`, `read-commands.ts` | local history, then remote `readCommand` |
| `members` | `dispatch.ts` | inline: `POST /artifacts/<id>/members` |
| `mention` | `dispatch.ts` | inline: `GET /artifacts/<id>/members?query=` |
| `mv` | `local-workspace.ts`, `identities.ts` | `moveLocalFile` in a portable folder, else `moveFile` |
| `open` | `open.ts` | `openResources` |
| `preview` | `preview-options.ts`, `preview-runtime.ts` | `servePreview` starts the packaged preview host |
| `pull` | `pull.ts` | `preparePull`, `pull`, `pullToStdout` |
| `push` | `sync.ts`, `local-publication.ts`, `markdown.ts`, `dataset-source.ts`, `account-workspace.ts` | `planPush`/`push`; portable folders `publishLocalWorkspace`; `.md` conversion; `--secret-env` |
| `query` | `local-query.ts`, `remote-query.ts`, `mutation-command.ts` | local engines first; `mixedQuery`; `--write` `queryMutation` |
| `remote` | `remote-state.ts`, `attach.ts`, `launcher.ts`, `runner.ts`, `remote-launch.ts`, `claude-conversation.ts` | `--stop`, `--session`, `--foreground`, background launch |
| `runs` | `runs.ts` | `runCommand` |
| `schedule` | `schedules.ts` | `scheduleCommand` |
| `serve` | `host-runtime.ts`, `serve-config.ts` | `serveTeam` starts the packaged team host |
| `sessions` | `browser-sessions.ts` | `browserSessionCommand` |
| `setup` | `setup.ts`, `skill-install.ts`, `global-install.ts` | skills, the global `afbin`, `--service` |
| `status` | `local.ts`, `comparison.ts`, `account-workspace.ts` | `localStatus`, `remoteStatus` |
| `testuser` | `testuser.ts` | `testUserCommand` |
| `update` | `update.ts`, `update-progress.ts`, `skill-install.ts` | `updateCli` |
| `upload` | `upload.ts` | `uploadAttachment` |
| `validate` | `validation.ts`, `sync.ts`, `account-workspace.ts` | local `validateFiles`; `--remote` a dry-run push |
| `watch` | `watch.ts` | `watchCommand`: new comments as NDJSON until cancelled |
| `workspace` | `workspace-rebind.ts` | `rebindWorkspace` |

## Import groups

Measured from the import graph with the hubs (below) removed: four groups.

### Hubs

Imported by ten or more source files; read these first.

| File | What it holds |
|---|---|
| `commands.ts` | The command vocabulary: parsing, flags, help, man pages and skills read it. |
| `config.ts` | Server selection, saved connections, client defaults and remote context. |
| `dataset-file.ts` | Which local files are dataset rows (`.csv`, `.json`, `.geojson`). |
| `document.ts` | The local document shape: metadata and body. |
| `errors.ts` | `CliError`: code, message, fix, exit code. |
| `files.ts` | File digests and local state initialization for mutating operations. |
| `http.ts` | `HttpClient`: the one transport, with refresh, sign-in and refusal codes. |
| `journal.ts` | The durable file journal: staged writes and their recovery. |
| `local-workspace.ts` | Portable authoring folders: identity and discussion in the folder. |
| `reference.ts` | Resolve an argument (path, id, URL, `@version`) to a reference. |
| `resource-file.ts` | Typed resource YAML files and their declared paths. |
| `state-access.ts` | One open state store per directory for the life of the process. |
| `state.ts` | The CLI's only local state: one SQLite database under the config directory. |
| `workspace.ts` | Registered workspaces, discovery from the working directory, tracking. |

### Command layer

What `dispatch.ts` calls to do a command's work.

| File | Purpose |
|---|---|
| `dispatch.ts` | `runCli`: parse, select a server, route every command (table above). |
| `arguments.ts` | Normalize closed CLI-owned enums. |
| `batch.ts` | Run a command per target, keeping each outcome. |
| `collection-filters.ts` | Filter schemas for list and log. |
| `diagnostics.ts` | Shared recovery vocabulary for errors, help, the manual and skills. |
| `operator-error.ts` | Startup failures as operator text. |
| `platform.ts` | Windows boundaries: browser URLs and private file ACLs. |
| `result-output.ts` | Write data output to a private file or stdout. |
| `style.ts` | Terminal styling for human output. |
| `tabular.ts` | Rows to CSV. |
| `version.ts` | `CLI_VERSION`. |
| `version-order.ts` | Release ordering for updates and skill installs. |
| `browser-auth.ts` | Browser consent and bounded polling. |
| `loopback-auth.ts` | No-click browser sign-in: loopback listener, PKCE, code exchange. |
| `email-auth.ts` | Two-step OTP login. |
| `server-identity.ts` | Who the selected server is, across its hostnames. |
| `setup.ts` | Offline setup: skill selection before any write. |
| `skill-install.ts` | Install and report the agent skills. |
| `global-install.ts` | The `afbin` command on PATH through npm. |
| `update.ts` | `afbin update`. |
| `update-progress.ts` | The terminal view of a foreground update. |
| `auto-update.ts` | Observe releases during a command; install after it commits. |
| `chromium.ts` | Prepare the browser outside render deadlines. |
| `teaching.ts` | The compiled help, manual and skill bundle. |
| `teaching-origin.ts` | Fill the server address into the teaching bundle. |
| `help-screen.ts` | Help screens for a terminal. |
| `man.ts` | Roff output for the manual page. |
| `group-destination.ts` | Resolve group handles to immutable destination IDs and save authenticated setup defaults. |
| `identities.ts` | Register and resolve file identities. |
| `markdown.ts` | One-time Markdown to JSX conversion on push. |
| `local-html-import.ts` | Import an exported HTML file as data. |
| `local-comments-command.ts` | `comment` over the portable annotation store. |
| `local-history.ts` | Portable local versions. |
| `local-query.ts` | `query` against local engines. |
| `local-document-query.ts` | Run a local document's declared query. |
| `local-dataflow.ts` | Compile and run a local document's dataflow in process. |
| `local-html.ts` | Offline HTML export over the local compiler and reader. |
| `local-html-options.ts` | Options for the local HTML export. |
| `local-image-options.ts` | Options for the local image export. |
| `dataset-source.ts` | Bind a dataset's connection secret on push. |
| `sqlite-wasm.ts` | Where the SQLite wasm comes from in a built CLI. |
| `sqlite-wasm-embedded.ts` | The SQLite wasm bytes, replaced at build time. |
| `read-commands.ts` | Remote `list`, `log` and `comment`, and artifact references. |
| `remote-query.ts` | Remote and mixed queries; table discovery. |
| `mutation-command.ts` | `query --write`: a document's dataset mutation. |
| `comparison.ts` | `status` and `diff` against the server. |
| `comment-images.ts` | Download comment images to private local files. |
| `export.ts` | `export`: published rendering, local images. |
| `fork.ts` | `fork`: a new local draft from a source. |
| `open.ts` | `open`: the published view in a browser. |
| `upload.ts` | `upload`: a document attachment. |
| `runs.ts` | `runs`: execute a published artifact. |
| `testuser.ts` | `testuser`: mint and erase test users. |
| `browser-sessions.ts` | `sessions`: live browser sessions. |
| `watch.ts` | `watch`: follow new comments as NDJSON. |
| `remote-launch.ts` | Launch a background remote agent. |
| `remote-state.ts` | Stop a remote agent and reconcile its exit. |
| `attach.ts` | Attach to a live remote relay. |
| `launcher.ts` | Discover agent executables on PATH. |
| `claude-conversation.ts` | Plan, save and resume managed Claude conversations. |
| `serve-config.ts` | `serve` operator options. |
| `team-config.ts` | Team host settings and data. |
| `team-application.ts` | Compose the team host from the shared login and the app. |
| `team-entry.ts` | Foreground team host entry. |
| `preview-entry.ts` | Foreground preview host entry. |
| `preview-options.ts` | Expand the files a preview serves. |
| `preview-render.ts` | The local export's render request. |
| `preview/annotations.ts` | Preview annotations over local state. |
| `preview/comments.ts` | Preview comments with hosted anchors. |
| `preview/compiled.ts` | The publish-time compiler, run locally. |
| `preview/connect-import.ts` | Import browser offers through the existing importer. |
| `preview/editor.ts` | The editor protocol over local files. |
| `preview/graph.ts` | The documents and references a preview session covers. |
| `preview/local-inputs.ts` | Local bytes behind a registered reference. |
| `preview/session.ts` | File-backed preview sessions: saves, SQL inputs, comments. |

### Sync and publication

Moving bytes between a workspace and the server, durably.

| File | Purpose |
|---|---|
| `sync.ts` | `push`: plan, send, finish a saved request. |
| `pull.ts` | `pull`: prepare and write remote heads. |
| `resource-pull.ts` | Prepare resource YAML and source bytes for one local commit. |
| `reconcile.ts` | Pure local reconciliation of remote state. |
| `restore.ts` | `push --restore` and `push --refresh`. |
| `conflict.ts` | Conflict-only observation after writes. |
| `conflict-state.ts` | Saved conflicts and their fix text. |
| `pending-request.ts` | A frozen operation preserved across a forced pull. |
| `recoverable-operation.ts` | One record coordinating a native mutation. |
| `document-recovery.ts` | Acknowledge a lost reply when the change is present. |
| `delivery-observer.ts` | Keep delivery evidence before the journal clears. |
| `local-publication.ts` | Publish offline drafts, keeping their local IDs. |
| `local-comment-publication.ts` | Publish local discussions through the mutation journal. |
| `publication-binding.ts` | Remotely bound originals as the authoring baseline. |
| `local.ts` | Local status and snapshots. |
| `validation.ts` | Local validation with line and column diagnostics. |
| `program-file.ts` | Executable JSON versus dataset rows. |
| `upload-input.ts` | Asset input for a pushed file. |
| `account-workspace.ts` | Account resource kinds (profile, sessions, ...) inside sync commands. |
| `account-diagnostic.ts` | Explain a workspace account mismatch. |
| `workspace-ownership.ts` | Advisory offline ownership. |
| `workspace-rebind.ts` | `workspace`: move a workspace to another account. |
| `sessions.ts` | Remote sessions as a read-only resource kind. |
| `schedules.ts` | `schedule`. |
| `delete.ts` | `delete` for artifacts, kinds, sessions and comments. |

### Process runtime

The processes the CLI starts and the hosts it runs.

| File | Purpose |
|---|---|
| `main.ts` | Process entry: choose the host before importing the CLI. |
| `index.ts` | The package's public exports. |
| `entry-args.ts` | Host selector arguments. |
| `foreground-process.ts` | Owned shutdown for foreground hosts. |
| `host-runtime.ts` | Load the packaged team host. |
| `preview-runtime.ts` | Load the packaged preview host. |
| `local-html-runtime.ts` | Spawn the lazy runtime for HTML export. |
| `local-image-runtime.ts` | Spawn the lazy runtime for image export. |
| `pty.ts` | The node-pty binding. |
| `runner.ts` | Run a remote agent session in the foreground. |
| `remote-worker.ts` | The detached remote worker. |
| `remote-input.ts` | Deliver relay input to the agent's terminal. |
| `remote-context.ts` | Permission options for managed sessions. |
| `remote-context-bridge.ts` | Memory-only context transport to child commands. |
| `hosted-agent.ts` | Run a hosted agent with its native identity. |
| `hosted-opencode.ts` | OpenCode session identity for hosted agents. |

### Preview browser

The browser half of `afbin preview`, bundled separately.

| File | Purpose |
|---|---|
| `preview/client.tsx` | The preview page. |
| `preview/backend.ts` | `ArtifactBackend` over the local preview routes. |
| `preview/edit-controller.ts` | The preview's story controller. |
| `preview/types.ts` | The `/document` JSON shape. |
| `preview/connect.tsx` | Local capabilities for the shared file receiver. |
