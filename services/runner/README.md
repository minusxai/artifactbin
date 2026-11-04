# Isolated program runner

The app uses `RunnerService` to compile and invoke native HTML backends. Backend
source exports GraphQL type definitions and resolvers; publication binds an
immutable version to the page. Readers call the page GraphQL endpoint, which
checks current page access and dataset authority before executing a resolver.
See [the resolver authoring contract](../app/skills/artifactbin/references/resolvers.md).

`npm run setup -- --yes` followed by `npm run dev` registers the local runner.
A local child process uses a V8 isolate. Each run gets its own `node --no-node-snapshot`
worker process, killed when the run ends and never reused. The controller keeps a few
(`prestartedWorkers`, default 2) started ahead of demand, booting no more at once than its
CPU quota, so a run usually skips Node's start. Bundles are cached by source hash and
compiler version. `getRun({waitMs})` (`?wait=` over HTTP) holds the read until the run is
terminal, at most `RESOLVER_LIMITS.runWaitMs`. Production container restrictions apply
when a worker image is configured. A remote app selects the signed-Actor HTTP
client through `RUNNER__SERVICE_URL`; app and controller share
`CONTRACT__ACTOR_SECRET`. Keep this trusted service connection private.

## Service and capability boundary

`RunnerService` provides `start`, `getRun`, `events` and `cancel` for trusted host
code. These service methods are not public artifact run routes. Command-program
publication, JSX/Helmet handlers, the retired CLI run commands and public artifact
run/schedule endpoints are no longer supported.

Native backend execution is composed in `services/app/lib/page-operations`.
The host pins backend identity, source, version, owner and page; callbacks through
`/api/runner/operations` must carry the matching trusted attestation. Resolvers
receive validated arguments, a trusted principal and exactly four capabilities:
`caps.fetch`, whose `{{NAME}}` secret placeholders the host fills for the one
declared host, `caps.query` over the page's datasets as the caller,
`caps.sql`, read-only SQL over the same datasets as the caller, and
`caps.db`, a session on a Postgres or MySQL connection the page owner configured
(below). Secret values never reach resolver code. A database connection's
password goes to the worker process, where the driver uses it, and never into the
isolate: resolver code gets a handle, rows and redacted errors. Resolver code can
still run any SQL the connection's user may, so owners should configure a
read-only database user; read-only enforcement is that user's, not Artifactbin's. Source files must
contain no credentials. Browser code cannot call the internal runner as an arbitrary command
service or obtain backend source as a browser module.

Programs receive no filesystem, shell, Node modules or native network access.
Supported imports are pinned by `src/compiler.ts`.

## Database connections (`caps.db`)

A backend declares a connection as a secret bound to a database kind, one of
`RESOLVER_DATABASE_KINDS` in `services/contracts` (`secrets = {WAREHOUSE: 'postgres'}`
or `{SHOP: 'mysql'}`; any other word fails the publish, naming the supported kinds).
The owner stores host, port, database, user and password (optional `tls` and `ca`)
in the Resolvers panel, sealed in the same table and cipher as secret values, with
the declared kind: a later version that declares the name as another kind gets
`connection_unavailable`. The sandbox keeps no network: bytes travel as tunnel
messages over the worker link.

- `caps.db(name)` reaches the worker (`src/worker-database.mjs`), which asks the
  host for the connection (`artifactbin.pageBackend.db`, an operation the
  isolate itself may not call) and runs the pinned driver for its kind,
  postgres.js 3.4.9 or mysql2 3.24.6 (each loaded on first use), in the worker
  process: inside the network-less container in production, outside the V8
  isolate. The password stays there and never reaches resolver code, which gets a
  handle, rows and errors with the password redacted; the driver parses the
  server's bytes in the worker process. One connection per handle, so a
  transaction spans calls; it reconnects after a loss.
- A handle is `{query(sql, params), end()}` and a query answers
  `{rows, columns, command, count}` for both kinds. Postgres: `$1` placeholders,
  `command` is the server's tag. MySQL: `?` placeholders, sent as a server-side
  prepared statement (`execute`; never client-side escaping), or as plain text
  without params; `command` is the statement's first word, upper-cased; `count`
  is the rows returned, or the rows matched (`affectedRows`, with `FOUND_ROWS`)
  for a write; a `CALL` answers its first result set. mysql2 runs with `LOCAL
  INFILE` and multiple statements off (client flags cleared, no infile stream, so a
  server's file request gets an empty answer), no generated parser code
  (`disableEval`), and its session `time_zone` set to UTC.
- Types: BIGINT (and, in MySQL's prepared path, any integer expression typed
  BIGINT such as `true`) and DECIMAL/NUMERIC are strings, as postgres.js answers
  int8 and numeric; DATE, DATETIME and TIMESTAMP are Dates in UTC; binary values
  (BLOB, BINARY, BIT, bytea) are bytes (`Uint8Array`); JSON is parsed; other
  numbers are numbers. MySQL has no boolean: `TINYINT(1)` is `0`/`1`; TIME is a
  string.
- The controller turns the host's answer into a grant for exactly that host and
  port (`src/database-tunnel.ts`). The run's `tunnel_open` names the grant, never
  an address. The controller resolves the name once, refuses it if any answer is
  not public (`@artifactbin/utils/public-address`: loopback, RFC1918, CGNAT,
  link-local and metadata, `0/8`, multicast and reserved, IPv6 loopback, ULA,
  link-local, and mapped, compatible, NAT64, 6to4 and Teredo forms), and connects
  to the exact address it judged. Odd numeric host spellings are refused before
  any lookup. Ports below 1024 are refused: database servers listen on
  unprivileged ports, and the tunnel must not relay to SMTP, HTTP or SSH.
- TLS runs from the driver to the database (`verify-full`, the server name or IP
  checked against the certificate; `ca` adds a root; mysql2 with `verifyIdentity`,
  and a server without TLS is refused, never downgraded), so the controller forwards
  ciphertext. Plaintext (`tls: 'disable'`) and loopback targets need
  `RUNNER__DATABASE_LOOPBACK=true`, a development and test setting of the
  controller that no page can change; it never admits private or link-local space.
- Limits (`RESOLVER_DATABASE_LIMITS`): 4 tunnels per run, 16 per owner and 8 per
  page open at once (per controller), 5 s to resolve and connect, 10 s idle, 16 MiB
  from and 4 MiB to the database per run, and a 256 KiB credit window per tunnel and
  direction, so a slow reader pauses the database socket instead of buffering. A
  worker writing past its window loses the tunnel. A run's end, cancel or worker
  exit destroys all its sockets before its receipt is saved.

Tunnel state is per run and keyed by the run's own tunnel ids, so a later warm
worker can keep connections between runs without a protocol change.

## Production controller

On a dedicated Linux host with Docker:

```sh
docker build -f services/runner/Dockerfile -t afbin-worker .
# Configure these in the service's protected environment, not a program:
# CONTRACT__ACTOR_SECRET=<32+ random characters, shared with trusted app>
# RUNNER__WORKER_IMAGE=afbin-worker
# RUNNER__ARTIFACTBIN_BASE_URL=https://internal-artifactbin-app
# RUNNER__DATA_DIR=/var/lib/artifactbin-runner
node --import tsx services/runner/src/server.ts
```

The controller requires the Docker image and signing secret. Each run gets a new
non-root, network-disabled, read-only container with all capabilities dropped,
no-new-privileges, memory/CPU/PID limits, and a fresh V8 isolate. Only the controller
has Docker access. Workers communicate over bounded stdin/stdout RPC; they receive
no Docker socket, credentials or host mounts. This initial implementation
starts workers on demand; it does not claim a warm-pool latency SLA.

Run **one controller per persistent database/data directory**. The standalone
controller owns embedded PGlite storage; it is not a horizontally replicated
controller. The app/coordinator can use the existing PostgreSQL adapter. Run table
declarations are shared with the OSS co-host and emitted by `render:schema`.
On restart the controller removes its unfinished containers, preserves completed
results, and marks unfinished runs interrupted rather than replaying side effects.

## Bounds and verification

The generic runner defaults to 30 seconds wall time, 200ms per synchronous
isolate entry, 64MiB isolate memory, 100 upstream requests and 1MiB output.
Native backend calls supply tighter limits in `page-operations/backend.ts`.
`cpuMs` is not a cumulative CPU quota. Cancellation aborts host requests,
revokes capabilities and destroys the worker before terminal state is saved.

Fast checks from the repository root:

```sh
npm run validate
npm test -- --files services/runner/__tests__/runner-service.test.ts services/app/lib/page-operations/__tests__/backend.test.ts
```

Runner CI verifies the product worker image, operation authority, real PostgreSQL
transactions, OS restrictions and cleanup.
