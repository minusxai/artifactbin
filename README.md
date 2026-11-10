# Artifactbin

Publish and share interactive documents through one author skill and an authenticated HTTP API.

## Author a document

Use the guide at `<server-origin>/llms.txt`, or download `<server-origin>/skills/artifactbin.zip`. Extract the `artifactbin/` folder into the directory your coding agent loads skills from and restart the agent. Reuse an existing installation rather than overwriting it.

The skill teaches email authentication, private origin-scoped credentials, source publication, comments, queries and exports. Read `/llms/http-auth` for authentication and `/llms/html-operations` for editing pages and comments over HTTP. Create with `POST /api/artifacts`; update an existing document by reading its identity/version, preparing its edited source and committing the returned update unchanged. Keep credentials out of pages and downloaded files.

Pages are normal HTML files that load the platform core script. The installed author skill documents HTML publication, native components and page state: viewer-local state from `@afbin/state` stays private to each browser, while shared data lives in linked datasets and backend functions. Page scripts run on isolated document origins; account credentials stay outside pages and downloaded files.

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
npm test -- --files <test paths>
```

The local test wrapper runs affected tests within its file budget; a deferred local suite is not a pass. Pull requests run the fast `pr fast` lane; full suites, Docker and browser gates run after merge.

## Modules and documentation

`services/app` owns the reader and artifact APIs. `services/auth`, `services/sql`, `services/browser`, `services/events`, `services/runner`, `services/contracts` and `services/utils` provide shared capabilities. The author skill lives at [services/app/skills/artifactbin](services/app/skills/artifactbin/SKILL.md). The HTTP skill is the public authoring path; standard OAuth, verified email login and account API-token access remain supported.

Reference:

- [Document format](docs/document-format.md): native HTML pages, page state, datasets and functions.
- [HTTP API](docs/http-api.md): authentication, artifact operations, datasets, groups.
- [Serving and security](docs/serving-and-security.md): accounts, isolation, access and portable files.
- [Page functions](docs/page-functions.md): how `/fn` calls and schedules are admitted and what they reach.
- [File uploads](docs/file-uploads.md), [screenshot comments](docs/screenshot-comments.md) and [notifications](docs/notifications.md).

Running a server:

- [OSS onboarding](docs/oss-onboarding.md): first login, first page and per-feature setup.
- [Operations](docs/operations.md): configuration, health, storage, S3 export uploads and production composition.
- [Account migration](docs/account-migration.md): the one-time Better Auth account schema upgrade.

Services:

- [SQL service](docs/sql-service.md), [browser service](docs/browser-service.md), [browser sessions](docs/browser-sessions.md) and the [program runner](docs/runner.md).

Working in this repository:

- [Scripts](docs/scripts.md): every program under `scripts/` and who runs it.
- [Agent workflows](docs/agent-workflows.md): delegated work, worktrees and gate containers.
- Dated measurements: [resolver call latency](docs/resolver-latency.md) and [dataset read latency](docs/dataset-read-latency.md).

[Security policy](SECURITY.md) · [Apache-2.0](LICENSE).
