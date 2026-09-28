# Mutation-triggered notification queries

Status: accepted design; foundation only. No Notify runtime, migration, worker or feature demo is implemented.
Base: `fae1e6e628784ab4d53616907f0c6b7c56e4f065`.
Published proposal: https://app.artifactbin.dev/a/61YVj6.
This document, shared types, briefs and test seeds are the implementation handoff. They replace the earlier nested Notify/captured-effect design; historical experiments remain evidence only.

## Authoring contract

```jsx
<Helmet>
  <Import name="tasks" src="ref:TASK_DATASET_ID" />
  <Value name="task_id" type="string" />
  <Value name="status" type="string" />
  <Value name="expected_status" type="string" />
  <Mutation name="change_status" expectedAffected={1}>
    {`UPDATE tasks.rows SET status = $status
      WHERE id = $task_id
        AND status IS NOT DISTINCT FROM $expected_status`}
  </Mutation>
  {/* Displays the triggering actor, then: Task Review pricing is now Done. */}
  <Notify name="status_notification" on="change_status">
    {`SELECT assignee AS "to",
             'Task ' || title || ' is now ' || status AS message
      FROM tasks.rows WHERE id = $task_id`}
  </Notify>
</Helmet>
```

The example dataset must contain id/title/status plus real `user`-typed assignee/created_by fields. The reference above is a placeholder only; the runnable fixture supplies a real local artifact ID. Keep the large commented skill example coherent with its actual schema.

- Notify is a direct Helmet declaration alongside Mutation/Query, not a component inside Mutation or the body. It has a document-unique `name`, `on` referring to one named persistent Mutation, and one static SQL child. Multiple differently named rules may reference the same mutation. Compile-check missing/ambiguous references; no automatic retargeting on rename.
- One read-only query produces rows with `to` and `message`. No separate recipient and message queries, nested interpolation DSL, before/after bindings, author-facing actor override, or reactive subscription. GET, normal Query execution, rendering, and reading the document never schedule notifications.
- `to` is a user ID, a bounded list of user IDs where the query adapter supports typed list results, or null. Nulls skip; duplicate users within one result row collapse. Known unsupported list outputs fail publish; unknown invalid shapes fail the job. Null entries in typed lists skip and mixed non-user types fail the job. Lists must round-trip as typed data: no implicit parsing of arbitrary JSON/text as recipients. Multiple SQL result rows cover multiple users portably. Validate account IDs at runtime; current read admission is always required, not inferred from user-typed columns.
- `message` is bounded nonempty plain text. It describes the query's current state; the platform displays the trigger actor separately so later state is not falsely credited to that actor. No rich HTML or author-supplied subject. Different output rows for one user remain distinct; SQL DISTINCT/GROUP BY can explicitly summarize. Do not deduplicate different rows or separate mutation runs just because text matches.
- SQL may join supported declared relations and aggregate. Require read-only execution and dependency analysis covering all sources, including predicates, nested queries and transitive dependencies. No effectful extensions, arbitrary JS/network execution, or unresolved dynamic relation names.
- Bind named parameters from the triggering run's saved effective scalar arguments/defaults. Notify cannot introduce new required request arguments or read mutable browser state. Notification SQL parameter references must be supported by the linked mutation's run binding contract. Save allowed platform identity/time/zone bindings explicitly; do not regenerate them from the worker's identity/clock. No before/after snapshots, row images or author-exposed mutation run ID are necessary.
- For an initial rule needing page-local table Values, unsaved queries or unsupported row/cell context, fail publish with a useful capability explanation rather than reconstructing browser state. Existing actions without Notify keep their behavior. Headless row/cell invocation remains separately deferred.
- Notify never adds an affected-row guard. Explicit `expectedAffected` retains existing semantics. Every successful mutation run schedules its rules, including zero affected rows and same-value updates. The query may then return zero or many notifications. A delete may yield no current row; use saved scalar inputs or related tables if a useful deletion message is needed, without promising historical images.

## Run identity, durability and failure semantics

1. Give every notification-bearing mutation one durable, authorized run ID. Request retries/replays reuse it; an intentional new action gets a new ID. Job identity is `(mutationRunId, notificationRuleId)`; rule ID is its document-scoped name. Pin rule/dependency revision, initiator and effective bindings when claiming the invocation. Renaming/removing a rule later does not cancel saved jobs; those jobs still use the pinned definition under current authorization. Deleting the document fails the job.
2. In the winning local mutation transaction, persist the dataset pointer/version, canonical mutation receipt and all trigger jobs together. Failed or rolled-back writes schedule nothing. A job enqueue failure rolls back the write because a success response without its durable trigger would violate the contract. CAS losers create no jobs.
3. The worker leases durable jobs and evaluates the saved rule against current authorized data after commit. Latest state may include other mutations; that is intentional. No immutable database snapshot or before/after capture is required.
4. Query execution is at least once. On a crash before result commit, it may execute again and see newer state. Only a current, unexpired fenced claim may commit. Persist admitted output rows, inbox rows, ID-only delivery outbox facts and completed status atomically in a bounded result transaction. Empty plans complete too. Exactly one plan wins; subsequent retries use saved results instead of rerunning the query.
5. Logical inbox identity is job + output ordinal + recipient. Ordinals come from the saved winning output; no ordering promise across SQL executions is required. Leases prevent normal duplicate work; fencing and unique constraints protect correctness after timeout/crash. Renewals and every state change compare the claim generation. A stale worker must discard its result.
6. Post-commit query/message/recipient/capacity failures do not reject or roll back the user's mutation. Transient infrastructure failures use bounded backoff; invalid output, missing sources or revoked access become visible classified failed jobs. Authorized retry retains original identity/rule/arguments; it may read newer state. Do not automatically retry a successful mutation to recover a notification failure.
7. Query execution and delivery are separate. Result/inbox insertion may use several SQL batches inside one result transaction; a last-batch failure rolls them all back and leaves the job retryable. No second chunk-materialization state machine initially. Email delivery is after result commit; external exactly-once delivery requires provider idempotency and is not claimed here.
8. A durable job can guarantee scheduling and retryable processing, not eventual successful output from permanently broken SQL or an unavailable source. Failed jobs cannot disappear into logs. C provides authorized list-by-run/status/retry services, D transport, E visible status, F documented recovery. Notification-bearing mutation replies include an opaque mutationRunId on both first response and replay; authorized list-by-run discovers every linked job. Status exposes safe error codes/attempts, not query text, parameters or private source details.

Browser operation IDs are generated once per gesture and preserved through direct/relay calls and uncertain outcomes. API/CLI clients retain Idempotency-Key; missing keys for notification-bearing calls fail before SQL with operation_key_required. Authenticated user/token replay scope is required initially; anonymous non-Notify mutations are unchanged. Completed receipt lookup follows current principal/document authorization but precedes current named-declaration lookup, allowing authorized recovery after a rename/removal. First response and replay use the same canonical domain outcome plus route adapter; do not persist competing browser/dataset-shaped replies. Actor classification is fixed at claim, never changed by retry headers.

## Authorization and privacy

- Reuse the existing saved-document query delegation boundary under the initiating principal's current identity and document context. Never evaluate as a background worker, silently substitute the owner, or treat stored authority as a perpetual grant. Revoked/deleted user/token/document/source authority produces a classified job failure.
- Saved definitions pin relation identities/bindings, not dataset contents or permission state. Resolve current source data at execution. Source provenance is server-produced and includes every contributing relation, including filter-only dependencies. Unknown lineage is unsupported, not implicitly public. No promise of one cross-dataset point-in-time snapshot is introduced.
- For each candidate recipient, require current document readability and conservative whole-table read admission to every contributing source. Private source visibility remains a ceiling. Legacy/no-policy imports require recipient source admission; the document owner's import capability is insufficient. Unsupported finer read policies are explicitly refused. SQL joins/aggregates do not erase source confidentiality.
- A checks source execution authority; C admits recipients transactionally using the same shared authority rules. Recheck initiating principal and document authority (even for source-free SQL), all source authority revisions, compatible source identity/schema and dependency context before saving the plan. Never rebind an old rule to a replaced source by name. A fence mismatch triggers bounded reevaluation under current authority; actual revoked/deleted authority or incompatible schema becomes classified failure. Version/fence capability across external sources is an adapter requirement; do not claim local transaction guarantees extend to them.
- Store source identities for current inbox/internal-delivery rechecks. Historical resolved messages can remain only while current document/all-source read authority remains. Source/artifact deletion hides dependent items; later access grants never backfill a completed plan. Current live ownership governs access, not historical owner metadata.
- Null/unknown/deleted/ineligible recipients are skipped; malformed non-null recipient types or IDs fail the job. Enforce both directions of blocks, human-self suppression and agent-to-own-account behavior. Test-user origins never notify real accounts. Resolve account kinds through the owning DB boundary, not transport claims.
- Principal identity is authoritative; agent labels/execution provenance may be self-reported and never grant permission. No raw token IDs in presentation. Deleted actors have a non-identifying fallback, never System. The actor identifies who triggered the mutation; render it separately from current-state message text.
- Event-service/outbox payloads contain IDs and state only. Arguments, queries and messages stay in access-controlled app storage; no bearer credentials are saved in jobs. Job status/retry access is limited to the originating authorized principal or current document managers; E/D must not expose other users' run details through normal document readership.

## Bounds and backend portability

Bound query time, returned row count, total result/message bytes and total normalized recipient fanout. Keep a per-result-row recipient bound (initial proposal 20) and a message bound (500 Unicode code points). Numeric aggregate defaults are a measurement gate, not established capacity evidence. Use query limits that detect overflow, e.g. an extra sentinel row where supported; an ordinary truncated result is NOT a complete plan. Overflow becomes an observable failed notification job, with no partially committed inbox batch and no rollback of the earlier mutation. Backpressure may refuse accepting a mutation before commit if durable job capacity is unavailable; no silent job loss. All config uses owning audited env modules.

The source query, mutation execution and durable trigger adapter must hide database details from Notify syntax. No SQLite rowids, effects or CAS shapes belong in the rule. Existing local MutationOperationSuccess remains a local route adapter, not a universal external-write protocol. Future Postgres/other writers need replay-safe committed-run identity and a durable trigger committed with the source write (source outbox/receipt or equivalent verified change feed). A post-write HTTP call alone leaves a crash gap. Future connector work must prove trigger durability, current authority, supported read SQL/typed results and recovery; it does not require before/after capture. Cross-source transactions/dialect translation are not implied by this proposal.

The current event outbox forwards envelopes; it is not a durable authored-query worker. A/C must implement claims, startup/shutdown, leases/fences, recovery and status explicitly. Source-side outbox rationale: [transactional outbox guidance](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html). This is design rationale, not evidence of implemented remote support.

## Boundaries and parallel work

Shared inert contracts are in services/contracts/src/mutation-notifications.ts. SQL capture types and the obsolete engine-capture seed are removed from this feature. Rules carry name/on/sql; jobs carry immutable rule/binding context and run identity; evaluator produces normalized output plus server source provenance; job store owns enqueue/claim/renew/complete/fail; presentation gets safe actor/message/job views. Opaque context revisions must resolve to retained server-owned immutable compilation metadata for queued jobs. Do not purge it while referenced. Stored schema/compiler revision and code-version compatibility must be reviewed before implementation.

| Owner | Exclusive responsibility | Contract / start |
| --- | --- | --- |
| A | Read-only query evaluator, binding/source access integration, output normalization/bounds, worker loop and lifecycle | Evaluator + C repository; start from fixtures |
| B | Standalone grammar, on/name validation, parameter/source dependency compilation, serialization, stored metadata/version and client projection | Rule/job compilation; independent start |
| C | Schema, durable job repository, leases/fences/backoff, atomic output/inbox/outbox persistence, recipient admission, status/retry service | Job store; start early, no authored SQL execution |
| D | Run IDs, canonical request/outcome, browser/API replay, pinned effective inputs and initiator, authorized job status/retry transport | MutationOperation + enqueue context; start early |
| E | Actor/message inbox UI, all-source read revocation projection, internal delivery view, accessible job status/retry UI | Seeded item/status views; after an A/B slot frees |
| F | First-page/generated headless teaching, commented standalone example, pinned tests, smoke/eval, demo fixture and recovery steps | Public syntax and views; early fixture design |
| Root | Shared contracts/seeds, winning-write enqueue wiring, cross-module fault tests, reviews/CI and running server handoff | Continuous; no worker-loop ownership |

Six implementation workers, at most four concurrently, isolated worktrees/data/port blocks. A/B/C/D start after the revised executable contract checkpoint. E/F develop against fixtures as slots free; start F's fixture scaffold early. C is deliberately separated from A's execution and worker loop. No equal-duration claim: review acceptance progress and explicitly reassign bounded validation work when a worker finishes. Shared file ownership changes only through root. Briefs are in docs/mutation-notifications/briefs; implementers do not delegate or overwrite one another.

## Complete scope, teaching and demo

Preserved scope: headless named reads/writes by default; sessions for browser QA/page-local state/unsupported row-cell context; safe actor identity; successful mutation scheduling; scalar/list recipients; bulk query/aggregation; replay/blocks/testuser/source admission; generated teaching fixes and commented example; six scoped workstreams; a running feature demo at final handoff.

Headless examples use `afbin query ID --name tasks` and `afbin query ID --write --name change_status --param task_id=... --param status=... --param expected_status=...`. Teach the CLI rather than raw HTTP. Existing authenticated named operations use POST; an authenticated GET alias is not necessary for this work. Fix compile-teaching.ts's false “dataset target” restriction. Preserve identity/guest checks, testuser forks, one-session guidance and uncertain-write recovery.

F owns three verification layers:
1. Pinned first-page/help/example tests, updated with their generator sources. Never hand-edit generated teaching.json.
2. Deterministic branch-CLI/browser smoke: seed named read/write/rule, execute read→write→read, await durable notification job completion, verify inbox, then test authored UI in a session. Include bulk mixed recipients, zero result, request replay, failed query/recovery and required row-context session fallback. Assert state, not just help text or sleeps.
3. Behavioral agent eval: existing-artifact operation chooses headless query/write without unnecessary sessions; newly authored actions receive real session UI checks; local-state/row-cell cases use session fallback. Grade tool traces and resulting state; penalize fresh-key uncertain retries. The private evals repo is absent here; supply task/rubric, and add/run there when available. It is not a substitute for deterministic smoke and remains unrun until actually executed.

Use npm run afbin and npm run dev against this task's own server only. The foundation worktree owns port block 5000–5099; read APP__PORT from its .env without printing secrets. Seed local mxmx_test_* actor/recipient users and task/watcher data with real IDs. Final implementation handoff leaves npm run dev running and provides the example artifact URL, recipient inbox, job status/recovery flow and local sign-in/OTP steps (npm run dev:otp). No baseline server may substitute for the promised implemented demo.

Deferred: authenticated GET alias, headless row/cell-context API, connected DB write implementation, standalone scheduling without a mutation, rich notification HTML and deployment-specific production email adapter. Relational recipients/watchers are now expressible through supported query relations; a separate watcher-subscription system is not added. OSS internal delivery compatibility is in scope; external email remains separate-repo work.

## Evidence and implementation gates

Historical evidence: 163 existing focused tests passed; earlier capture and nested grammar seeds failed semantically, and a SQLite multirow scratch probe passed. Those capture results do NOT validate this accepted query design. Headless teaching seed had three semantic failures. Historical logs remain in .agent/evidence; obsolete capture seeds are removed from the active handoff.

The standalone declaration seed is runnable against current Helmet parsing and declaration-signature APIs; six expected semantic failures were observed in 17.94 seconds (seeds/README.md). Query execution/job fencing/replay/authorization tests must be seeded and observed red against the new module seams before implementation. Missing-import failures are not behavioral evidence. J0 requires real-handler atomic enqueue tests and fenced result/failure recovery tests before integration. Inspect source dependency/parameter contracts first; ordinary reactive Query cannot simply be reused with worker identity.

Routine checks are npm run validate and npm test. Respect the combined 50-file cap; deferral is NOT PASSED. Commit/push/update an empty-body PR and inspect CI; full suites/build/browser gates remain CI-only. Prior CI functional jobs passed while two browser shards exceeded the timing budget; no merge or unchanged retry is claimed. Current foundation checks and active CI status belong in the handoff report, not invented feature green.
