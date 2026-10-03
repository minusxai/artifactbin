# Lambda runner

## Start from an OSS installation

`npm run setup -- --yes` followed by `npm run dev` registers the local runner
and scheduler automatically. No Docker or AI provider is needed for a function
that only computes or uses declared data. The local child process uses a V8
isolate; production container restrictions apply only when a worker image is
configured.

The packaged `afbin serve` host does not carry execution dependencies. Add
`RUNNER__SERVICE_URL=http://runner:3050` and `CONTRACT__ACTOR_SECRET` (32+ random
characters) to its private `server.env`, and run the controller below with the
same signing secret and an app URL reachable from the controller. The app must
reach the runner too. Without it the host reports `runner_unavailable`.
Configure the worker image, model and provider key on the controller, rather
than in `server.env`. Keep this trusted service connection inside your deployment.

Publish this complete `hello.jsx` with `afbin add hello.jsx`, then
`afbin push hello.jsx` (source development: `npm run afbin -- …`):

```jsx
---
title: Hello lambda
visibility: private
---
<Helmet>
  <script>{`
    export default async function(input) {
      return {message: 'Hello ' + input.name};
    }
  `}</script>
</Helmet>
<p>A headless greeting function.</p>
```

Save `input.json` containing `{"name":"OSS"}`, then:

```sh
afbin runs start hello.jsx --request hello-1 --input input.json --json
afbin runs status <runId> --json
afbin runs events <runId> --after 0 --json
```

Source development uses `npm run afbin -- runs …`. Poll status until terminal;
the completed output is `{"message":"Hello OSS"}`. `afbin runs cancel <runId>`
requests cancellation; inspect status to observe cleanup. Read `afbin help lambdas`
for declared-data examples, supported imports and event pagination.
Reuse a request ID only for the same invocation to recover its existing run;
a different input with that ID conflicts. A run can end failed, cancelled or
interrupted, so inspect its status and receipt rather than assuming success.
The underlying HTTP API is documented below. Scheduling currently uses HTTP,
with an app session cookie or an account bearer credential in the Authorization
header; session writes also require the app Origin.

Schedule the same published function with
`POST /api/artifacts/<id>/schedules` and
`{"cron":"*/5 * * * *","timezone":"UTC","input":{"name":"scheduled OSS"}}`.
Save its returned `id`, list it with the GET endpoint below, and stop future
occurrences with `DELETE /api/schedules/<id>`. Both runs and schedules pin the
published version; remove/recreate a schedule to adopt a later edit.

Browser-only top-level code (such as `document.querySelector`) cannot run in
the isolate. Keep a headless artifact DOM-free, or guard browser initialization
with `typeof document !== 'undefined'`. Lambdas support fewer imports than the
browser author module; see the headless restrictions below.

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
normal OSS `server.ts` never supplies this option. The shared package supplies
the hook and implementation; deployments must activate it in their composition.
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

The default app resolver extracts the published JSX artifact's Helmet script and
compiles its default-exported function with the existing dataflow store and Solid
bindings. There is no new artifact storage format or separate Lambda parser.
For example, inside the Helmet script:

```ts
import {signal, query, mutation} from 'page';
const [region, setRegion] = signal('$region');
const monthly = query('$monthly');
const rename = mutation('$rename');
export default async function(input) {
  setRegion(input.region);
  const rows = await monthly.ready;
  await rename({from: input.region, to: input.newName});
  return rows;
}
```

Declarations use the same `<Import>`, `<Value default=…>`, `<Query>` and `<Mutation>`
as browser artifacts. `monthly()`, `monthly.loading()` and `monthly.error()` are
Solid accessors; `.ready` waits for the current query. Cold queries start pending.
The compiler allows `page` and pure `solid-js` imports only; DOM, CDN modules,
dynamic imports and `page.proxy` are refused for this headless entry point.
Pi's fixed hosted program continues to use the runner's pinned Pi imports.

The app pins source, edit ID, version and compiled program into each admitted run
and schedule. The runner never accepts that identity from the program: it signs
run/call ID, artifact/version/edit ID and source hash when calling the app. The
app rechecks current artifact access and dataset policies, then evaluates the
pinned declarations. It uses the existing mutation transaction/receipt and
notification machinery; the run/call identity supplies the mutation key. A
source mismatch or missing runner attestation is rejected. Editing a document
after scheduling cannot silently change the scheduled code or its SQL.

`lambdaPrograms(artifactId,userId)` remains an optional trusted host override;
normal app startup installs the real JSX resolver. A document without an
executable default export is refused. Browser scripts run natively on the
document's own origin; Lambda execution remains a separate DOM-free isolate.

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
npm test -- --files services/runner/__tests__/runner-service.test.ts services/runner/__tests__/runner-orchestration.test.ts services/app/__tests__/hosted-runner.test.ts services/app/__tests__/runner-api.test.ts
```

The runner CI repeats these against the production worker image and checks OS
restrictions and cleanup. Models in tests are deterministic HTTP/SSE fixtures;
these are not measurements of paid-provider reliability, pricing or production
throughput. Deployment activation and pool tuning require verification in that deployment.
