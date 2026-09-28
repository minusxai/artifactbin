# A — Engine-owned mutation effects

## Responsibility and exclusive files
Own services/sql/src/sqlite/writes.ts and any bounded typed-conversion helper in services/sql/src/sqlite/database.ts, plus services/sql/__tests__/mutation-effect.test.ts and directly related engine transport tests. Contracts in services/contracts/src/sql.ts are already seeded and root-owned. Do not touch app modules.

## Contract
Implement capture:'single-row' / MutationResult.effect. Engine private identity handles duplicates without a primary key. Before is captured during author SQL; after includes presets and validation. Normal typed values, no internal rowid/columns. Same-value UPDATE counts. Zero returns explicit null unless expectedAffected refuses it; multirow capture refuses whole result. Ordinary writes retain behavior and omit effect. Continuations and policy-preview do not leak premature effects.

## Order and proof
1. Copy mutation-effect seed; observe its six semantic failures.
2. Implement bounded capture; avoid one callback argument per column for unbounded wide tables.
3. Run the same behavior over local/worker × direct/HTTP compositions, using dataset-policy fixtures. Add wide/nullable/user-field cases, filter/preset behavior, timeout/continuation refusal, unsupported-effect app contract fixture for root.
4. Run affected checks and report transport parity.

Deletion list: none expected; replace duplicate local capture logic if introduced during work, never add table-diff inference. Complete when capture contract is independently green with no notification imports. This worker does not wire app commits.

## Rules shared by every brief

Read AGENTS.md, docs/agent-workflows.md, and docs/mutation-notifications.md first. You are not alone in the repository: work only in your isolated seeded worktree, preserve others' edits, and do not delegate or widen scope. Root owns shared contracts and cross-cutting write-path wiring; propose contract changes to root before editing them. Never edit another worker's owned files.

Use TDD. Where supplied, copy the .test.ts.txt seed to its destination and observe red before implementation. Report commands and actual counts; do not claim new-feature green from old baseline tests. Run npm run validate and affected npm test; follow the 50-file deferral, empty PR-body and CI rules. No production testing, no broad suite bypass, no hand-edited generated assets. Server/CLI checks use only your task server and allocated port block.

Commit implementation and tests in your worktree. Handoff .agent/REPORT.md with contracts consumed/provided, red/green evidence, checks/deferred CI, remaining risks, commit, and a ===CONCISE=== section. Do not merge or claim integrated feature completion. Stop if another owner's contract is insufficient; send the exact missing requirement to root while continuing independent work.
