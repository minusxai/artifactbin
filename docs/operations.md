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

`APP__OUTBOUND_IPS` lists the IP addresses this deployment's outbound traffic
leaves from (resolver database connections, `caps.fetch`, web ingestion), comma-separated
IPv4 or IPv6. It is served publicly at `GET /api/outbound-ips` and shown beside each
database connection in the Resolvers panel, so page owners know what to allow in a
database firewall. It depends on your network (an Elastic IP, a NAT gateway), so it
is unset by default, which serves an empty list; a malformed entry refuses the boot.

A hosted server needs a stable `AUTH__SECRET`, the correct `APP__PUBLIC_BASE_URL`,
`APP__PAGES_HOST` and a login method. In production the server refuses to start
without the first two, and anywhere without `APP__PAGES_HOST` (every document is
served on its own origin beneath it). With a loopback
`APP__PUBLIC_BASE_URL`, login never uses mail at all: each code is printed by the
running server as `[dev-mail] otp email=… code=…` and appended to
the source development outbox at `.artifactbin/dev-mail.jsonl`; read it with
`npm run dev:otp -- EMAIL` (for `npm run dev` only).

### Test-domain accounts

Automated runs (the agent evals) create disposable accounts with
`TEST_DOMAIN` (for example `test.example.com`) and `TEST_DOMAIN_OTP` (a random
code of 32 to 128 letters, digits, `-` or `_`; for example
`openssl rand -hex 32`). With both set, any address whose domain is exactly
`TEST_DOMAIN` signs in with that code through the normal login flow (the author
skill's `auth.mjs` or the login page), and nothing is mailed to that domain.
Subdomains and look-alike names (`x@sub.test.example.com`,
`x@test.example.com.other.net`) are ordinary addresses. Either name unset turns
the feature off; an invalid pair also leaves it off and logs why at boot. The
code is checked the way every login code is: single use, five attempts, and the
deployment's usual rate limits. Both the identity service and the app read the
pair; in a split deployment give both the same values.

Rows the app creates for these addresses are marked `users.test_account`;
existing rows are never marked. A test account works normally among test
accounts but: shares only with addresses at
`TEST_DOMAIN`; invites only test accounts to artifacts and groups (group
invitations by email only to `TEST_DOMAIN`); on an artifact that is not owned by
a test account or by a group a test account created, can only read and fork (no comments, likes, shares or `$_me` writes); follows
only test accounts; and never creates notifications for non-test users.
Deleting old test accounts and their artifacts is a planned follow-up; the
marking exists so that cleanup can select exactly these rows.

See [serving and security](serving-and-security.md) for trust boundaries.

The OSS host includes authentication, authorization, the native HTML reader,
comments, sharing, query execution and export. It does not contain a request
proxy or rate-limit policies. A deployment may put its own TLS proxy in front.
Production service composition and deployment policy live in the downstream
server repository.

Source development (`npm run dev`) also registers a local runner for native backend resolvers.
Hosts without the local runner require a separate one: set `RUNNER__SERVICE_URL`
and a matching `CONTRACT__ACTOR_SECRET` in their server settings.
See [the runner](runner.md) and
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

Run `npm run validate` and `npm test -- --files <test paths>` while working. Full
suites, browser and Docker gates, and production builds run in CI; see
[AGENTS.md](../AGENTS.md).
Test accounts use the `mxmx_test_*` prefix and disposable state.

## CI reruns and required checks

- Pull requests run only `pr fast` (`.github/workflows/pr-fast.yml`). The full `ci` workflow runs on each
  push to main and by manual dispatch; a push whose exact tree a green run already tested selects no jobs.
- `page speed report` (`.github/workflows/page-speed.yml`) runs on each push to main and by manual
  dispatch, never on a pull request; full performance evidence is post-merge.

Anonymous publishing hosts use optional `APP__USER_PAGES_HOST` (off by default). A live user or group
handle maps underscores to hyphens in one host label. Public HTML appears on its public home; unlisted HTML
is available only by ID and carries noindex and no-referrer. Copies retain app canonical URLs. Host
requests are guests even if they carry cookies or bearer tokens; only read operations reach page data (sql reads, GET functions).
The former custom-domain attachment, DNS verification and path override APIs have been removed.
Enabling wildcard DNS and TLS is an operator deployment step; the product never provisions a hostname.

## Skill release folders (installed updater)

Installed skills update themselves from `/skills/artifactbin.zip`, and the updater refuses any archive member
outside the folders it knows (`services/app/skills/artifactbin/scripts/toolbox-update-archive.mjs`; the server
packager's list is `services/app/lib/skills/package.ts` and `services/app/lib/skills/assets.ts`). A release may only ship a new folder once installs
run an updater that accepts it, or their auto-update stops. `resolvers/` (`*.ts`, the copyable resolver library) is
accepted by the updater and shipped by the packager.

## Export uploads to S3

When the app stores exports in S3, the browser service can upload each rendered image itself
([browser service](browser-service.md#render-and-upload)). Set `BROWSER__UPLOAD_ORIGIN` to the exact HTTPS
origin the app's signer emits and `BROWSER__UPLOAD_PREFIX` to the absolute path ending in `/exports/objects/`.
For virtual-hosted S3 these might be `https://bucket.s3.us-west-1.amazonaws.com` and
`/artifacts/exports/objects/`; path-style storage also puts the bucket in the path. The gateway receives the same
origin and prefix and no S3 credentials.

`BROWSER__UPLOAD_PROXY_URL` points the browser at the internal upload gateway
(`services/browser/src/upload-gateway-server.ts`). The browser has no egress network; the gateway joins the
compute and egress networks with no published ports. It permits only bounded PNG and JPEG PUTs to the configured
origin and prefix, streams bytes, strips other headers and never follows redirects. The restriction lives in the
gateway, not in a VPC firewall; a host with an S3 endpoint policy can also enforce it there.

The 30-second export budget covers the render queue, startup, readiness, capture and upload. The app's 60-second
database lease leaves time for cleanup, and waiting callers stop after 35 seconds. A failed refresh keeps the
prior successful object. Signed grants are short-lived and must not be logged.

## Shared source and production composition

Production pins this repository as a Git submodule. Its build imports the shared TypeScript through each
package's entry points, bundles each production service and copies its assets; production deployment code lives
in the private repository, and nothing here is published as a package.

| Module | Shared implementation | Production use |
| --- | --- | --- |
| `services/contracts` | Actor, SQL, browser, events, runner and transport types and constants | The same contracts for local and HTTP implementations |
| `services/utils` | Signed HTTP transport, audited config and service clients | Communication between separately deployed services |
| `services/app` | The reader, publication, revisions, references, comments, sharing, permissions, storage and query orchestration | The app, with Postgres, object storage and remote SQL, browser and events |
| `services/auth` | Login and OAuth, sessions and identity resolution | Authentication composed into the private proxy |
| `services/sql` | SQLite (wasm) queries, worker-thread pool and HTTP shell ([SQL service](sql-service.md)) | The SQL service; no native engine |
| `services/browser` | Chromium rendering, sessions and HTTP shell ([browser service](browser-service.md)) | The browser service, with Playwright and Chromium installed |
| `services/events` | Event schema, writer and HTTP shell | The events service, with its own database and private integration subscribers |
| `services/runner` | The isolated program runner and its controller ([runner](runner.md)) | The runner controller |

The OSS host combines authentication, the app and local services in one process, with no separate proxy or
gateway rate limits. Production owns forwarding, request-rate policy, managed integrations and operator access
policy.

The app's `createAppHost` entry (`services/app/server/host.ts`) opens no socket and loads no native engine. The
production build installs each service's external dependencies separately: the SQL and browser images get their
engines, the app image neither, and production copies the shared reader and runtime assets into the app image.
Customization uses narrow interfaces: HTTP and local service adapters, authentication session providers, event
subscribers, a document-editor policy over authenticated claims (`documentEditorPolicy`) and mutation extension
hooks. Shared artifact permissions stay authoritative.

For a coordinated change, commit here, update production's submodule pin, then run production's checks; the
production commit and the exact pinned SHA identify the build. Production builds each service image, checks that
the app's dependency closure excludes Playwright and any native SQL engine, and runs its Postgres and container
conformance checks.
