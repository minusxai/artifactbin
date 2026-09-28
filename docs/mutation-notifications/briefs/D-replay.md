# D — Browser invocation identity, recovery and provenance

## Responsibility and exclusive files
Own new services/app/lib/mutation-operation.ts, mutation-receipt.ts, story/mutation-request.ts, story-runtime mutation request/store/fetch/relay transport paths, app/a/[id]/mutate/route.ts, API operation context/registry transport plumbing, and their replay/provenance tests. Keep shared type changes coordinated with root. Root alone changes artifacts.ts/dataset-mutate.ts/artifact-wire.ts/mutation-invocation.ts. No notification schema/inbox files.

## Contract
One key per gesture; preserve it through direct/relay calls, pending responses and lost-response recovery. Canonical input includes exact explicit args/row/value/tz/expected-state context; bind declaration head inside durable invocation. Require authenticated user/token scope for Notify; anonymous non-Notify stays unchanged. Existing scopes authorize before replay; no shared null-principal replay identity. Reject missing-key Notify before SQL with operation_key_required (browser may refresh; API/CLI must retain a key). Anonymous execution uses sign-in-required, a separate refusal. Freeze initiator at claim. Completed receipt lookup follows document/principal authorization but precedes current named-declaration lookup; removal/rename must not prevent authorized recovery.

Principal comes from authentication. Agent transport classification is descriptive and may use existing self-reported labels; never authorize based on it. Pass initiator to root's write seam. Use the seeded MutationOperationRequest and MutationOperationSuccess canonical types and route adapters so first/replayed browser/API replies match; existing dataset-shaped receipt cannot silently replace a document-shaped response.

## Order and proof
1. Seed normalizer and receipt adapter tests before adding browser plumbing; root reviews exact input/outcome adapter interface.
2. Fault-test key mismatch, pending, uncertainty, lost response, revoked caller, changed declaration and unsupported old clients. Invalid requests fail before persistent SQL.
3. Test direct/relay and current Solid/legacy paths without notification storage using a bounded mutation fixture callback.
4. Give root the adapter integration points and canonical outcome mapping; do not edit root-owned write implementation to force integration.

Deletion list: consolidate duplicate browser/API replay logic introduced here. Do not build a second journal/receipt store. Complete when replay/provenance tests pass and shared write hook can call your adapter.

## Rules shared by every brief

Read AGENTS.md, docs/agent-workflows.md, and docs/mutation-notifications.md first. You are not alone in the repository: work only in your isolated seeded worktree, preserve others' edits, and do not delegate or widen scope. Root owns shared contracts and cross-cutting write-path wiring; propose contract changes to root before editing them. Never edit another worker's owned files.

Use TDD. Where supplied, copy the .test.ts.txt seed to its destination and observe red before implementation. Report commands and actual counts; do not claim new-feature green from old baseline tests. Run npm run validate and affected npm test; follow the 50-file deferral, empty PR-body and CI rules. No production testing, no broad suite bypass, no hand-edited generated assets. Server/CLI checks use only your task server and allocated port block.

Commit implementation and tests in your worktree. Handoff .agent/REPORT.md with contracts consumed/provided, red/green evidence, checks/deferred CI, remaining risks, commit, and a ===CONCISE=== section. Do not merge or claim integrated feature completion. Stop if another owner's contract is insufficient; send the exact missing requirement to root while continuing independent work.
