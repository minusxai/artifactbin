# A — Query evaluation and durable worker execution

## Responsibility and exclusive files
Own new services/app/lib/notification-query.ts and notification-worker.ts, their focused tests and app startup/shutdown wiring coordinated with root. Own bounded query-access helpers needed here; coordinate with E/C before touching shared access modules. No schema, job SQL, parser, receipt or skill edits. The old A-engine capture assignment is removed.

## Contract
Consume MutationNotificationEvaluator/JobStore. Read saved standalone SQL using pinned import bindings and saved normalized run values/user/time/zone. Reauthorize initiating principal/current document and all sources through existing query delegation rules; no worker/owner identity substitution. Initial relations are supported saved imports/platform relations; do not invent support for page-local tables or named-query dependencies without B proving the immutable scalar-only dependency closure.

Return validated to/message output, server-owned source provenance and authority fences. Reject truncated/incomplete results, unsafe SQL and capacity overflow; no partial candidate plan. Preserve typed user-list results only where the adapter demonstrably supports them; multiple output rows remain portable. Own source execution authorization and the shared source-authority predicate consumed by C/E. Queries never run on GET/render. Worker claims/renews through C, discards stale results, classifies failures, and recovers on startup; never writes job storage directly.


Reauthorize at result commit through C: include originating principal/document authority fences even for zero-source SQL, compatible source schema and pinned dependency closure. Known unsupported typed list outputs fail compile; runtime mixed/bad types fail the job; list nulls skip. Fence races retry boundedly; confirmed revocation/deletion/incompatible schema is classified failure. Saved jobs survive declaration rename/removal under current authorization; document deletion fails them.
## Order and proof
1. Seed executor tests with injected real query adapters and recorded current-state fixture reads; observe semantic red before implementation.
2. Cover saved defaults/platform identity/timezone, changed/deleted source rows, read-only denial, joins/filter-only lineage, current source revocation, malformed output and truncation detection.
3. Worker tests use controlled time and C repository fixtures: lease expiry, renewal loss, crash-before-complete, backoff, empty plan, permanent failure. Root owns real DB cross-module joins.
4. Integrate app lifecycle safely; do not repurpose event-outbox forwarding as the authored-query worker. Report bounded maximum query/fanout measurements; numeric defaults are not pre-approved capacity claims.

## Rules shared by every brief

Read AGENTS.md, docs/agent-workflows.md, and docs/mutation-notifications.md first. You are not alone in the repository: work only in your isolated seeded worktree, preserve others' edits, and do not delegate or widen scope. Root owns shared contracts and cross-cutting write-path wiring; propose contract changes to root before editing them. Never edit another worker's owned files.

Use TDD. Where supplied, copy the .test.ts.txt seed to its destination and observe red before implementation. Report commands and actual counts; do not claim new-feature green from old baseline tests. Run npm run validate and affected npm test; follow the 50-file deferral, empty PR-body and CI rules. No production testing, no broad suite bypass, no hand-edited generated assets. Server/CLI checks use only your task server and allocated port block.

Commit implementation and tests in your worktree. Handoff .agent/REPORT.md with contracts consumed/provided, red/green evidence, checks/deferred CI, remaining risks, commit, and a ===CONCISE=== section. Do not merge or claim integrated feature completion. Stop if another owner's contract is insufficient; send the exact missing requirement to root while continuing independent work.
