# Isolated program runner

The app uses `RunnerService` to compile and invoke native HTML backends. Backend
source exports GraphQL type definitions and resolvers; publication binds an
immutable version to the page. Readers call the page GraphQL endpoint, which
checks current page access and dataset authority before executing a resolver.
See [the resolver authoring contract](../app/skills/artifactbin/references/resolvers.md).

`npm run setup -- --yes` followed by `npm run dev` registers the local runner.
A local child process uses a V8 isolate. Production container restrictions apply
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
receive validated arguments, a trusted principal and constrained capabilities:
store reads, compare-and-swap store writes in mutations, bounded public fetches
and explicitly declared owner secret bindings. Source files must contain no
credentials. Browser code cannot call the internal runner as an arbitrary command
service or obtain backend source as a browser module.

Programs receive no filesystem, shell, Node modules, native network access or
database connection. Supported imports are pinned by `src/compiler.ts`.
Host-mediated AI uses configured destinations and credentials, rejects managed
redirects and bounds responses. Provider credentials stay on the host. Missing
cost and usage measurements are null, not fabricated zeroes.

## Production controller

On a dedicated Linux host with Docker:

```sh
docker build -f services/runner/Dockerfile -t afbin-worker .
# Configure these in the service's protected environment, not a program:
# CONTRACT__ACTOR_SECRET=<32+ random characters, shared with trusted app>
# RUNNER__WORKER_IMAGE=afbin-worker
# RUNNER__ARTIFACTBIN_BASE_URL=https://internal-artifactbin-app
# RUNNER__DATA_DIR=/var/lib/artifactbin-runner
# RUNNER__OPENAI_BASE_URL=https://internal-ai/v1
# RUNNER__OPENAI_API_KEY=<optional host-only key>
# RUNNER__MODEL=<configured model>
node --import tsx services/runner/src/server.ts
```

The controller requires the Docker image and signing secret. Each run gets a new
non-root, network-disabled, read-only container with all capabilities dropped,
no-new-privileges, memory/CPU/PID limits, and a fresh V8 isolate. Only the controller
has Docker access. Workers communicate over bounded stdin/stdout RPC; they receive
no Docker socket, provider credentials or host mounts. This initial implementation
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
The scheduler remains a service capability with persisted occurrences and
idempotent admission; there is no public artifact scheduling API.

Fast checks from the repository root:

```sh
npm run validate
npm test -- --files services/runner/__tests__/runner-service.test.ts services/runner/__tests__/runner-orchestration.test.ts services/app/lib/page-operations/__tests__/backend.test.ts
```

Runner CI verifies the product worker image, operation authority, real PostgreSQL
transactions, OS restrictions and cleanup. Deterministic HTTP/SSE model fixtures
prove transport behavior, not paid-provider reliability or throughput.
