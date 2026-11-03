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
See [runner configuration](../services/runner/README.md) and
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

## Dataset policy migration (stored v1/v2 → v3)

Dataset permissions are version 3 (Hasura metadata shape). Every door still reads a stored
version 1 or 2 policy as v3; `scripts/migrate-dataset-policies.ts` rewrites the stored rows.
**Self-hosted operators: run it with `--apply` before (or right after) upgrading past the removal
of the v2 grant compatibility.** Until it runs, a v2 grant naming one person (`from:{user:<id>}`) or
one page (`from:{artifact:<id>}`) admits only what its v3 reading allows: the named person loses
access (the rewrite shares the dataset with them), and signed-out readers lose a page-scoped read.
The server does not run it at boot: it creates shares and reports items an operator reviews.

1. **Dry run** (the default; one `READ ONLY` transaction, a read-only database role is enough):
   `node --import tsx scripts/migrate-dataset-policies.ts --database "$URL" --json report.json`.
   `--database` defaults to `DATABASE_URL` (`postgres://…`, or `pglite://<dir>` with the server
   stopped). The script opens its own connection: no schema DDL or boot backfill runs. It prints
   counts by stored shape, outcome and report code, then one line per dataset that needs a look;
   `--json` writes the same report. IDs only (datasets, pages, accounts): no titles, emails or rows.
2. **Review** the report, then **apply** with `--apply` (same flags). Each dataset is one
   transaction under its row lock, re-planned inside it: the v3 policy, the `access` column and
   the shares below, a bumped `policy_revision` and a `dataset_policy_audit` row with no actor
   (`system`). Datasets with no report items go first; `--limit <n>` stops after n.
3. **Rerun** to resume after a crash or a limit: v3 rows are skipped, so reruns are idempotent.
   Exit 1 means a dataset was not rewritten (`invalid_policy`, `failed`); fix or ask its owner,
   then rerun. No door stores version 1 or 2 anymore (every policy door refuses them), so one
   complete run leaves nothing to migrate.

What the rewrite decides beyond the plain mapping:

- **Named people** in v2 grants (`from:{user:<id>}`) are **shared** on the dataset: `editor` for
  a write grant (an editor can do everything, a widening the report names as
  `write_named_user`), `viewer` for a read grant. An existing share is never lowered. A person
  without an account or address, or whose address now belongs to another account, is
  `share_unresolved` and keeps no access once the compatibility is removed.
- **`access` column**: v2 grants never read it, v3 honours it as a ceiling on every write, so
  each migrated v2 dataset gets `readwrite` (owners and editors keep writing; v2's own lock was
  its grants, which carry over as rules). None and v1 datasets keep theirs.
- **Page-scoped grants** become `backend_only` entries (`write_page_scoped`, with the pages and
  owners): they work only through a trusted program whose page owner holds owner or editor on
  the dataset. Page-scoped reads widen to viewers and signed-in link holders (`read_page_scoped`).
- **Signed-out v1 writes** are kept for the anonymous role (`anonymous_write`); every
  rule-admitted write is rate-limited per dataset (30 a minute). **Function lists** are dropped
  (`functions_dropped`).
- **Private datasets**: signed-in and signed-out page readers pass a private dataset's ceiling only
  through a page its owner or an editor wrote (and write only through `backend_only` entries), for
  every policy version. Stored v2 grants never let them past it at all, so a private v2 dataset
  loses its signed-in and signed-out select rules.
- Connected PostgreSQL datasets carry no stored policy and are skipped.

The named-user and page-scoped grant compatibility was removed after the production run. The dual
read of stored v1/v2 policies (`lib/dataset-permissions/to-v3.ts`) stays for self-hosted databases
that have not run the rewrite.

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

Anonymous publishing hosts use optional `APP__USER_PAGES_HOST` (off by default). A live user or group
handle maps underscores to hyphens in one host label. Public HTML appears on its public home; unlisted HTML
is available only by ID and carries noindex and no-referrer. Copies retain app canonical URLs. Host
requests are guests even if they carry cookies or bearer tokens; only read operations reach page GraphQL.
The former custom-domain attachment, DNS verification and path override APIs have been removed.
Enabling wildcard DNS and TLS is an operator deployment step; the product never provisions a hostname.

## Skill release folders (installed updater)

Installed skills update themselves from `/skills/artifactbin.zip`, and the updater refuses any archive member
outside the folders it knows (`scripts/toolbox-update-archive.mjs` `member`; the server packager's list is
`lib/skills/package.ts` `skillZip` and `lib/skills/assets.ts`). A release may only ship a new folder once installs
run an updater that accepts it, or their auto-update stops. `resolvers/` (`*.ts`, the copyable resolver library) is
accepted by the updater and shipped by the packager.
