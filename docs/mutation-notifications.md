# Mutation notifications: foundation and implementation contract

Status: foundation only; no Notify implementation, schema migration, or feature demo yet.
Base: `fae1e6e628784ab4d53616907f0c6b7c56e4f065`.
Published proposal: https://app.artifactbin.dev/a/61YVj6.
This file, shared types, and seeds are the implementation handoff. The linked proposal is its reader summary.

## Complete scope and traceability

| Requirement agreed with the user | Owner | Acceptance |
| --- | --- | --- |
| Prefer headless named queries and supported named mutations over sessions | F | First-page skill + generated query help show both commands; workflow verified through branch CLI |
| Keep sessions for browser QA, local state, unsupported row/cell actions | F | Operating existing artifacts distinguished from testing new actions; identity/guest test rules retained |
| Notify inside a named persistent Mutation, message as children | B | Grammar and compiled metadata; no body element or runtime UI component |
| One recipient or list, null skipping and user deduplication | B + C | Safe AST, bounded pure resolver, individual eligibility |
| Server-owned before/after records | A + root | Typed actual effect, presets, winning retry, no client row trust |
| Implicit actor; action phrase renders after user mention | D + E | Principal-derived identity, honest provenance, no $_actor author API |
| Successful commits only, replay-safe | D + root + C | Dataset pointer, receipt, inbox and outbox atomic; lost-response replay once |
| Single affected row, potentially several recipients | A + B | Notify compiles exact-one guard, bulk declaration/refusal checks |
| Large commented skill example | F | Coherent user-typed task schema and short rendered-notification comment |
| V1 restrictions: user-typed recipient fields, no argument/query recipients, authenticated Notify invocation | B + C + D | Explicit compile/sign-in refusals; no silent widening |
| Running dev-server URL and usable example at feature handoff | F + root | Same named action from UI and CLI; recipient inbox + test steps; task server left running |
| Parallel GPT-6 work, bounded responsibilities | root | Six workstreams, critical-path scheduling, isolated worktrees, no overlapping file ownership |

Deferred, not forgotten: authenticated GET query alias (POST already works), headless row/cell context APIs, connected Postgres writes, bulk notification effects, watchers/groups/recipient queries, rich HTML, and externally delivered production email. The OSS internal delivery view is in scope; the deployment-specific email adapter is a separate repo follow-up and must not be claimed shipped here.

## Exact authoring contract

```jsx
<Mutation name="change_status" expectedAffected={1}>
  {`update tasks.rows set status = $status
    where id = $task_id
      and status is not distinct from $expected_status`}
  {/* Displays: [actor] changed “Review pricing” to Done. */}
  <Notify to={[$_after.assignee, $_after.created_by]}>
    changed “{$_after.title}” to {$_after.status}
  </Notify>
</Mutation>
```

The import and all three scalar Values must exist; demo/example schemas must actually carry assignee and created_by as `user` columns. Do not copy this into the current sales example with undeclared task fields.

- One SQL template and at most one direct Notify child. Message: plain text and direct `$_before.field` / `$_after.field` interpolations. No nested tags, functions, arbitrary expressions, SQL in recipients, spreads, computed properties, or author actor input.
- `to={$_after.assignee}`, `to={[$_before.assignee, $_after.assignee]}`, literal user ID strings, and lists of such strings are supported. For compatibility with existing binding notation, `to="$_after.assignee"` is the same field reference, never a literal ID. Null literal/list entries normalize away.
- Known target `user` columns only for recipient references; known scalar target columns for message references. Runtime validates resolved IDs and authorization. No arbitrary mutation argument or other query references in v1.
- Only Notify has before/after scope. INSERT cannot reference before; DELETE cannot reference after. Nullable message fields render empty text. Scalar formatting uses existing scalar conversion, not JavaScript object coercion.
- Notify implies `expectedAffected:1` if omitted. Any other explicit count is rejected. Zero touched rows fails existing exact-one guard; more than one fails before persistence. Same-value UPDATE is successful and may notify; semantic-diff suppression is not part of this change.
- Initial limits: 20 authored recipient entries before null/dedup normalization; 500 Unicode code points of resolved action text. Limit overflow is a clear declaration/invocation refusal, not silent truncation. Limits are validated before persistence, including expressions whose resolved strings are longer than source.
- Local mutations and nonphysical/connected target tables cannot carry Notify. A direct SQL dataset write has no Notify declaration.

## Shared contracts and module ownership

`services/contracts/src/sql.ts` adds optional `capture:'single-row'` and `MutationEffect` on `MutationResult.effect`. This foundation does not implement the engine. Callers must not begin requesting capture until A passes; missing effect on a capture request is a capability refusal, not success.

Engine semantics: before is captured during the author statement, after is read after presets and checks, both use normal typed column conversion. Zero without an exact count returns explicit `effect:null`; >1 returns `row_not_unique` with no rows/effect. An independent `expectedAffected` guard remains stricter. Ordinary writes omit effect. Never persist internal rowid, infer changes by comparing row values, or expose full images in the API reply. Capture remains bounded on wide/multirow inputs and preserves extension continuation behavior.

`services/contracts/src/mutation-notifications.ts` freezes:

- `MutationNotificationSpec`: inert recipient/reference and message-part AST.
- `MutationOperationRequest` and `MutationOperationSuccess`: canonical explicit input and successful domain receipt outcome; first and replayed HTTP replies use the same route adapter.
- `MutationInitiator`: authoritative principal plus descriptive execution provenance. Agent labels may be self-reported and never authorize anything.
- `MutationNotificationOrigin`: durable invocation identity, exact document head/version and declaration slot, successful dataset head/table.
- `ResolvedMutationNotification`: candidate user IDs and bounded plain action text, not admitted recipients.
- `MutationNotificationResolver`: pure resolution; `MutationNotificationWriter`: transaction-bound admission and storage.
- `MutationNotificationView`: new inbox variant, with no token identifiers or raw record images. Preserve legacy notification variants.

SQL imports no notification delivery code. Parser/compilation never imports app DB/UI code into the CLI engine. Notify is metadata; both Solid and legacy readers must not execute it. Strip unused Notify AST from browser compilation where possible; ensure this does not remove server declarations or source round-trips. Update strict parsed-artifact schema and compiler revision with the authoring change.

B owns pure `lib/story/mutation-notification.ts` parsing/resolution. C owns `lib/mutation-notifications.ts` transaction module. D owns `lib/mutation-operation.ts` receipt adapter and transport identity propagation. Root alone wires `lib/artifacts.ts`, `lib/story/dataset-mutate.ts`, `lib/mutation-invocation.ts` and `lib/artifact-wire.ts`, coordinating narrow requests from workers rather than letting them overlap.

## Deliberate policy decisions and limits

These are new product rules, not facts established by existing tests.

1. Historical message text is a snapshot of a successful change. Only recipients authorized at commit receive it. Current document and whole-table dataset read authority are rechecked before inbox/email eligibility. Deleted-row text may remain visible while that authority remains; granting someone access later never backfills old notifications. Artifact or source dataset deletion hides its notifications. At later reads use CURRENT live document/dataset owners and grant principals, not historical ownership; original heads are audit metadata only. Existing notification retention/deletion lifecycle applies; no separate event archive of content is introduced.
2. V2 grants use recipient identity and saved document context, with private dataset visibility as a ceiling. Legacy/no-policy datasets need conservative recipient dataset read admission, not only the document owner's ability to import them. Read authorization must cover the entire referenced table; deny unsupported finer read policies. Do not confuse legacy write filters with row-level read policy. Never infer a read grant from being named as recipient.
3. V1 Notify executions require a user or token replay scope. Anonymous actions without Notify remain unchanged. Anonymous Notify requests get a sign-in-required refusal before execution. The actor type represents anonymous/system honestly for compatibility, but system scheduling and anonymous replay ownership are not implemented by this work. Supporting anonymous notifications later needs its own scope design; a shared null-principal receipt hash is unsafe.
4. Direct human self-actions remain quiet; an agent acting for the same account may notify it, as current annotation behavior does. Execution labels never change write or recipient access. Unknown/deleted/ineligible recipients are skipped; malformed resolved recipient types/IDs are refused before commit. Test-user origins never send to real accounts; C resolves account kind through tx rather than trusting transport flags. Check both directions of user blocks. Existing account-deletion cleanup remains authoritative; a surviving message whose user actor no longer exists renders a non-identifying Deleted user fallback, never System.
5. Atomicity is non-negotiable: pointer/version, receipt, notification content/recipient rows, and ID-only outbox fact commit together. All in-transaction lookups use the supplied tx, never outer getDb. Persist only for the winning compare-and-swap attempt. External delivery and any application-level wakeup are after commit; transactional SQL NOTIFY is commit-delayed.
6. Browser operation IDs are generated once per action and preserved through direct/relay transports and recovery. Normalize API/browser requests into one canonical fingerprint (document ID + mutation + explicit request inputs including row/value/tz/expected state); pin the declaration head inside the durable invocation, not by rebinding on replay. Pin initiator/provenance when claiming the invocation, so replay headers cannot reclassify the original write. Reauthorize current document/principal access before receipt lookup, but look up a completed receipt BEFORE requiring that the current named declaration still exists. An invocation completed under an older declaration returns its saved authorized outcome; a new invocation uses the current head. Pending/unknown outcomes never cause a fresh write automatically. Notification-bearing calls lacking an operation key fail before SQL with operation_key_required. A stale browser may refresh for compatible code; API/CLI clients must supply and retain a key. Never invent a new key to recover an uncertain outcome.
7. The current receipt service completes a dataset-shaped reply while browser/document callers return different shapes. D must define a canonical persisted domain outcome and lossless adapters so first response and replay match on each route. Do not complete the receipt twice with competing response shapes. Invocation identity used for event/dedupe is an opaque derived ID, not raw client key.
8. Event payloads carry IDs/state, never resolved message or before/after rows. Notification storage owns bounded content. New durable fact identity must not collide with existing observational `mutated` telemetry. Inbox creation is separate from email preference scheduling.

Policy 3 is an explicit scope restriction chosen to avoid unsafe anonymous replay, not a claim that all existing mutations require sign-in. Revisit it before broadening the initial feature. The implementation must not silently hide this behavior in UI/errors.

## Parallel schedule and realistic balance

Six implementation workers plus root; start no more than four at once. This is a dependency schedule, not a claim of equal minutes.

| Worker | Scope / complexity | Start and completion |
| --- | --- | --- |
| A | Engine capture + four transport compositions + edge/typed tests; medium-high | Starts immediately after seed; finishes independently |
| B | Grammar + compiler + pure resolution + stored metadata + serializer/client projection; medium-high | Starts immediately; C/D use typed fixtures and do not wait for parser |
| C | Storage/schema + recipient authorization + inbox projection + atomic module tests; high | Start early; owns schema exclusively |
| D | Invocation identity + browser replay + provenance + route response parity; high | Start early; owns transport files exclusively |
| E | Inbox UI + accessibility + internal delivery API compatibility + legacy regression; medium | Starts from view fixtures as an A/B slot frees; no database-schema edits |
| F | First-page/generated teaching + example + local demo fixture + cross-surface QA; medium-high | Can draft from frozen syntax; starts in an A/B slot; finishes on integrated app |
| Root | Contracts/core seeds, review, shared write-path wiring, fault-injection tests, CI, live-server handoff | Continuously; final integration after A–D |

A/B completing earlier is useful: their agents review transport/security test coverage or pick up explicitly reassigned bounded validation work; don't expand their scope implicitly. C/D are deliberately separated because either could otherwise dominate the critical path. E is larger than a visual label change: old inbox variants, sender-block behavior, read revisions, internal email eligibility payload, and accessibility all need proof. Root owns integrated app availability; F drafts the fixture scaffold from frozen contracts early, before waiting for its UI integration slot. F is not a final docs chore: it owns CLI guidance plus an executable fixture and workflow QA. Workload estimates are qualitative; report progress by completed acceptance criteria and rebalance at the first real checkpoint.

Per-worker briefs live in `docs/mutation-notifications/briefs/`. Shared contracts change only through root. Use scripts/agent-worktree.mjs with this branch's committed seed as explicit --base, each worker's brief, --install and --secrets; never put two implementers in one checkout. Branches/ports/data stay isolated. Do not launch implementation merely because the briefs exist: this requested stage ends at the reviewed foundation.

## Test seeds and evidence

Seeds are stored as `.test.ts.txt` so an unfinished feature does not make foundation CI deliberately red. Copy each to its documented service path before implementation; do not weaken the assertions. Workers keep the resulting real tests in their implementation commits.

Observed at this base:

- Existing focused baseline: 4 files, 163 tests passed (35.83 seconds runner duration).
- SQL capture and declaration seeds: 2 files, all 10 tests failed for the intended missing effects/grammar/signature behavior (19.83 seconds). This is genuine semantic red, not a missing import failure.
- Headless teaching seed: 1 file, three tests failed in the final strengthened seed: first-page named operation examples absent, no explicit routine-operation versus authoring-QA guidance, and generated help incorrectly restricts writes to dataset targets. The original two-test probe also failed (5.11 seconds).
- No feature green or end-to-end proof yet. The earlier scratch SQLite mechanism probe and 219-test planning baseline are supporting evidence, not substitute integration tests.

Seed inventory and future integration assertions: [seeds/README.md](mutation-notifications/seeds/README.md). Integration gate J0: before C/D/root integration, canonical response-adapter and transaction fault tests must be runnable and observed red. This is a separate checkpoint, not satisfied by parser/engine seed failures. The root must seed/run these tests against the shared adapters before integrating those implementations; their current status is specified, not observed red. Do not describe this foundation as proving future atomic notification delivery.

Run routine `npm run validate` and `npm test`. For scoped TDD use `npm test -- --files ...`. Above 50 files, do not split/bypass; open/update an empty-body PR and inspect CI. Receipts are reusable only under repository rules. No changes are to be merged until their required checks pass.

## Feature handoff is a running example

The foundation worktree owns port block 5000–5099; read its .env for APP__PORT, never guess or borrow another server. F seeds local mxmx_test_* actor/recipient accounts and a task dataset with real user fields, a named read, and one guarded named mutation used by both CLI and UI. Verify scalar/list/null/duplicate/ineligible recipients, a failed guard, and replay without duplication. The final integrated server runs via npm run dev and stays running. Provide its artifact URL, recipient inbox URLs and local sign-in steps, plus process ownership. Read OTPs only with npm run dev:otp.

Use npm run afbin against that same task server; do not iterate on production. Publishing the design proposal is documentation only. No baseline app URL may be presented as a working Notify demo.

Agent-following-instructions eval requires the separate private evals repository, absent at foundation time. F checks availability and adds/runs a scoped task there if available; otherwise report the unrun eval explicitly, with real CLI/browser evidence. Production email adapter is likewise separately owned and not implied by an OSS inbox pass.
