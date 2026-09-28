# B — Notify grammar, compilation and pure resolution

## Responsibility and exclusive files
Own services/app/lib/story/dataflow.ts, helmet.ts, compiled-dataflow.ts, compile-dataflow.ts, parsed-artifact-metadata.ts; necessary bounded lib/jsx parser/serializer/validation changes; new lib/story/mutation-notification.ts pure parser/resolver; declaration/compile/roundtrip tests. Own notification metadata projection in compiled-page/bundle.server.ts only; coordinate any other renderer edits with root. Do not touch skill text, SQL engine, DB, notification storage, or UI inbox files.

## Contract
Use shared MutationNotificationSpec exactly. Preserve one SQL child plus optional Notify. Before/after are notification-only scoped fields. Normalize scalar/list/null/quoted-ref forms. Check recipient user columns, message scalar columns, impossible insert/delete sides, local/nonphysical targets and exact-one count. Resolver returns candidate IDs/actionText, never authorization. Enforce count/text limits as specified. No arbitrary JSX evaluator or browser Notify execution.

## Order and proof
1. Copy declaration seed, observe its four semantic failures.
2. Implement grammar/resolver and add positive/negative shape tests with useful error spans.
3. Compile against target column metadata; add notify to compiled flow and strict stored schema with revision bump. Preserve declaration invalidation when only message/recipients change.
4. Verify repeated serialization, CLI local compilation, SSR/legacy validation defense, and client projection preserves needed mutation operation metadata.

Deletion list: no general runtime or framework removal. Remove any duplicated parsing paths created by this change. Complete when authored Notify compiles safely into the seeded inert contract and root/C can consume it; no dependency on actual delivery.

## Rules shared by every brief

Read AGENTS.md, docs/agent-workflows.md, and docs/mutation-notifications.md first. You are not alone in the repository: work only in your isolated seeded worktree, preserve others' edits, and do not delegate or widen scope. Root owns shared contracts and cross-cutting write-path wiring; propose contract changes to root before editing them. Never edit another worker's owned files.

Use TDD. Where supplied, copy the .test.ts.txt seed to its destination and observe red before implementation. Report commands and actual counts; do not claim new-feature green from old baseline tests. Run npm run validate and affected npm test; follow the 50-file deferral, empty PR-body and CI rules. No production testing, no broad suite bypass, no hand-edited generated assets. Server/CLI checks use only your task server and allocated port block.

Commit implementation and tests in your worktree. Handoff .agent/REPORT.md with contracts consumed/provided, red/green evidence, checks/deferred CI, remaining risks, commit, and a ===CONCISE=== section. Do not merge or claim integrated feature completion. Stop if another owner's contract is insufficient; send the exact missing requirement to root while continuing independent work.
