# Operations

## Run an OSS server

For source development, follow [CONTRIBUTING.md](../CONTRIBUTING.md). A source
checkout runs `npm ci`, `npm run setup`, then `npm run dev` (`.env.example`
documents every setting name).

The server keeps application data in PGLite and uploaded objects under its data
directory. One process owns a PGLite directory. Use a separate directory and port
for each instance. The external PostgreSQL settings in `.env.example` select
external PostgreSQL. Back up both the database and objects before upgrading.
Schema additions apply at startup.

## Configuration and access

When one deployment answers at more than one hostname — a marketing name that
proxies here, a previous name kept alive — `APP__PUBLIC_BASE_URL` stays the one
canonical origin and `APP__ALIAS_ORIGINS` lists the others, comma-separated
(HTTPS, or HTTP on a local development host such as `localhost` or `*.lvh.me`; no path, query or credentials; a malformed entry
refuses the boot). The pair is served publicly at `GET /api/server`, so clients
can accept a link carrying either name as this server while
still sending every request and credential to `APP__PUBLIC_BASE_URL` alone.
Unset, nothing changes: each hostname stays a separate server to clients.

A hosted server needs a stable `AUTH__SECRET`, the correct `APP__PUBLIC_BASE_URL`
and a login method; the server refuses to start without them. With a loopback
`APP__PUBLIC_BASE_URL`, login never uses mail at all: each code is printed by the
running server as `[dev-mail] otp email=… code=…` and appended to
the source development outbox at `.artifactbin/dev-mail.jsonl`; read it with
`npm run dev:otp -- EMAIL` (for `npm run dev` only).

See [serving and security](serving-and-security.md) for trust boundaries.

The OSS host includes authentication, authorization, the reader/editor,
comments, sharing, query execution and export. It does not contain a request
proxy or rate-limit policies. A deployment may put its own TLS proxy in front.
Production service composition and deployment policy live in the downstream
server repository.

Source development (`npm run dev`) also registers a local Lambda runner.
Hosts without the local runner require a separate one: set `RUNNER__SERVICE_URL`
and a matching `CONTRACT__ACTOR_SECRET` in their server settings.
See [runner setup and schedules](../services/runner/README.md) and
[the OSS feature setup guide](oss-onboarding.md) for prerequisites and availability.

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
Test accounts use the `mxmx_test_*` prefix and disposable state.

## CI reruns and required checks

- A new push to a pull request cancels that PR's earlier, unfinished CI runs through the `supersede` job
  (`scripts/lib/ci-supersede.mjs`). Nothing waits for the cancellation, so the new run starts at once. A
  workflow-level `concurrency` group would hold it pending until the old run had fully stopped.
- `page speed report` (`.github/workflows/page-speed.yml`) runs on every pull request so it always
  reports and can be a required check. A `scope` job compares the PR with its merge base against the
  push trigger's paths; when none changed, the report job only writes "No relevant changes" to the
  step summary.
