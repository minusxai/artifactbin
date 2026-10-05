# Artifactbin

Interactive documents for people and agents. Create local files, preview and edit them in a browser, then publish and share. Use [app.artifactbin.dev](https://app.artifactbin.dev) or run your own server.

## Install and use

macOS / Linux (bash or zsh):

```sh
afbin_node_setup="$(mktemp)" && curl -fsSL https://app.artifactbin.dev/chat/ensure-node.sh -o "$afbin_node_setup" && . "$afbin_node_setup" && rm -f "$afbin_node_setup"
npx --yes @afbin/cli@latest setup
```

Windows PowerShell:

```powershell
Invoke-RestMethod https://app.artifactbin.dev/chat/ensure-node.ps1 | Invoke-Expression
npx.cmd --yes @afbin/cli@latest setup
```

Run both commands once, in the same terminal. The helper reuses supported Node/npm or installs official Node LTS for your user; `setup` installs the `afbin` command and the agent skills. npm is the sole CLI distribution. Where PowerShell scripts are disabled, run `afbin.cmd` in place of `afbin`.

```sh
afbin add report.jsx sales.csv --json
afbin preview report.jsx
afbin push report.jsx
```

Add assigns stable workspace-local IDs without uploading or signing in. Use `ref:ID` for datasets/media and `/a/ID` for navigation; artifact references reject local paths. Preview edits selected local source files without cloud access or credentials. Carry the project's `.artifactbin` directory with its files to preserve local identity, comments, history and recovery.

Push explicitly publishes a separate copy with remote IDs, preserving the originals and their local references. Its mapping lets later pushes update that publication. Local preview continues independently after publication. The default remote host is `app.artifactbin.dev`; CLI browser approval permits guests, while direct HTTP authentication requires email.

The package includes SQLite. Chromium is downloaded lazily when rendering requires it. Prepare an exact npm version and browser assets before disconnecting; warmed npm execution supports `--offline`, while a cold cache needs internet. Connected commands may show update notices, but never replace software automatically. `afbin update` installs the newer version.

For downloaded `.jsx.html` files, **Save** or **Cmd/Ctrl+S** keeps edits and comments. Start an empty server with `afbin preview --port 7474`, then choose **Connect to server**. See [portable files and server connections](docs/editing.md#edit-a-downloaded-html-file) for Save behavior, Windows commands and remote preview servers.

## Run your own server

```sh
afbin serve --dir ./artifactbin-data --port 7445
# In another terminal:
afbin config set host http://app.lvh.me:7445
afbin auth
afbin add report.jsx --json
afbin preview report.jsx
afbin push report.jsx
```

Use the origin the server prints (`http://app.lvh.me:7445` by default). Approval and login must happen at that exact origin; `localhost` and `127.0.0.1` are different origins and fail with `approval_origin_mismatch`. `lvh.me` and its subdomains resolve to loopback; app and document origins need the same site for private document cookies.

`serve` stays in the foreground. Its directory contains server settings, uploaded objects and a PGLite database; restart with the same directory to retain them. On startup it prints the host teammates set, Node helper links and npm setup for this host, and where login codes appear. Optional `--db-url postgres://…` or `--db-url pglite://…` selects the application database; SQLite still handles document queries.

Use `--server URL` for one command without changing defaults. `afbin config set host https://app.artifactbin.dev` restores the cloud default. Client host credentials and defaults live under `~/.artifactbin`, separately from server data. Published IDs belong to their host/account; local IDs belong to the portable workspace.

For trusted local collaboration, `afbin preview report.jsx --share` allows anyone who can reach that preview to edit/comment on its selected files. Use the authenticated server for persistent team hosting. [Hosting details](docs/extraction/team.md), and [team on a network](docs/extraction/team.md#team-on-a-network) for what a shared host needs: an HTTPS public URL, a login method and the URL teammates type.

## Develop

Requires Node.js 22 and npm; the default PGLite setup needs no Docker.

```sh
git clone https://github.com/minusxai/artifactbin.git
cd artifactbin
npm ci
npm run setup -- --yes
npm run dev
```

Open the public URL printed by setup: http://app.lvh.me:3030 by default. For another instance, use a separate checkout/data directory and `npm run setup -- --yes --port 7445`. Local login codes come from `npm run dev:otp -- your@email.example`; no mail provider is needed. See [CONTRIBUTING.md](CONTRIBUTING.md) for development and testing rules.

```sh
npm run validate
npm test
```

The local test wrapper runs affected tests within its file budget; broader suites, Docker and browser gates run in PR CI. A deferred local suite is not a pass.

## Modules and documentation

`services/cli` owns commands and local state; `services/app` owns the reader/editor and artifact APIs; `services/auth`, `services/sql`, `services/browser`, `services/events`, `services/runner`, `services/contracts` and `services/utils` provide shared capabilities. `afbin serve` composes the app services; lambdas use a separate runner. Source development includes a local runner.

[CLI reference](services/cli/README.md) · [Document format](docs/document-format.md) · [Editing](docs/editing.md) · [Operations](docs/operations.md) · [Security](docs/serving-and-security.md) · [Ownership](docs/ownership.md)

[OSS feature setup and first document](docs/oss-onboarding.md) · [Lambdas and schedules](services/runner/README.md) · [Remote review](docs/remote-review.md)

[Apache-2.0](LICENSE). Third-party license files remain with their runtime packages; the pinned Node runtime release includes its license.

The app root is the authenticated workspace. Logged-out visits redirect to `/login`. Marketing, examples, and hosted-service legal pages belong to the separate `artifactbin-web` repository and are not included in this toolkit.
