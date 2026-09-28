# E — Inbox presentation and delivery-view compatibility

## Responsibility and exclusive files
Own services/app/components/PeopleInbox.tsx, notification-context.ts, relevant notification hook/view components and UI tests; app/api/internal/notifications/route.ts and its focused response tests. C owns DB, membership-inbox.ts and notification projection. Coordinate source type exports through root. No schema or skill changes.

## Contract
Render MutationNotificationView as platform actor + action_text once, link to document, preserve unread/revision behavior. User actor uses a person card; agent provenance is supplementary. Token/anonymous/system fallback labels never impersonate a user or expose identifiers. Block controls exist only when there is a real user to block. Preserve every legacy notification variant and accessible names.

## Order and proof
1. UI tests against seeded view fixtures; include legacy row fixtures and null/nonuser actors.
2. Internal delivery endpoint must expose the same currently authorized view as inbox; no access side door and no raw records/token IDs.
3. Verify keyboard/read behavior and compact/full inbox with real task server after C/root join. Coordinate demo users with F.
4. Document downstream email payload compatibility and preference category; do not send or claim production emails. The downstream repo adapter is a distinct follow-up if unavailable.

Deletion list: replace the mutation fallback to generic 'mentioned you' with explicit variant handling; do not rewrite unrelated inbox UI. Complete when UI/endpoint fixtures and integrated accessible flow pass.

## Rules shared by every brief

Read AGENTS.md, docs/agent-workflows.md, and docs/mutation-notifications.md first. You are not alone in the repository: work only in your isolated seeded worktree, preserve others' edits, and do not delegate or widen scope. Root owns shared contracts and cross-cutting write-path wiring; propose contract changes to root before editing them. Never edit another worker's owned files.

Use TDD. Where supplied, copy the .test.ts.txt seed to its destination and observe red before implementation. Report commands and actual counts; do not claim new-feature green from old baseline tests. Run npm run validate and affected npm test; follow the 50-file deferral, empty PR-body and CI rules. No production testing, no broad suite bypass, no hand-edited generated assets. Server/CLI checks use only your task server and allocated port block.

Commit implementation and tests in your worktree. Handoff .agent/REPORT.md with contracts consumed/provided, red/green evidence, checks/deferred CI, remaining risks, commit, and a ===CONCISE=== section. Do not merge or claim integrated feature completion. Stop if another owner's contract is insufficient; send the exact missing requirement to root while continuing independent work.

Multirow: one logical item per recipient/effect. Invocation grouping is optional presentation only; counts/content must include only currently visible items for that recipient. Preserve each item identity/read state and paginate large lists.
