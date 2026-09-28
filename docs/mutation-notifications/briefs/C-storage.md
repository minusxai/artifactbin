# C — Durable notification jobs and result persistence

## Responsibility and exclusive files
Own new services/app/lib/notification-jobs.ts and mutation-notifications.ts; schema.ts and generated schema/ownership tests; mutation-specific notification storage hooks and focused DB tests. Own status/retry service, no HTTP/UI transport. A owns authored query execution/worker loop, E membership-inbox projection, D receipts/routes. Root owns winning mutation wiring.

## Contract
Implement seeded JobStore enqueue/claim/renew/complete/fail/status/retry with unique run+rule job identity. Enqueue uses supplied winning mutation transaction. Claims have renewable leases and monotonic fences. All transitions compare active generation and lease. Result completion owns a separate transaction: current recipient admission/all-source authority fence checks, all inbox rows, ID-only outbox and completed status together. Empty results complete. Stale workers return false; no overwriting completed output. Query/plan failures never roll back an earlier committed mutation.

Initial bounded plan and inbox materialization commit together using batched SQL; no second async chunk state machine. Unique job/output-ordinal/recipient identities preserve distinct rows. Admission reuses A's source authority helper; account kind, blocks, human-self/agent-self and testuser isolation resolve via supplied tx. Save private source refs for E's current-read rechecks. Retry/status authorize original principal or current document managers; safe codes only. Retry preserves original run/rule/bindings and records requester. Context snapshots cannot be purged while queued jobs refer to them.


Provide authorized list-by-run discovery in addition to status/retry; D exposes the durable mutationRunId in identical first/replayed replies. complete must recheck principal/document authority even for source-free plans, source schema identity/compatibility and dependency context as well as recipient access. A fence race requests bounded reevaluation; actual lost authority/incompatible schema becomes visible failure.
## Order and proof
1. Root reviews schema migration and queue state transitions before implementation. Seed real isolated DB tests for enqueue uniqueness, rollback, claim competition, expired/stale fences, renewals and backoff.
2. Fault last result batch/outbox insertion: no plan/inbox/completed state persists, while original mutation remains committed. Persist zero-output completion. Replay never duplicates.
3. Test full-source recipient admission, access races, private source/public document, blocks, account deletion and testuser origin. Never call outer getDb inside tx.
4. Provide authorized status/retry services and failure fixtures to D/E/F. Record query counts and bounded PGLite/CI Postgres fanout measurements.

## Rules shared by every brief

Read AGENTS.md, docs/agent-workflows.md, and docs/mutation-notifications.md first. You are not alone in the repository: work only in your isolated seeded worktree, preserve others' edits, and do not delegate or widen scope. Root owns shared contracts and cross-cutting write-path wiring; propose contract changes to root before editing them. Never edit another worker's owned files.

Use TDD. Where supplied, copy the .test.ts.txt seed to its destination and observe red before implementation. Report commands and actual counts; do not claim new-feature green from old baseline tests. Run npm run validate and affected npm test; follow the 50-file deferral, empty PR-body and CI rules. No production testing, no broad suite bypass, no hand-edited generated assets. Server/CLI checks use only your task server and allocated port block.

Commit implementation and tests in your worktree. Handoff .agent/REPORT.md with contracts consumed/provided, red/green evidence, checks/deferred CI, remaining risks, commit, and a ===CONCISE=== section. Do not merge or claim integrated feature completion. Stop if another owner's contract is insufficient; send the exact missing requirement to root while continuing independent work.
