# F — Agent guidance, smoke/eval and running demo

## Responsibility and exclusive files
Own services/app/skills/artifactbin/SKILL.md, example.jsx and related references; services/cli/scripts/compile-teaching.ts and pinned teaching/help tests; new task-server demo seed/runbook and deterministic workflow smoke. Own eval task/rubric, and separate eval-repo change if available. Coordinate CLI version release with root. Do not edit generated teaching.json or runtime feature modules.

## Contract
Teach headless named query/write for existing artifacts; retain sessions for UI QA/new actions/local state/unsupported row-cell context. Preserve identity/guest/testuser fork, one-session and uncertain-write rules. Fix generator's false dataset-only write restriction. Large commented example shows standalone Notify with a schema-coherent tasks Import/user fields and one short rendered-result comment. Explain current-state semantics, saved run inputs, asynchronous status and retry without rerunning the mutation.

Own deterministic branch CLI + browser smoke and behavioral agent eval, not just wording tests. Eval cases: headless existing operation, session QA for newly authored actions, session fallback for local/row context. Grade tool trace and state; separate private evals repo is absent, so execution remains unrun until available. No production testing.


Discover job status through mutation reply mutationRunId plus authorized list-by-run; smoke tests must check this actual public path and identical replay discovery.
## Order and proof
1. Copy existing teaching seed, observe semantic red, update generator/source/pinned tests together. Keep a parameter-only named operation usable via CLI.
2. Draft demo fixture early: local mxmx_test_* actor/recipients, task/user fields, read query, single guarded action plus bulk action, standalone rule joining/aggregating supported data. Seed null/duplicate/ineligible recipients and a recoverable failed job.
3. Smoke: branch CLI read→named write→read; poll bounded job completion; check inbox; replay same run; deliberate second run; zero output; browser same action; row-context fallback; failed query/retry without extra mutation. Assert persisted state and accessible UI.
4. Add/run eval in its own repository when available; otherwise provide exact tasks/rubric and report unrun. Do not treat deterministic smoke as observed agent behavior.
5. Final feature handoff: task npm run dev remains running, artifact/inbox/job-status URLs, local OTP/login instructions, process ownership. Root integrates server; F proves runnable workflow. No baseline server substitute.

## Rules shared by every brief

Read AGENTS.md, docs/agent-workflows.md, and docs/mutation-notifications.md first. You are not alone in the repository: work only in your isolated seeded worktree, preserve others' edits, and do not delegate or widen scope. Root owns shared contracts and cross-cutting write-path wiring; propose contract changes to root before editing them. Never edit another worker's owned files.

Use TDD. Where supplied, copy the .test.ts.txt seed to its destination and observe red before implementation. Report commands and actual counts; do not claim new-feature green from old baseline tests. Run npm run validate and affected npm test; follow the 50-file deferral, empty PR-body and CI rules. No production testing, no broad suite bypass, no hand-edited generated assets. Server/CLI checks use only your task server and allocated port block.

Commit implementation and tests in your worktree. Handoff .agent/REPORT.md with contracts consumed/provided, red/green evidence, checks/deferred CI, remaining risks, commit, and a ===CONCISE=== section. Do not merge or claim integrated feature completion. Stop if another owner's contract is insufficient; send the exact missing requirement to root while continuing independent work.
