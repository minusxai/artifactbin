# Lambda runner

The shared interface is `RunnerService`: `start`, `getRun`, `events`, `cancel`.
The OSS app registers a local implementation; `RUNNER__SERVICE_URL` selects the
signed-Actor HTTP client. Only authenticated app code supplies `userId`. Programs
receive JSON input, non-secret `context.env`, `context.emit`, and host-mediated
Artifactbin and AI capabilities. They do not receive credentials, native fetch,
Node modules, a filesystem, a shell, or a database connection.

```ts
export default async function(input, context) {
  const artifact = await context.artifactbin.call('get_artifact', {id: input.id});
  await context.emit({type: 'progress', message: 'Artifact read'});
  return artifact;
}
```

The supported imports are pinned in `src/compiler.ts`. Pi agent-core is usable
through a custom model transport; the fixed hosted program is `src/agent.ts.txt`.
The host chooses AI destinations and credentials, rejects managed redirects,
bounds responses, and records request metadata and provider usage. Blank AI keys
are supported. Cost and unavailable measurements are **null**, not fabricated
zeroes. Generic external network access is deliberately not enabled in this release.

## OSS and hosted deployments

| Shared/OSS | Hosted opt-in |
| --- | --- |
| Runner interface, local and HTTP execution, Pi library support, receipts, scheduler | Managed default agent, session/comment integration and conversation coordination |
| Operator-selected OpenAI endpoint/key | Production selects its internal endpoint/key |
| Existing artifact operation ACLs | Same ACLs with a fresh signed user identity attached by the host |

`createAppHost({hostedAgent: {secret, model}})` installs the managed agent. The
normal OSS `server.ts` never supplies this option. This PR supplies the hook and
implementation; it does not change/deploy the private production composition.
A deployment must configure its app's runner URL and the matching Actor signing
secret. Nothing is enabled merely by a user's program asking for it.

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

## Artifact API and scheduling

- `POST /api/artifacts/:id/runs`: `{requestId, input}` → `202 {runId}`.
- `GET /api/runs/:id`: owner-scoped state/output/receipt.
- `GET /api/runs/:id/events?after=0&limit=100`: ordered JSON pages, not SSE.
- `POST /api/runs/:id/cancel`: accepts cancellation; state reports completion.
- `POST /api/artifacts/:id/schedules`: `{cron, timezone, input}`.
- `GET /api/artifacts/:id/schedules`; `DELETE /api/schedules/:id`.

The app selects the program and published version. A request cannot substitute
source, user identity or a version. The authoring branch plugs in
`lambdaPrograms(artifactId, userId) -> {version, program}` on `createAppHost`.
**Until that real adapter is installed, artifact invocation/scheduling returns
`lambda_authoring_unavailable`; test fixtures are never deployed as a compiler.**
This is the agreed section 2a integration gate, not an implementation of its syntax.

A schedule occurrence is persisted before submission and supplies the runner's
idempotency key. Submission retries deduplicate; executions are not retried.
Missed ticks coalesce, the same schedule cannot overlap, and permission is checked
again before dispatch. Removing a schedule stops future occurrences; cancelling an
already admitted run is a separate operation. Cron uses the specified IANA timezone.

## Hosted conversations

The coordinator owns conversation branches by `(userId, artifactId)`, with `chat`
for the user's general session. A comment's work ID deduplicates dispatch. Each
branch starts a fixed Pi program with bounded prior history and other branch
references/outcomes. Ordered checkpoint events survive a run failure. Finalization
locks the conversation and branch and increments revision once. Original branch
transcripts remain intact; incompatible parallel tool chains are never interleaved.
The history tool can read branches from the current conversation only.

The default agent uses the existing session list, terminal view/input and managed
comment receipts. Its reply proof stays on the host. The complete comment path is
covered by `hosted-runner.test.ts`, including actual annotation persistence.

## Bounds and verification

Default limits: 30s wall time, 200ms per synchronous isolate entry, 64MiB isolate
memory, 100 upstream requests, 1MiB returned output. Host RPC/events have separate
bounds. `cpuMs` is not a cumulative CPU quota. Cancellation aborts host requests,
revokes capabilities and destroys the worker before saving terminal state.

Fast checks:

```sh
npm run validate
npm test -- --files services/app/__tests__/runner-service.test.ts services/app/__tests__/runner-orchestration.test.ts services/app/__tests__/hosted-runner.test.ts services/app/__tests__/runner-api.test.ts
```

The runner CI repeats these against the production worker image and checks OS
restrictions and cleanup. Models in tests are deterministic HTTP/SSE fixtures;
these are not measurements of paid-provider reliability, pricing or production
throughput. Deployment activation, pool tuning and the separate 2a compiler are
outside this PR's activation scope.
