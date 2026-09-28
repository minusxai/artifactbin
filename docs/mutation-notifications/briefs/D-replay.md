# D — Run identity, saved bindings and recovery transports

## Responsibility and exclusive files
Own new services/app/lib/mutation-operation.ts; mutation-receipt.ts; story/mutation-request.ts; runtime mutation request/store/fetch/relay; browser mutate route; API operation registry/context; authorized notification-job status/retry transport and tests. Root alone owns artifacts.ts/dataset-mutate.ts/artifact-wire.ts/mutation-invocation.ts. No job schema, worker or inbox edits.

## Contract
One durable run ID per successful action. Browser gestures generate a key once; direct/relay/lost-response recovery retain it. Normalize explicit fingerprint inputs, then separately persist effective validated run binding envelope (values/types, userId, now, tz) and exact notification/compiler context. bindMutationRequest currently returns only SQL-used params; do not accidentally omit Notify-used saved platform values or defaults.

Pin rule revision and initiator at claim; pass root all linked job inputs for winning commit. Notify does not alter affected-count semantics: zero-success still schedules. Anonymous Notify and missing operation key fail before SQL; non-Notify behavior unchanged. Auth principal authoritative, descriptive agent labels do not authorize. Reauthorize before completed receipt lookup, but do not require current declaration existence for saved recovery. Canonical persisted MutationOperationSuccess maps to identical first/replayed per-route shapes. Job failure cannot turn a committed mutation into a failed or retried mutation.


Notification-bearing canonical success includes opaque mutationRunId. Expose it identically on first response and replay and provide authorized list-by-run via C so callers can find every rule job without knowing private job IDs.
## Order and proof
1. Seed normalizer/canonical adapter tests before plumbing; root reviews actual persisted response shape and effective bindings.
2. Test lost response, same-key/different-input, pending/unknown, declaration rename/removal, later document defaults, revoked identity, trusted $_me/_now/_tz and direct/relay parity.
3. Expose C status/retry through the existing authenticated operation pattern; deny ordinary reader access. Do not implement a second queue/retry store.
4. Root integrates enqueue. Verify failures after mutation commit remain notification status, not duplicate mutation attempts.

## Rules shared by every brief

Read AGENTS.md, docs/agent-workflows.md, and docs/mutation-notifications.md first. You are not alone in the repository: work only in your isolated seeded worktree, preserve others' edits, and do not delegate or widen scope. Root owns shared contracts and cross-cutting write-path wiring; propose contract changes to root before editing them. Never edit another worker's owned files.

Use TDD. Where supplied, copy the .test.ts.txt seed to its destination and observe red before implementation. Report commands and actual counts; do not claim new-feature green from old baseline tests. Run npm run validate and affected npm test; follow the 50-file deferral, empty PR-body and CI rules. No production testing, no broad suite bypass, no hand-edited generated assets. Server/CLI checks use only your task server and allocated port block.

Commit implementation and tests in your worktree. Handoff .agent/REPORT.md with contracts consumed/provided, red/green evidence, checks/deferred CI, remaining risks, commit, and a ===CONCISE=== section. Do not merge or claim integrated feature completion. Stop if another owner's contract is insufficient; send the exact missing requirement to root while continuing independent work.
