# Resolver call latency

What one trivial resolver field (`ping: () => "pong"`) costs per call, by stage. The benchmark is
[`scripts/resolver-latency.ts`](../scripts/resolver-latency.ts). It is never run by CI and nothing asserts a
budget. It drives the real code unchanged: `createBackendInvoker` against `createRunner`, the runner behind
`runnerHttp` and the signed `runnerClient`, and page GraphQL on the dev app.

```sh
npm run dev                                                    # only for --modes app
node --import tsx scripts/resolver-latency.ts                  # micro,runner,http,app; 50 runs, 5 warm-ups, 3 × 8 concurrent
node --import tsx scripts/resolver-latency.ts --modes micro,docker --image afbin-worker   # container per run
node --import tsx scripts/resolver-latency.ts --modes runner,http --prestart 0           # without pre-started workers
# Production CPU limit: a Linux checkout with Linux node_modules mounted at /work, then
docker run --rm --cpus 1 --memory 2g -v <checkout>:/work -w /work node:22.23.4-bookworm-slim \
  node --import tsx scripts/resolver-latency.ts --modes micro,runner,http
```

Each runner mode runs in a fresh child process, so its first call is a real cold start (no esbuild service
and no JIT yet). Stages come from the run receipt and the invoker's `getRun` calls:

| Stage | Covers |
|---|---|
| admit | `start()`: the request-key lookups, `bundleSource` (esbuild) and the insert. Over HTTP, also the signed request |
| queue | `admittedAt` to `startedAt`: `pump()`, the `running` update and, with Docker, `docker create` |
| execute | `startedAt` to `finishedAt`: claim a pre-started worker (or spawn one), `ready`, isolate, evaluate the bundle, call, then SIGKILL and exit |
| observe | `finishedAt` to the first completed `getRun`: the persist update plus the completion wait's reply (before PR 9: the 10 ms poll interval) |

Receipt times have 1 ms resolution. The `micro` mode times the parts of execute separately.

## After PR 9, 2026-11-03

PR 9 implements fixes 1, 3 and 4 below: pre-started workers (default 2, background boots bounded by the
CPU quota, each process still runs exactly one program), a bundle cache keyed by source hash and compiler
version, and `getRun({waitMs})` in place of polling. Before is `aea8fd478` (main), after is `1e207413d`, both
measured in the same session on the same machines as the section below. The host was noisier than in that
earlier run, so the same-session before differs from it; compare before with after, not with that section.
Linux rows are two or three runs per configuration, shown as a range. Times are in ms.

### Totals, warm p50 / p95 and 8-concurrent p50 / p95

| Mode | Before warm | After warm | Before concurrent | After concurrent |
|---|---|---|---|---|
| Mac, runner in process | 71–72 / 73–85 | 5.9–8.7 / 55–74 | 79–80 / 89–91 | 67–99 / 70–110 |
| Mac, http (production shape) | 76–77 / 79–82 | 16–25 / 36–52 | 85–94 / 98–107 | 69 / 74–75 |
| Mac, docker (container per run) | 229 / 243 | 209 / 222 | 453 / 645 | 429 / 626 |
| Mac, app page GraphQL (`RUNNER__MAX_CONCURRENT=4`) | 65 / 69¹ | 16 / 29 | 106 / 151¹ | 86 / 131 |
| Linux 1 vCPU, runner | 72–73 / 87–88 | 62–76 / 85–134 | 514–530 / 672–682 | 416–508 / 581–779 |
| Linux 1 vCPU, http | 78–79 / 103–110 | 62–68 / 83–95 | 497–567 / 619–665 | 456–493 / 579–688 |
| Linux 2 vCPU, runner | 64–72 / 75–84 | 32–34 / 54–55 | 221–229 / 280–285 | 200–223 / 274–306 |
| Linux 2 vCPU, http | 68–71 / 80–86 | 39–47 / 64–87 | 213–252 / 291–301 | 224–307 / 304–405 |

¹ App before is the section below (#996); the app mode was not re-run on main.

Linux is `node:22.23.4-bookworm-slim` with `--cpus 1` or `--cpus 2` and `--memory 2g` in the colima VM.

### What changed, by stage (http mode, warm p50 unless noted)

| Stage | Before | After |
|---|---|---|
| `bundleSource`, warm (micro) | 0.9 | 0.0 (cache hit) |
| admit, Mac | 4 | 2–3 |
| observe, Mac | 9 | 1 |
| `getRun` calls per field | 6–7 | 1 |
| observe, 1 vCPU, concurrent p95 | 82–99 | 4–10 |
| execute, Mac serial | 64–65 | 14–22 |
| execute, 2 vCPU serial | 59–61 | 30–39 |
| execute, 1 vCPU serial | 64–66 | 54–61 |

### Pool size, Mac (`--prestart`), warm p50 / p95, concurrent p50 / p95

| Pre-started | runner | http |
|---|---|---|
| 0 (cache and wait only) | 66 / 81, 69 / 73 | 65 / 68, 73 / 81 |
| 2 (default) | 5.9–8.7 / 55–74, 67–99 / 70–110 | 16–25 / 36–52, 69 / 74–75 |
| 8 | 6.5 / 12, 32 / 52 | 7.3 / 9.4, 33 / 50 |

The 8-worker row is an 18-core result; on one or two vCPUs the pool only refills while fewer workers than
CPUs are booting, so a larger pool does not add boots under load.

### Reading

- **Serial calls** gain where there is a spare CPU or idle time: the run takes a worker that has already
  started. 2 vCPU warm p50 roughly halves (64–72 → 32–47); the Mac drops from about 72 to 6–25.
- **One vCPU** is unchanged within noise. A worker boot costs the same CPU whether it runs before or
  during the call, and back-to-back calls leave no idle time to boot spares in. A first version refilled
  right after each take; on one vCPU the spare booted beside the run's own still-starting worker and made
  serial calls slower (execute 81 p50). Refill now starts only while fewer workers than CPUs are booting.
- **Eight concurrent calls on one vCPU still miss the 400 ms p95** (579–779). Each call still boots a
  Node process, and eight boots share one CPU. With two vCPUs the p95 is 274–405: under the 400 ms target
  in three of four runs. That is fix 2, the controller's CPU limit (artifactbin-server).
- **Polling is gone**: one `getRun` per field instead of 6 to 13, and observe drops from up to 99 ms (1 vCPU
  concurrent p95) to under 10. In production each avoided request also saved 2 dispatcher reads.
- **The bundle cache** removes `bundleSource` from every call after the first per source and process
  (about 1 ms warm). Bundling also moved out of the serialized admission section.

In production the completion wait needs the server's runner HTTP layer to forward `?wait=`
(artifactbin-server PR 254) and a toolkit bump that includes this change. Until both land, the app sees
an immediate non-terminal answer and falls back to polling every 10 ms.

## Before PR 9 (#996), 2026-11-03, `1b7e73893`

Apple M5 Pro (18 cores), macOS, Node 22.22.3. Docker: colima, 4 vCPU Linux VM. Warm means 50 serial
calls after 5 warm-ups. Concurrent means 3 batches of 8 calls. Times are in ms.

### Totals

| Mode | Cold | Warm p50 | Warm p95 | Concurrent p50 | Concurrent p95 |
|---|---|---|---|---|---|
| runner, in process (local composition) | 72 | 59 | 61 | 63 | 73 |
| http, runner over signed loopback HTTP (production shape) | 75 | 51 | 62 | 75 | 86 |
| docker, container per run (not used by production) | 171 | 168 | 181 | 341 | 502 |
| app, page GraphQL `{ bench { ping } }` | 75¹ | 65 | 69 | 106² | 151² |
| app, resolver-free baseline `{ __typename }` | | 5.3 | 6.5 | | |

¹ The first call after publishing. The dev server is not cold: publishing already compiled the resolver in
a worker. ² The dev `.env` sets `RUNNER__MAX_CONCURRENT=4`, so 8 concurrent calls queue. Production uses 8.

### Warm stages, http mode

| Stage | p50 | p95 |
|---|---|---|
| admit | 3 | 4 |
| queue | 0 | 1 |
| execute | 46 | 48 |
| observe | 3 | 12 |
| `getRun` calls per field | 5 | 6 |

The runner mode has the same shape: admit 2, execute 46, observe 10 (p50).

### Inside execute (micro, warm p50 / p95)

| Part | p50 | p95 |
|---|---|---|
| `bundleSource` (cold: 7.6, the esbuild service starting) | 0.8 | 1.6 |
| spawn to `ready`, `node --no-node-snapshot` (shipped) | 43 | 47 |
| spawn to `ready`, `node` with the startup snapshot | 23 | 24 |
| `run` to `result`: new isolate, evaluate bundle, call | 1.4 | 1.7 |
| isolate wall time the worker reports | 0.4 | 0.5 |
| SIGKILL to exit | 1.3 | 1.6 |
| `docker create` | 27 | 29 |
| `docker start -a` to `ready` | 76 | 82 |
| `docker rm -f` | 18 | 20 |

Starting a Node process accounts for about 90% of a warm call. The isolate, the call and the bundle together
take about 2 ms. Polling adds 0 to 12 ms. Over loopback, HTTP adds about 1 ms per request.

### One vCPU, Linux (production controller limits)

The same `micro,runner,http` run inside `node:22.23.4-bookworm-slim` with `--cpus 1`, the controller's CPU
limit (colima arm64 VM on the same Mac, not linux/amd64). At the controller's `--memory 768m` the harness
was killed with exit 137 (two Node processes load the app library graph). The cause was not investigated,
and the run used `--memory 2g`.

| Mode | Cold | Warm p50 | Warm p95 | Concurrent p50 | Concurrent p95 |
|---|---|---|---|---|---|
| runner, in process | 92 | 50 | 78 | 381 | 487 |
| http, production shape | 109 | 55 | 72 | 361 | 468 |

Concurrent stages, http mode (p50 / p95): admit 105 / 349, execute 196 / 286, observe 13 / 91. Eight
Node workers start at once on one CPU. Admission is serialized, and each admission runs `bundleSource`, so
admissions wait on each other and on the CPU. Spawn to `ready` alone is 39 / 47 when warm and serial
(16 / 23 with the startup snapshot). The isolate and the call stay at about 2 ms.

**Against the plan's decision rule** (warm p50 ≤ 150 ms and p95 ≤ 400 ms in the production shape): serial
calls pass (55 / 72). Eight concurrent calls on one vCPU fail the p95 (468 ms).

## Production, from code (no production access)

The deployed controller is `services/runner/main.ts` in artifactbin-server. It calls
`createRunner({db,capabilities,maxConcurrent,maxQueued})` **without `dockerImage`**. A resolver run is
therefore a `node --no-node-snapshot runner-worker.mjs` child of the controller container (1 vCPU, 768 MiB,
linux/amd64, `RUNNER__MAX_CONCURRENT=8`), not a container. `RUNNER__WORKER_IMAGE` goes to Modal for native
programs only. The plan's estimate of 300 to 1000 ms for a container start does not apply to resolvers.

Per field call in production:

1. App to runner: `runnerClient` over `overHttp`, one signed HTTP request (compose network).
2. Dispatcher `start`: an extra PGlite transaction on `execution_request_modes`, then the isolate runner's
   `start` (2 lookups, `bundleSource`, insert).
3. Spawn a Node worker on the shared vCPU. This is the dominant cost.
4. Isolate, evaluate and call: about 2 ms.
5. Capability calls (`caps.fetch`, store) go runner to app over HTTP, about 5 to 20 ms each. A trivial field
   makes none.
6. SIGKILL, persist, then the app polls every 10 ms. Each poll is a signed HTTP request. The dispatcher's
   `owned()` asks the Modal service first (a `not_found` lookup) and then the isolate runner, so each poll
   costs 2 PGlite reads.

Estimate: on a cloud vCPU, a warm trivial field takes about **55 to 150 ms**. This is the 1-vCPU Linux
measurement plus the dispatcher's extra reads, compose-network hops and a slower amd64 vCPU than the
M5's. Eight concurrent fields take **about 350 to 600 ms at p95**. That is above the rule, and the cause
is CPU: each call starts a Node process on the controller's single vCPU. To confirm on the deployment,
use the eval harness's page GraphQL traces.

## Cheapest fixes, ranked by measured share

PR 9 implemented 1, 3 and 4 (results above). 2 is artifactbin-server PR 254. Re-measure with this script
after each fix.

1. **Pre-spawn workers.** Keep a few processes that have started and sent `ready` but have not run
   anything. Each still serves exactly one run and is then killed, so the Node start (about 40 ms, about
   75% of a warm call) moves off the critical path. Isolation is unchanged: one process per run, never
   reused. Spare processes cost memory while they wait. A burst larger than the pool still spawns on
   demand.
2. **Give the controller more than one vCPU** (artifactbin-server compose, `cpus: 1`). This is a
   deployment change, not code. The concurrent failure is CPU contention: the same 8 concurrent calls
   take 75 / 86 ms on 4 or more cores and 361 / 468 ms on 1. Alternatively, keep `RUNNER__MAX_CONCURRENT`
   in line with the cores.
3. **Cache the bundle by source hash.** This saves about 1 ms per serial call and 8 to 30 ms on the first
   call per process. It also shortens the serialized admission, which is 105 / 349 ms under one-vCPU
   concurrency. `compiled` is immutable, so the cache key is safe.
4. **Replace polling with a completion wait** (`getRun?wait=` or a long poll). This saves 0 to 12 ms per
   call (91 ms at concurrent p95) and 4 to 6 signed requests per field. In production each request also
   costs 2 dispatcher reads.
5. **Only if 1 to 4 are not enough: one process per resolver version, with a fresh isolate per call**
   (plan step 4). This removes Node startup from every call. A context is never shared between calls.
   Container pooling (plan step 3) does not apply, because production does not start containers for
   resolvers.
6. **Not recommended: dropping `--no-node-snapshot`.** It measured about 20 ms faster to `ready`, but
   isolated-vm requires the flag on Node 20 and later (its README). A run that works without it does not
   prove it is safe.

## Dataset GraphQL

What a generated-API read costs through the dataset's own endpoint (`POST /api/artifacts/<id>/graphql`), for the
owner and for a viewer whose select rule filters half the rows and hides a column. The benchmark is
[`scripts/dataset-graphql-latency.ts`](../scripts/dataset-graphql-latency.ts): the real route handler in process,
an in-memory PGLite, and the server's SQL worker pool (`--sql thread` runs the engine on the calling thread, as
the test suite does). Statements are one warm request's (lib/platform `measureQueries`); times are 30 sequential
requests after 3 warm-ups; RSS is the process peak, sampled every 10 ms. The statement budgets are pinned by
`services/app/lib/dataset-graphql/__tests__/dataset-graphql-budget.test.ts`.

The tables below are historical: their `2 roots (list + count)` and `count + sum + nodes` rows used the removed
`<root>_aggregate` root. Counts and totals are now a page's read-only `_sql`; `--page-sql` measures it under
concurrent readers and live refetches (9,900 rows, 20 readers: warm 17 CPU ms/request against 18 for a 100-row
list; a write then every reader refetching, 31 against 35).

```sh
node --import tsx scripts/dataset-graphql-latency.ts                 # 20,000 rows, worker pool
node --import tsx scripts/dataset-graphql-latency.ts --rows 2000 --sql thread --json out.json
```

### Before one authorization per request, 2026-11-04, `54e81686b`

Apple M5 Pro, Node 22.22.3, 20,000 rows. Times in ms.

| caller | query | statements | p50 | p95 | peak RSS MiB |
|---|---|---|---|---|---|
| owner | list (100 rows) | 14 | 124 | 132 | 1414 |
| owner | 2 roots (list + count) | 17 | 127 | 131 | 1603 |
| owner | count + sum + nodes | 20 | 159 | 169 | 1620 |
| viewer | list (100 rows) | 46 | 87 | 104 | 1622 |
| viewer | 2 roots (list + count) | 61 | 98 | 112 | 1614 |
| viewer | count + sum + nodes | 76 | 126 | 133 | 1447 |

Each engine statement re-reads the dataset row three times (and, for a viewer, the four role queries with
each), so cost grows per statement rather than per request.

### One authorization per request, 2026-11-04

Before is `e216958ff` (main: the engine threads keep each prepared database and are sent keys first, #1076 and
#1078), after is this change; same session, same machine. The request authorizes the dataset once (its row, and
for a viewer the role facts once each through a per-request memo), every engine statement runs under that
authorization, and one fresh final fence (the head and the facts asked again) is checked before the reply
leaves. A page's schema GET and every mutation load keep their checks after loading and around each statement.
Times in ms.

| caller | query | statements before → after | p50 before → after | p95 before → after |
|---|---|---|---|---|
| owner | list (100 rows) | 14 → 8 | 37 → 38 | 43 → 40 |
| owner | 2 roots (list + count) | 17 → 8 | 39 → 34 | 43 → 35 |
| owner | count + sum + nodes | 20 → 8 | 35 → 33 | 36 → 34 |
| viewer | list (100 rows) | 46 → 14 | 37 → 30 | 40 → 47 |
| viewer | 2 roots (list + count) | 61 → 14 | 37 → 29 | 39 → 31 |
| viewer | count + sum + nodes | 76 → 14 | 39 → 34 | 43 → 38 |

On in-process PGLite a statement costs well under a millisecond, so these times understate the saving;
production Postgres round trips weigh more per statement. With the engine's prepared databases most of what
remains is the snapshot: it parses each stored object to count its rows and derives every row's ID. Through a
page the same reads cost 14 / 32 statements (owner / viewer), down from 20 / 64; the rest of a page request
reads the page itself.

### Row counts remembered by object key, 2026-11-04

Before is `58bf498d5` (main, one authorization per request), after is this change; same session, same
machine. Each request numbered every table's rows by parsing its stored object for the count; the count is now
remembered by object key (lib/datasets `storedRowCount`), which is safe because keys are content hashes. A warm
request loads no stored object at all. Statements are unchanged (8 owner, 14 viewer). Times in ms.

| caller | query | p50 before → after | p95 before → after |
|---|---|---|---|
| owner | list (100 rows) | 37 → 30 | 40 → 35 |
| owner | 2 roots (list + count) | 36 → 30 | 39 → 30 |
| owner | count + sum + nodes | 32 → 26 | 35 → 31 |
| viewer | list (100 rows) | 32 → 24 | 33 → 25 |
| viewer | 2 roots (list + count) | 31 → 24 | 32 → 28 |
| viewer | count + sum + nodes | 29 → 24 | 32 → 26 |

What remains per request is mostly deriving every row's ID (one digest per row when no IDs are stored).
