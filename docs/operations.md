# Operations

## Run an OSS server

```sh
afbin serve --dir ./artifactbin-data --port 7445
```

The server keeps application data in PGLite and uploaded objects under its data
directory. One process owns a PGLite directory. Use a separate directory and port
for each instance. `--db-url postgresql://…` selects external PostgreSQL;
`--dir` still owns local objects and server settings. Back up both the database
and objects before upgrading. Schema additions apply at startup.

The CLI downloads its versioned host runtime, DuckDB and Chromium when needed.
For source development, follow [CONTRIBUTING.md](../CONTRIBUTING.md).
For the container distribution, use the checked-in `docker-compose.yml` and
`.env.example`. Chromium is included in that image.

## Configuration and access

Client defaults and host credentials live under `~/.artifactbin`, separately
from server data. `afbin config set host URL` changes the client's default;
`--server URL` overrides it for one command. Neither configures the server.

A hosted server needs a stable `AUTH__SECRET`, the correct
`APP__PUBLIC_BASE_URL`, and a configured email provider for login. Local login
uses a protected development outbox; read a code with `npm run dev:otp -- EMAIL`.
Use `.env.example` for the supported settings and
[serving and security](serving-and-security.md) for trust boundaries.

The OSS host includes authentication, authorization, the reader/editor,
comments, sharing, query execution and export. It does not contain a request
proxy or rate-limit policies. A deployment may put its own TLS proxy in front.
Production service composition and deployment policy live in the downstream
server repository.

## Health, storage and export

- `/health` reports process liveness. `/api/health` reports readiness and probes
  any configured remote SQL, browser and event services.
- Unset service URLs select local implementations. Production can supply
  `SQL__SERVICE_URL`, `BROWSER__SERVICE_URL` and `EVENTS__SERVICE_URL` for the same
  contracts over HTTP.
- Live updates use database notifications: in-process for PGLite, a dedicated
  PostgreSQL connection for external storage.
- Chromium renders image exports. Cached exports are keyed by artifact version.
  Preserve uploaded objects as well as application records during backup/restore.
- Never run two processes against the same PGLite directory. External PostgreSQL
  supports separate processes; each still needs access to the same object store.

## Verification

Run `npm run validate` and `npm test` for affected checks. Full suites, browser
and Docker gates, and production builds run in CI; see [AGENTS.md](../AGENTS.md).
The CLI conformance gate exercises real login, ID registration, publication,
permissions, queries, conflicting edits and Chromium export against a running
host. Test accounts use the `mxmx_test_*` prefix and disposable state.
