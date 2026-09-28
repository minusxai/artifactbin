# Behavioral seeds and contract checkpoints

Only the accepted standalone query design is active. Templates use .test.ts.txt so planning CI is not deliberately red. Copy to the destination before implementation; observe semantic red and retain the completed tests with the implementation.

| Seed | Destination | Owner | Evidence |
| --- | --- | --- | --- |
| notification-query-decl.test.ts.txt | services/app/lib/story/__tests__/notification-query-decl.test.ts | B | 6 expected semantic failures, 17.94 seconds |
| headless-operation-guidance.test.ts.txt | services/app/lib/__tests__/headless-operation-guidance.test.ts | F | Three earlier observed semantic failures; current workflow smoke/eval remains additional work |

The SQL capture and nested Notify seeds were removed. Their historical failures/probe are not proof of this design. The new seed calls existing Helmet/compiler/signature APIs; it must fail on missing behavior, not missing imports.

## Required pre-implementation module tests (specified, not yet run)

A: saved normalized values/defaults plus initiating user/timezone/time survive later document edits and worker identity; current source changes are visible; deleted target returns empty; read-only SQL only; source lineage includes filter-only/nested dependencies; explicit result truncation/byte/fanout failure; malformed to/message fails without partial results. Compile/runtime typed recipient-list support must agree across transports; otherwise use SQL rows and refuse unsupported result types clearly.

B: missing/duplicate on/name, wrong result columns, forbidden nested/body Notify, new undeclared invocation arg, linked local mutation, notification-only signature invalidation, strict metadata revision, immutable source dependency retention. Notify never becomes a page query or runs on GET/render.

C: real isolated DB claim competition, generation/lease fencing, renew/loss, expired recovery, status/retry authorization, enqueue dedupe. Fault last output batch and outbox write: result transaction rolls back but original mutation stays committed. Empty output marks completed. Completed job never re-evaluates. Distinct output rows and distinct run IDs remain distinct. Admission requires every source plus document; blocks, testuser origin, self/agent and source revocation cover both persist and read.

D: one key/gesture across direct/relay and browser/API; same key/input replays canonical original result; mismatch refuses. Save effective values and allowed platform bindings beyond SQL-used params. Completed receipt remains recoverable after declaration removal following current caller authorization. Missing key/anonymous Notify fails prewrite; unrelated mutations unchanged.

E: actor identified separately from current-state text, current all-source read checks, legacy inbox variants, accessible safe status/retry controls, normal-reader denial, internal delivery parity.

F: actual deterministic CLI+browser smoke and agent eval task/rubric; see parent scope and F brief. Pinned copy tests alone are insufficient.

## Root integration checkpoint J0

Before wiring implementation, seed real-handler tests using isolated app harness state and observe their failures against the module seams. Do not count missing modules as behavioral red.

1. Successful mutation atomically stores pointer/version, canonical receipt and one job per matching rule. Failed write/CAS loser/enqueue failure leaves none; losing attempt's rule/bindings cannot escape.
2. Lost mutation response and replay creates no extra job. Intentional new mutation creates a separate job. Zero-affected successful mutation still creates a job; empty query completes with no inbox rows.
3. Crash/lease expiry after query execution but before complete can rerun query against newer data. Stale worker cannot commit; one fenced output wins. Crash after complete/restart does not rerun the query or duplicate inbox/outbox.
4. Query/invalid output/capacity/last batch failures leave mutation committed, status visible and authorized recovery possible. Retry preserves identity/definition/bindings; it does not invoke mutation again.
5. Source access changes during execution invalidate admission; revoke any joined source after completion hides messages from inbox/internal delivery. New access does not backfill completed results.
6. Exact compiled definition remains available across document edit/removal and worker restart while current authority is rechecked. Dependency cleanup cannot delete referenced queued context.
7. Branch CLI and UI exercise same named action, asynchronous job status and inbox. Browser/CLI actor provenance honest; no query/run args/row images/token IDs in public response or event payloads.

Capacity and external adapter tests are implementation gates: measure bounded result transaction/query time, memory/output bytes and SQL count on local PGLite and CI Postgres. Source-side outbox/committed-run replay is required before future remote database writes, not demonstrated by local tests.

Additional contract audit cases: first/replayed mutationRunId discovers all rule jobs via authorized list; ordinary readers denied. Source-free SQL still fences principal/document revocation. Schema replacement/incompatibility never silently rebinds saved SQL. Rule rename/removal leaves saved jobs executable; document deletion fails them. Fence races retry boundedly, permanent revocation fails visibly. Typed scalar/null/list-with-null/duplicate/mixed-type output follows compile/runtime adapter capability checks; JSON text never silently expands.
