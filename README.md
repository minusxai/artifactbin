# Artifactbin

Interactive documents for people and agents. Create local files, preview and edit them in a browser, then publish and share. Use [artifactbin.dev](https://artifactbin.dev) or run your own server.

## Install and use

```sh
curl -fsSL https://artifactbin.dev/chat/install.sh | sh
afbin auth
afbin add report.jsx sales.csv --json
afbin preview report.jsx
afbin push report.jsx
```

`artifactbin.dev` is the default host. `add` assigns stable, server/account-scoped IDs without uploading. Reference datasets and media with `ref:ID`; use `/a/ID` for navigation links. Local paths inside artifact references are rejected. Preview reads registered local files and saves browser edits back to them; push publishes registered unpublished dependencies first. It does not rewrite paths or silently publish changes to an already-published dependency.

The installer supports macOS and Linux, ARM64 and x64, without Node or sudo. The CLI downloads its host runtime, DuckDB and Chromium when needed and caches them. `afbin help` works offline. `afbin update` updates the verified executable and agent skills.

## Run your own server

```sh
afbin serve --dir ./artifactbin-data --port 7445
# In another terminal:
afbin config set host http://localhost:7445
afbin auth
afbin add report.jsx --json
afbin preview report.jsx
afbin push report.jsx
```

`serve` stays in the foreground. Its directory contains server settings, uploaded objects and a PGLite database; restart with the same directory to retain them. The server prints setup and login instructions. Optional `--db-url postgres://…` or `--db-url pglite://…` selects the application database; DuckDB still handles queries.

Use `--server URL` for one command without changing defaults. `afbin config set host https://artifactbin.dev` restores the cloud default. Client host credentials and defaults live under `~/.artifactbin`, separately from server data. IDs belong to the host/account that reserved them.

For trusted local collaboration, `afbin preview report.jsx --share` allows anyone who can reach that preview to edit/comment on its selected files. Use the authenticated server for persistent team hosting. [Hosting details](docs/extraction/team.md).

## Develop

Requires Node.js 22 and npm; the default PGLite setup needs no Docker.

```sh
git clone https://github.com/minusxai/artifactbin.git
cd artifactbin
npm ci
npm run setup -- --yes
npm run dev
```

Open http://localhost:3030. For another instance, use a separate checkout/data directory and `npm run setup -- --yes --port 7445`. See [CONTRIBUTING.md](CONTRIBUTING.md) for development and testing rules.

```sh
npm run validate
npm test
```

The local test wrapper runs affected tests within its file budget; broader suites, Docker and browser gates run in PR CI. A deferred local suite is not a pass.

## Modules and documentation

`services/cli` owns commands and local state; `services/app` owns the reader/editor and artifact APIs; `services/auth`, `services/sql`, `services/browser`, `services/events`, `services/contracts` and `services/utils` provide shared capabilities. `afbin serve` composes them in one process; other deployments can compose the same module entrypoints with their own infrastructure.

[CLI reference](services/cli/README.md) · [Document format](docs/document-format.md) · [Editing](docs/editing.md) · [Operations](docs/operations.md) · [Security](docs/serving-and-security.md) · [Ownership](docs/ownership.md)

[Apache-2.0](LICENSE). Third-party license files remain with their runtime packages; the pinned Node runtime release includes its license.

The app root is the authenticated workspace. Logged-out visits redirect to `/login`.
Marketing, examples, and hosted-service legal pages belong to the separate
`artifactbin-web` repository and are not included in this toolkit.
