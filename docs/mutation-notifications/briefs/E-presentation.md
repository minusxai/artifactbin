# E — Inbox, current access and job status presentation

## Responsibility and exclusive files
Own PeopleInbox.tsx, notification-context/hooks, membership-inbox.ts read projection, app/api/internal/notifications/route.ts and focused tests; minimal existing owner/originator action UI for job status/retry. C owns storage/status service, D public operation transports. Coordinate shared access helper changes through A/root. No schema, parser or teaching edits.

## Contract
Render platform actor as trigger attribution and plain message separately; avoid automatically prefixing the message with a verb falsely attributing current state. Real person cards for users; honest deleted/nonuser labels, no raw token IDs. Preserve all legacy variants, block controls only for real users, read revisions and accessibility.

Recheck current document plus every saved required source using A/C authority helpers before inbox/internal delivery exposure. Private source refs never cross public wire. Optional visual grouping uses recipient-visible items only and preserves item identity/read state. Expose authorized pending/retrying/completed/failed state with safe codes and retry control through D/C, not raw SQL/parameters. Query failures must be visible beyond logs.


Use the returned mutationRunId and D/C authorized list-by-run service to discover all job statuses. Do not invent a hidden job ID discovery path.
## Order and proof
1. UI fixtures: actor plus current-state message, legacy variants, nonuser/deleted actor, empty list, multiple output rows and keyboard/read controls.
2. Read projection tests: revoke any joined/filter-only source, source/document deletion, current ownership, block changes; hidden content stays out of internal delivery too.
3. Status/retry tests: authorized originator/manager, ordinary reader denial, failed-job recovery without rerunning mutation. Integrated task-server checks with F.
4. Document downstream email view compatibility; no production send or deployment-repo implementation claim.

## Rules shared by every brief

Read AGENTS.md, docs/agent-workflows.md, and docs/mutation-notifications.md first. You are not alone in the repository: work only in your isolated seeded worktree, preserve others' edits, and do not delegate or widen scope. Root owns shared contracts and cross-cutting write-path wiring; propose contract changes to root before editing them. Never edit another worker's owned files.

Use TDD. Where supplied, copy the .test.ts.txt seed to its destination and observe red before implementation. Report commands and actual counts; do not claim new-feature green from old baseline tests. Run npm run validate and affected npm test; follow the 50-file deferral, empty PR-body and CI rules. No production testing, no broad suite bypass, no hand-edited generated assets. Server/CLI checks use only your task server and allocated port block.

Commit implementation and tests in your worktree. Handoff .agent/REPORT.md with contracts consumed/provided, red/green evidence, checks/deferred CI, remaining risks, commit, and a ===CONCISE=== section. Do not merge or claim integrated feature completion. Stop if another owner's contract is insufficient; send the exact missing requirement to root while continuing independent work.
