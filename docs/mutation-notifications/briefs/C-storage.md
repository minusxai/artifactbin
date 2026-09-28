# C — Notification storage, recipient eligibility and transaction module

## Responsibility and exclusive files
Own new services/app/lib/mutation-notifications.ts, notification-events.ts, notifications.ts, membership-inbox.ts, schema.ts + generated schema SQL and ownership/freshness tests. Own new module/API notification eligibility tests. No UI components or browser transports. Root alone edits dataset-mutate.ts/artifacts.ts/artifact-wire.ts and wires your commit adapter.

## Contract
Implement MutationNotificationWriter using only supplied tx. Consume already resolved candidates plus trusted initiator and exact origin. Store bounded action content in app-owned notification rows, never event payload. Deduplicate by opaque invocation/declaration/effect-ordinal/recipient identity; emit one stable source fact for the invocation and recipient changes. Preserve legacy variants. Null/token senders need honest non-user presentation, not synthetic accounts or raw token IDs.

Recipient admission covers document AND whole-table source data under actual recipient/document context. Handle legacy/no-policy reads conservatively; write filters are not read grants. Unknown/deleted users skip; malformed values refuse earlier. Check blocks, self/agent behavior, sandbox isolation. Recheck access at inbox reads and expose only MutationNotificationView. Follow chosen historical snapshot policy.

## Order and proof
1. Build fixture records from seeded spec/effect, independently of parser.
2. Root reviews storage and actor migration before generating schema. Do not enqueue outer getDb inside a transaction.
3. Real isolated DB tests: one per distinct eligible recipient per effect, outbox content exclusion, rollback, repeated commit idempotency, access revocation, delete history, private dataset/public document, nonuser actors, testuser isolation.
4. Give root a deterministic failure seam/constraint test fixture for pointer+receipt+notification atomicity.

Deletion list: remove duplicate notification policy or lookup code introduced by implementation; do not replace all legacy notification kinds. Complete when tx module and public projection work with fixtures. Full CAS/route integration is root's join point.

## Rules shared by every brief

Read AGENTS.md, docs/agent-workflows.md, and docs/mutation-notifications.md first. You are not alone in the repository: work only in your isolated seeded worktree, preserve others' edits, and do not delegate or widen scope. Root owns shared contracts and cross-cutting write-path wiring; propose contract changes to root before editing them. Never edit another worker's owned files.

Use TDD. Where supplied, copy the .test.ts.txt seed to its destination and observe red before implementation. Report commands and actual counts; do not claim new-feature green from old baseline tests. Run npm run validate and affected npm test; follow the 50-file deferral, empty PR-body and CI rules. No production testing, no broad suite bypass, no hand-edited generated assets. Server/CLI checks use only your task server and allocated port block.

Commit implementation and tests in your worktree. Handoff .agent/REPORT.md with contracts consumed/provided, red/green evidence, checks/deferred CI, remaining risks, commit, and a ===CONCISE=== section. Do not merge or claim integrated feature completion. Stop if another owner's contract is insufficient; send the exact missing requirement to root while continuing independent work.

Multirow contract: consume the full ordered resolved array. Dedup by invocation/declaration/effect ordinal/recipient; batch eligibility reads and inserts, not sequential per-row recordNotification calls. Equal text is not duplicate identity. Last-batch failure rolls back everything. Grouping is presentation-only and recipient-local. Measure bounded fanout before freezing limits.
