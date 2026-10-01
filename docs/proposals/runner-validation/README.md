# Runner design: executable handoff

This is a **validation harness, not a registered product service**. It tests the selected TypeScript/JavaScript isolate design against existing app handlers. No production request, credential or paid model is used. The proposal is https://app.artifactbin.dev/a/zgFGB8.

## Architecture to implement

```
Artifactbin app ───────────────► RunnerService ──► isolated JS module
       │                            ▲                  │
       └─► hosted-agent coordinator ┘                  │ copied RPC
                                                       ▼
                                         host Artifactbin / AI adapters
```

The app authenticates and pins the program version. RunnerService admits and owns runs. The coordinator owns `(userId, artifactId)` conversations, branches and the remote-agent interface. The agent program uses Pi **agent-core**, explicit Artifactbin tools and a custom model stream. Nothing inside the isolate gets a database connection, shell, provider key, app bearer token, signed Actor secret or native network access.

**Self-hosted v1:** a trusted Node 22 RunnerService on a Linux server controls non-root Docker workers. Each worker has a fresh isolated-vm context and is destroyed after its run. Use a small **prestarted spare-worker pool**, replenished after leasing, to remove container/process startup from normal admission latency. Do not reuse a worker for another tenant in v1. Docker is the outer OS sandbox; it is not exposed to programs. The controller can run as a systemd service; workers receive no Docker socket or host mounts. No Cloudflare account or KVM is required.

The harness starts workers on demand to test the same outer restrictions and cleanup. It does not implement the production queue or spare-worker pool. Warm-isolate measurements are not container startup measurements.

## Exact interfaces and ownership

`RunnerService.start({ requestId, userId, artifactId?, program: { source, language }, input, env?, limits }) -> { runId }`.

- Trusted app supplies userId. Production transports it through the existing signed-Actor service boundary; open source calls the same interface locally.
- Runner creates runId, pins program hash, validates bounded JSON input/non-secret env, persists admission, then returns. Unique `(userId, requestId)` plus payload fingerprint deduplicates submission. Different payload on retry is a conflict.
- Public status/events/cancel check owner before reaching the runner. Terminal output and receipt are durable. Events are ordered, replayable and bounded. A restart marks in-flight runs interrupted; it does not replay arbitrary side effects.
- Compile and bundle before lease. Resolve only pinned supported imports; no arbitrary dependency installation. Module signature: `export default async function(input, context) { return json; }`.
- context contains typed Artifactbin operations, AI stream/request operations, separately controlled external fetch, emit and non-secret env. Signal supports cooperative cancellation; killing/revoking the worker remains authoritative.
- Limit input/source, RPC bytes, requests, events, output, wall time and worker memory/CPU. `cpuMs` cannot be advertised as a precise cumulative hard cap using only isolated-vm's evaluation timeout. v1 guarantees wall deadline and OS CPU/memory limits; evaluation timeouts stop synchronous entries. Async runaway is killed by the independent host watchdog.

The harness includes a pinned TS bundler/import allowlist and signed HTTP twin, then takes a **prebundled** source plus flat limits; it is a probe of the runtime boundary, not the final contracts package. Production source admission/import policy and contracts belong in `services/contracts`, transport in `services/utils`, registration in `services/app/lib/platform/services.ts`. Do not copy the prototype's tables into the app schema without designing migrations/ownership first.

### Host transports

1. Artifactbin client sends operation + JSON arguments. The host picks the configured service URL and constructs fresh headers. It attaches the existing signed Actor and, for assigned comment replies, remote-session proof + remote-work requestId + stable Idempotency-Key. Program-supplied identity/auth/cookies are discarded. Existing ACLs make the decision.
2. **Real compatibility finding:** `/api/artifacts` bearer routes require `tokenId` as well as userId. A user-only signed Actor returns 401. Reuse the authenticated caller's resolved account token ID when available. Decision: hosted browser requests use a narrow internal operation adapter that resolves `sessionActor` / `actorForArtifacts` and calls existing `runOperation`/artifact ACLs, retaining remote-proof validation and idempotency. The harness proves this path with a user-only signed Actor and tests cross-owner denial. No token lookup, new bearer secret or new permission system is needed. Retain the bearer-route path for OSS API-token configurations.
3. AI client sends JSON model context **without tool execute functions**. Host chooses OpenAI base URL and bearer key (or omits auth for a configured unauthenticated upstream), forwards the request, parses SSE incrementally, preserves UTF-8/tool IDs/arguments/finish reasons/usage, and converts to Pi events. Production internal gateway additionally receives trusted run/user attribution; provider keys stay on the host. Arbitrary redirects must not carry either service's credentials.
4. Generic external fetch is **not needed for the first hosted-agent path**. Keep it disabled until the DNS/redirect/metadata/private-address policy is implemented and tested. Do not accidentally enable global fetch to make dependencies work.

### Conversations and work delivery

Create conversation/branch and a dispatch-outbox record in one transaction. The fixed program and its version are coordinator-owned. Supply selected base history as JSON input; every parallel request gets a separate branch. Supply bounded outcomes/references for other active/completed branches, rather than splicing incompatible tool chains together. Program checkpoints use ordered events, and the coordinator validates their shape before storing them.

Pi message subscriptions **do not await async subscribers**. Chain checkpoint writes explicitly and await the queue before program return. Returning while host capabilities are still in flight fails with `dangling_capabilities`; program/tool code must await its IO. Persist terminal output/receipt, then finalize the branch idempotently under a conversation-row lock. Preserve full original transcripts. Repeated finalization must not increment revision twice. A crash retains the last durable checkpoint; incomplete model/tool chains need recovery context, not an invented successful tool result.

Use stable remote-agent identity and `remote_work`/existing comment receipts. Add hosted structured dispatch to claim queued work; existing PTY `exchange()` has a serial busy guard and must not be called to dispatch parallel hosted branches. The harness claims work directly only to prove the proposed adapter behavior. Persist reply idempotency keys before retry; a program completing is not proof that its tools succeeded. Non-idempotent external effects are not automatically retried.

Receipt fields: runId, status/reason, timestamps, queue/acquisition/load/execution/cleanup duration, available CPU/memory observations, output/events, network request metadata, model request IDs/usage, pricing version and cost estimate. Unknown usage is null. The harness asserts terminal status/observed calls/token usage and persistence; it has no paid billing calculation. Returned cost/pricing fields are null, not fabricated zero-dollar provider measurements. Host response bytes are capped while reading/parsing, before RPC serialization.

## Reproduce the evidence

From repository root:

```
npm ci
npm ci --prefix docs/proposals/runner-validation --no-audit --no-fund
npm run validate
npm test -- --files services/app/__tests__/runner-design.test.ts
npm run benchmark --prefix docs/proposals/runner-validation
```

Repository policy keeps Docker integration in CI. Workflow `runner-design.yml` repeats the same handler/agent tests inside restricted Linux workers, tests the OS boundary independently of V8, tests PostgreSQL17 concurrency, and asserts no workers leak. Root API/validate CI install this package too. Pinned package-lock is included; scripts require Node22.

`services/app/__tests__/runner-design.test.ts` exercises real handlers with PGLite and signed HTTP forwarding. Deterministic OpenAI fixture uses actual HTTP/SSE, split every three bytes, and actual Pi tool execution. Assertions check database comments/work phase/history, not just promise resolution. It covers reply retry, seeded next-comment history, cross-owner denial, missing tokenId, the working user-only operation adapter, managed redirect rejection, truncated stream, native capability absence/identity spoof, synchronous/post-await loops, output/request limits, cancellation and crash checkpoint recovery.

`postgres-proof.mjs` exercises 16 simultaneous admissions, 20 competing finalizations, rollback and 16 competing schedule claims using true independent PostgreSQL transactions. `scheduler.mjs` proves the occurrence/outbox algorithm, coalescing, overlap serialization and timezone/DST decisions. `os-boundary.mjs` intentionally bypasses V8 to verify the outer worker restrictions, cgroups and OOM kill. `benchmark.mjs` measures fresh contexts with the full shimmed Pi bundle in a warm host. Committed benchmark-results.json is local macOS evidence, not production performance.

Observed red → green: the full path first failed on missing browser shims and attempted cloning of tool functions; a superficially completed agent also hid failed tools. The assertions caught each, and passing requires actual saved replies and completed work. Timeout/owner-denial tests intentionally remain unsuccessful runs. Compiler/type checking and the focused suite were run locally; Linux/PG evidence is recorded from PR CI.

## Risk assessment and implementation boundaries

| Risk | Resolution / concrete handoff |
| --- | --- |
| Pi imports assume web APIs | Pin 0.85.1; include AbortController, encoding, URL and structuredClone shims. Bundle measured at about 845 KB. Full Pi coding-agent CLI is outside scope. |
| User-only Actor fails existing bearer routes | Proven 401; Use the validated user-aware internal operations adapter; existing resolved-token routes remain an alternative. Do not mint/expose a new secret per run. |
| Agent reports success after tools fail | Validate task completion against remote work/outcome; probe rejects errored tool results. Preserve checkpoint and distinguish failed task from completed VM. |
| Async loops escape evaluation timeout | Independent wall watchdog terminates the entire leased worker; cancel aborts host IO and revokes callbacks. Do not promise exact cumulative CPU milliseconds. |
| Docker CLI death leaves running worker | Name/label worker; explicit `docker rm -f` on all terminal paths. On controller restart reap its labelled workers before recovering admissions. Never rely on killing the Docker client alone. |
| Isolate escape / native-engine vulnerability | No credentials/network/host mounts/Docker socket in worker; non-root read-only Docker/cgroups/default seccomp. Dedicated runner host; patched Node/V8/image. Tests prove configured defenses, not absence of all future vulnerabilities. |
| Cross-run callbacks / residual tenant state | v1 retires every leased worker; use prestarted spares rather than reusing worker processes across tenants. Host leases/revokes run capabilities. |
| Parallel transcript corruption / duplicate finalization | Independent branches, ordered checkpoints, row-lock/unique outcome commit; original transcripts retained. Real PostgreSQL concurrency fixture. |
| Provider failure / cancellation / billing | Truncated SSE fails; abort outstanding IO; durable terminal receipt. Real provider latency, pricing and missing usage must not be inferred from fixture tokens. |
| SSRF through external fetch | Disabled for initial hosted-agent launch; explicit additional feature with DNS pinning/redirect/metadata policy and adversarial tests. |
| Production pool/load, UI streaming, adapter migrations | Product implementation tasks, not demonstrated by this harness. Preserve tests; measure queue and pool acquisition on deployment host. No production latency or security certification claimed. |

API and cron need no separate VM: normal app APIs stay normal services; Lambda invocation authenticates, pins source and admits a run. Schedule occurrence `(scheduleId, scheduledAtUTC)` and dispatch outbox are committed together; occurrence is runner requestId. Define timezone/DST, missed occurrence coalescing and serialize same-schedule overlap. Automatic retries are submission retries, not replay of non-idempotent programs.

The implementing agent should first land the narrow contract and validated user-aware Artifactbin adapter, then durable runner admission/receipts, worker launcher and fixed hosted-agent coordinator. Reuse the behavioral checks as acceptance tests. Generic user programs/external network, warm-pool capacity tuning and provider billing follow with their explicit tests. This PR adds validation only; it should not be treated as a deployable runner implementation.
