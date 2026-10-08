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

The CLI downloads its versioned host runtime and Chromium when needed; its SQL engine is built in.
For source development, follow [CONTRIBUTING.md](../CONTRIBUTING.md).
To self-host, `afbin serve` is the whole distribution: it owns its data
directory and plans its settings from the same questions `npm run setup` asks
(`.env.example` documents every name).

## Configuration and access

Client defaults and host credentials live under `~/.artifactbin`, separately
from server data. `afbin config set host URL` changes the client's default;
`--server URL` overrides it for one command. Neither configures the server.

When one deployment answers at more than one hostname — a marketing name that
proxies here, a previous name kept alive — `APP__PUBLIC_BASE_URL` stays the one
canonical origin and `APP__ALIAS_ORIGINS` lists the others, comma-separated
(HTTPS, or HTTP on a local development host such as `localhost` or `*.lvh.me`; no path, query or credentials; a malformed entry
refuses the boot). The pair is served publicly at `GET /api/server`, so afbin
accepts a link or a tracked folder carrying either name as this server while
still sending every request and credential to `APP__PUBLIC_BASE_URL` alone.
Unset, nothing changes: each hostname stays a separate server to clients.

A hosted server needs a stable `AUTH__SECRET`, the correct `APP__PUBLIC_BASE_URL`
and a login method; `afbin serve` refuses to start without them. With a loopback
`APP__PUBLIC_BASE_URL`, login never uses mail at all: each code is printed by the
running server as `[dev-mail] otp email=… code=…` and appended to
`<dir>/data/outbox.jsonl`. (`npm run dev:otp -- EMAIL` reads the *source*
development outbox at `.artifactbin/dev-mail.jsonl` in this repository, not a
served directory, so it is for `npm run dev` only.)

The team host accepts its own settings, not the repository's `.env.example`:
copying that one fails with `Unsupported team setting: OBJECT_STORE__LOCAL_DIR`.
Use [`docs/extraction/server.env.example`](extraction/server.env.example) for the
settings `afbin serve` accepts, [team hosting](extraction/team.md) for a shared
host, and [serving and security](serving-and-security.md) for trust boundaries.

The OSS host includes authentication, authorization, the reader/editor,
comments, sharing, query execution and export. It does not contain a request
proxy or rate-limit policies. A deployment may put its own TLS proxy in front.
Production service composition and deployment policy live in the downstream
server repository.

Source development (`npm run dev`) also registers a local Lambda runner.
Packaged `afbin serve` hosts require a separate runner: set `RUNNER__SERVICE_URL`
and a matching `CONTRACT__ACTOR_SECRET` in their `server.env`.
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
The CLI conformance gate exercises real login, ID registration, publication,
permissions, queries, conflicting edits and Chromium export against a running
host. Test accounts use the `mxmx_test_*` prefix and disposable state.

## CI reruns and required checks

- Recover a red CLI matrix cell with a **full** `gh run rerun <run-id>`. The cells wait for the packed
  candidate and platform seeds of their own run attempt (`scripts/lib/ci-artifact-wait.mjs`), and that
  provenance is deliberately never relaxed to an earlier attempt. `gh run rerun --failed` starts a new
  attempt in which the already-green pack job does not run again, so the cell times out with
  "Current-attempt artifact timed out" and a hint naming this section. A 404 or 5xx on an artifact the
  listing already reports is retried for up to 60 seconds, which absorbs the delay before a new blob is
  downloadable.
- Pull requests run a reduced CLI matrix (Linux x64, macOS 14 and Windows on Node 22.22.3: 12 cells);
  main, the nightly and dispatch run all 28. Release PRs therefore prove fewer platforms before merge,
  and main still proves the rest.
- `page speed report` (`.github/workflows/page-speed.yml`) runs on every pull request so it always
  reports and can be a required check. A `scope` job compares the PR with its merge base against the
  push trigger's paths; when none changed, the report job only writes "No relevant changes" to the
  step summary.
