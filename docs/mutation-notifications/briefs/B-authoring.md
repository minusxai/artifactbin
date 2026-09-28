# B — Standalone Notify grammar and compilation

## Responsibility and exclusive files
Own services/app/lib/story/dataflow.ts, helmet.ts, compiled-dataflow.ts, compile-dataflow.ts, parsed-artifact-metadata.ts; necessary lib/jsx validation/serializer changes; standalone declaration/compiler tests; server metadata projection in compiled-page/bundle.server.ts. No evaluator, worker, DB, transport, teaching or inbox edits.

## Contract
Direct Helmet <Notify name="..." on="mutation_name">{SQL}</Notify>. Static read-only SQL, exact to/message result columns; linked persistent mutation, document-unique name, no nested Notify/before/after/actor API. Compile mutations first. Notification params must come from linked mutation effective bindings plus allowed saved platform values, not arbitrary new caller args or browser state. Keep Notify separate from ordinary Query scheduling. Preserve all source dependencies for A/C/E admission, including filter-only reads; reject unsupported lineage.

Compiled notifications need parameter names/types, saved binding requirements, source context and stable rule identity, retained with originating document revision. Use app-owned compiled structures extending inert shared types, never import app/compiler types into contracts. Pin schema/compiler revision and strip unused notification metadata from reader bundles without losing server compilation or markup round trips.

## Order and proof
1. Copy notification-query-decl seed and observe its six semantic failures. Positive syntax support must precede negative tests so unknown-tag rejection is not mistaken for safe compilation.
2. Add missing/duplicate/on reference, wrong result columns, write SQL, parameter-scope, local target, nested/body placement and unsupported dependency tests.
3. Verify source round-trip, notification-only signature invalidation, persisted metadata upgrades, client projection and no query-graph/render execution.
4. Coordinate A/D saved effective binding context; normal Query binding regenerates worker time/identity and is insufficient.

## Rules shared by every brief

Read AGENTS.md, docs/agent-workflows.md, and docs/mutation-notifications.md first. You are not alone in the repository: work only in your isolated seeded worktree, preserve others' edits, and do not delegate or widen scope. Root owns shared contracts and cross-cutting write-path wiring; propose contract changes to root before editing them. Never edit another worker's owned files.

Use TDD. Where supplied, copy the .test.ts.txt seed to its destination and observe red before implementation. Report commands and actual counts; do not claim new-feature green from old baseline tests. Run npm run validate and affected npm test; follow the 50-file deferral, empty PR-body and CI rules. No production testing, no broad suite bypass, no hand-edited generated assets. Server/CLI checks use only your task server and allocated port block.

Commit implementation and tests in your worktree. Handoff .agent/REPORT.md with contracts consumed/provided, red/green evidence, checks/deferred CI, remaining risks, commit, and a ===CONCISE=== section. Do not merge or claim integrated feature completion. Stop if another owner's contract is insufficient; send the exact missing requirement to root while continuing independent work.
