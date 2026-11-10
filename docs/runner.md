# The program runner

`RunnerService` (`services/contracts/src/runner.ts`) compiles and runs a page's backend functions in isolation. A
page calls a function with `fetch('/fn/NAME')`; the app admits the caller, pins the backend version the page was
published with and starts a run (see [page functions](page-functions.md)). Older pages reach the same runner
through their GraphQL resolvers. The authoring contract is the skill's
[functions reference](../services/app/skills/artifactbin/references/functions.md).

`npm run setup -- --yes` followed by `npm run dev` registers the local runner. A host without it sets
`RUNNER__SERVICE_URL` to select the signed HTTP client; app and controller share `CONTRACT__ACTOR_SECRET`. Keep
that connection private.

## Processes

Each run gets its own `node --no-node-snapshot` worker process with a fresh V8 isolate, killed when the run ends
and never reused. The controller keeps a few started ahead of demand (`prestartedWorkers`, default 2), booting no
more at once than its CPU quota, so a run usually skips Node's start. Bundles are cached by source hash and
compiler version. `getRun({waitMs})` (`?wait=` over HTTP) holds the read until the run is terminal, at most
`RESOLVER_LIMITS.runWaitMs`.

With a worker image configured, each run instead gets a new non-root, network-disabled, read-only container with
all capabilities dropped, no-new-privileges, memory, CPU and PID limits; pre-started workers do not apply. Only
the controller has Docker access. Workers talk over bounded stdin/stdout RPC and receive no Docker socket,
credentials or host mounts.

## Service and capability boundary

`RunnerService` offers `start`, `getRun`, `events` and `cancel` to trusted host code only; they are not public
routes. Native backend execution is composed in `services/app/lib/page-operations`. The host pins backend
identity, source, version, owner and page; callbacks through `/api/runner/operations` must carry the matching
trusted attestation. Functions receive validated input, a trusted principal and four capabilities:

- `caps.fetch`, whose `{{NAME}}` secret placeholders the host fills for the one declared host;
- caps.sql, SQL over the page's linked datasets as the caller, which writes only in a POST call or a scheduled
  run and refuses a write in a GET call;
- `caps.db`, a session on a Postgres or MySQL connection the page owner configured (below);
- `caps.query`, GraphQL over the same datasets, kept for older files.

Secret values never reach function code. Programs get no filesystem, shell, Node modules or native network;
supported imports are pinned by `services/runner/src/compiler.ts`. Browser code cannot call the runner as a
command service or load backend source as a module.

## Database connections (`caps.db`)

A backend declares a connection as a secret bound to a database kind, one of `RESOLVER_DATABASE_KINDS`
(`secrets = {WAREHOUSE: 'postgres'}` or `{SHOP: 'mysql'}`; any other word fails the publish, naming the supported
kinds). The owner stores host, port, database, user and password (optional `tls` and `ca`) in the Resolvers panel,
sealed in the same table and cipher as secret values, with the declared kind: a later version that declares the
name as another kind gets `connection_unavailable`. The sandbox keeps no network: bytes travel as tunnel messages
over the worker link.

- `caps.db(name)` reaches the worker (`services/runner/src/worker-database.mjs`), which asks the host for the
  connection (an operation the isolate itself may not call) and runs the driver for its kind, postgres.js or
  mysql2 (versions pinned in `services/runner/package.json`, each loaded on first use), in the worker process,
  outside the isolate. The password stays there; function code gets a handle, rows and errors with the password
  redacted. One connection per handle, so a transaction spans calls; it reconnects after a loss.
- A handle is `{query(sql, params), end()}` and a query answers `{rows, columns, command, count}` for both kinds.
  Postgres: `$1` placeholders, `command` is the server's tag. MySQL: `?` placeholders, sent as a server-side
  prepared statement (never client-side escaping), or as plain text without params; `command` is the statement's
  first word, upper-cased; `count` is the rows returned, or the rows matched for a write; a `CALL` answers its
  first result set. mysql2 runs with LOCAL INFILE and multiple statements off, no generated parser code
  (`disableEval`) and its session time zone set to UTC.
- Types: BIGINT (and, in MySQL's prepared path, any integer expression typed BIGINT) and DECIMAL or NUMERIC are
  strings; DATE, DATETIME and TIMESTAMP are Dates in UTC; binary values are bytes (`Uint8Array`); JSON is parsed;
  other numbers are numbers. MySQL has no boolean: `TINYINT(1)` is 0 or 1, and TIME is a string.
- The controller turns the host's answer into a grant for exactly that host and port
  (`services/runner/src/database-tunnel.ts`). The run's tunnel request names the grant, never an address. The
  controller resolves the name once, refuses it if any answer is not public (`services/utils/src/public-address.ts`:
  loopback, private, CGNAT, link-local and metadata ranges, multicast and reserved space, and the IPv6 equivalents
  and embedded-IPv4 forms), and connects to the exact address it judged. Odd numeric host spellings are refused
  before any lookup, and so are ports below 1024, so the tunnel cannot relay to SMTP, HTTP or SSH.
- TLS runs from the driver to the database (verify-full, the name checked against the certificate, `ca` adding a
  root; a server without TLS is refused, never downgraded), so the controller forwards ciphertext. Plaintext and
  loopback targets need `RUNNER__DATABASE_LOOPBACK=true`, a development and test setting of the controller that no
  page can change; it never admits private or link-local space.
- TLS refusals reach function code by name (`services/runner/src/database-errors.mjs`): `tls_unsupported`,
  `tls_untrusted_certificate` and `tls_name_mismatch`; other failures keep `database_error: CODE`.
- Limits are `RESOLVER_DATABASE_LIMITS`. A worker writing past its window loses the tunnel, and a run's end,
  cancel or worker exit destroys all its sockets before its receipt is saved.

## Standalone controller

`services/runner/src/server.ts` is a controller for a dedicated Linux host with Docker. It refuses to start
without `CONTRACT__ACTOR_SECRET` (32 or more characters), `RUNNER__WORKER_IMAGE` and
`RUNNER__ARTIFACTBIN_BASE_URL`; build the image from `services/runner/Dockerfile` and keep the settings in the
service's protected environment.

Run one controller per data directory (`RUNNER__DATA_DIR`): it owns embedded PGlite storage and is not
horizontally replicated. Its run tables are declared with the other packages' and rendered by
`npm run render:schema`. On restart it removes its unfinished containers, keeps completed results and marks
unfinished runs interrupted rather than replaying side effects.

## Bounds and checks

The generic runner defaults to 30 seconds wall time, 200 ms per synchronous isolate entry, 64 MiB isolate memory,
100 upstream requests and `RESOLVER_LIMITS.outputBytes` (4 MiB) of output; page function calls supply the tighter
`RESOLVER_LIMITS`. `cpuMs` is not a cumulative CPU quota. Cancellation aborts host requests, revokes capabilities
and destroys the worker before the terminal state is saved.

```sh
npm run validate
npm test -- --files services/runner/__tests__/runner-service.test.ts services/app/lib/page-operations/__tests__/backend.test.ts
```

`.github/workflows/runner-design.yml` verifies the worker image, operation authority, real PostgreSQL
transactions, OS restrictions and cleanup.
