# Artifactbin

Publish and share interactive documents through one author skill and an authenticated HTTP API.

## Author a document

Use the guide at `<server-origin>/llms.txt`, or download `<server-origin>/skills/artifactbin.zip`. Extract the `artifactbin/` folder into the directory your coding agent loads skills from and restart the agent. Reuse an existing installation rather than overwriting it.

The skill teaches email authentication, private origin-scoped credentials, source publication, comments, queries and exports. Read `/llms/http-auth` for authentication and `/llms/http-authoring` for the current source format. Create with `POST /api/artifacts`; update an existing document by reading its identity/version, preparing its edited source and committing the returned update unchanged. Keep credentials out of pages and downloaded files.

Pages are normal HTML files that load the platform core script. The installed author skill documents HTML publication, native components and Apollo state: viewer-local state stays private to each browser, while shared data uses explicitly linked backends. Page scripts run on isolated document origins; account credentials stay outside pages and downloaded files.

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

`services/app` owns the reader and artifact APIs. `services/auth`, `services/sql`, `services/browser`, `services/events`, `services/runner`, `services/contracts` and `services/utils` provide shared capabilities. The author skill lives at [services/app/skills/artifactbin](services/app/skills/artifactbin/SKILL.md).

The HTTP skill is the public authoring path. Standard OAuth, verified email login and account API-token access remain supported. The main branch release pipeline stays separate from this branch.

[Source format](docs/document-format.md) · [Historical editing architecture](docs/editing.md) · [Operations](docs/operations.md) · [Security](docs/serving-and-security.md) · [Ownership](docs/ownership.md) · [Apache-2.0](LICENSE).
