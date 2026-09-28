# F — Agent instructions, coherent example and runnable workflow demo

## Responsibility and exclusive files
Own services/app/skills/artifactbin/SKILL.md, example.jsx, references/apps.md, live-sessions.md, markup-data.md, markup-data-example.md and relevant additional reference text; services/cli/scripts/compile-teaching.ts; pinned skill/help tests; a new scripts/seed-mutation-notification-demo.mjs (with audited existing environment boundary); demo fixture assets and runbook. Own CLI version release changes in coordination with root after final CLI changes. Do not edit generated teaching.json, parser, transports or inbox components.

## Contract
First-page instructions teach headless named reads and writes through CLI, not raw APIs. Sessions remain for UI QA/local state/row or cell context that CLI rejects. Clearly separate routine operation from testing newly authored actions. Preserve testuser fork, identity/guest verification, one-session rule, and uncertain-write recovery. Fix the generator's false 'dataset target' restriction and inspect publishing-versions for compatible authoring QA wording.

## Order and proof
Draft the fixture scaffold from frozen contracts early; do not wait until integration to start it. Root supplies the integrated app; you own seed data and reproducible test steps.
1. Copy teaching seed and observe three failures. Update first-page/generated help, pinned tests, and relevant references together.
2. Large commented example must declare real user-typed fields used by Notify, rather than inserting task fields into an unrelated sales dataset. Keep actor explanation a short comment beside syntax; both scalar/list recipient forms discoverable.
3. Seed only this task server with local mxmx_test_* accounts. Dataset: id/title/status/assignee/created_by; named read; guarded named change_status(task_id,status,expected_status); browser controls call same declaration. Add null/duplicate/ineligible recipient scenarios. Real user columns, not invented names. Never public-test endpoints.
4. Verify npm run afbin read → named write → read and browser write/inboxes. Root/D provide deterministic replay/failure cases; E owns UI rendering. Keep script repeatable against isolated state and use the owning script config/env boundary.
5. If evals repo is available, add/run a narrowly scoped headless-vs-session agent task there; otherwise report the eval unrun. Update CLI teaching/release checks using branch CLI against current task server.
6. Feature handoff: leave task npm run dev running, provide concrete artifact/inbox URLs and local OTP/login test steps with process ownership. Never substitute a baseline app for implemented Notify behavior.

Deletion list: remove contradictory always-use-session-for-operation wording while retaining authoring QA. Do not create another source publishing-query.md; it is generated. Complete only after actual instruction checks AND integrated workflow demo pass.

## Rules shared by every brief

Read AGENTS.md, docs/agent-workflows.md, and docs/mutation-notifications.md first. You are not alone in the repository: work only in your isolated seeded worktree, preserve others' edits, and do not delegate or widen scope. Root owns shared contracts and cross-cutting write-path wiring; propose contract changes to root before editing them. Never edit another worker's owned files.

Use TDD. Where supplied, copy the .test.ts.txt seed to its destination and observe red before implementation. Report commands and actual counts; do not claim new-feature green from old baseline tests. Run npm run validate and affected npm test; follow the 50-file deferral, empty PR-body and CI rules. No production testing, no broad suite bypass, no hand-edited generated assets. Server/CLI checks use only your task server and allocated port block.

Commit implementation and tests in your worktree. Handoff .agent/REPORT.md with contracts consumed/provided, red/green evidence, checks/deferred CI, remaining risks, commit, and a ===CONCISE=== section. Do not merge or claim integrated feature completion. Stop if another owner's contract is insufficient; send the exact missing requirement to root while continuing independent work.

Required additions: guarded single-task and unguarded bulk action fixtures; mixed recipients and same-recipient multiple effects. Own deterministic branch-CLI workflow smoke plus behavioral agent-eval task/rubric described in the parent contract. Eval code belongs to the separate evals repo if available; report unrun explicitly if absent.
