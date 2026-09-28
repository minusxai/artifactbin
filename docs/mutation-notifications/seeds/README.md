# Behavioral seeds and integration checkpoints

These are executable test source templates, deliberately not discovered by normal test runs until the owning feature is implemented. Copy unchanged to the paths below before doing the work. This is not an excuse to avoid tests: their actual failing runs have been observed and recorded in the foundation report.

| Seed | Destination | Owner | Observed |
| --- | --- | --- | --- |
| mutation-effect.test.ts.txt | services/sql/__tests__/mutation-effect.test.ts | A | 6 expected semantic failures |
| mutation-notification-decl.test.ts.txt | services/app/lib/story/__tests__/mutation-notification-decl.test.ts | B | 4 expected semantic failures |
| headless-operation-guidance.test.ts.txt | services/app/lib/__tests__/headless-operation-guidance.test.ts | F | 3 expected teaching failures |

Run each with `npm test -- --files <destination>`. Extend engine seeds to the existing local/worker × direct/HTTP composition fixture. Add focused rejection tests only once valid syntax works, so refusal tests cannot pass merely because all Notify syntax is unsupported.

## Root-owned integration cases (not yet executed)

Build with real handlers and isolated `services/app/__tests__/harness.ts` state. Existing supporting fixtures: mutate-routes, mutate-edges, cli-mutations, dataset-grants, dataset-policies, notification-activity, and CLI harness. Avoid unrelated broad test runs.

1. Three local accounts: actor, assignee, creator; one testuser. A task row with string ID/title/status and user-typed assignee/created_by. One dataset, saved document, two declared Values plus expected_status, Query tasks, Mutation change_status with Notify. User IDs are real fixture accounts, never invented names.
2. Successful headless mutation: one version change, durable receipt, one source fact, one notification per distinct admitted recipient. Assert message, implicit actor metadata, document/mutation origins, and no record images in API response/event payload.
3. Browser action uses the same declared operation. Drop the committed response, retry same invocation key, compare original/replayed route response shapes and database effect counts. Try same key/different input; refuse. Authorize again before saved result access.
4. Force first CAS attempt to lose with existing invocation test seam; successful second attempt must use its own before and after records. Losing attempt creates no source fact, receipt completion, or inbox rows. Label this simulated contention; real concurrent Postgres proof is CI work.
5. Add deterministic database constraint failures for notification persistence and outbox insertion. Assert dataset head, receipt response, notifications and source fact all roll back. Reset database and limiters between cases.
6. Private dataset behind public document: intended recipient without dataset authority gets no notification. Revoke dataset/document access after creation; inbox and internal delivery endpoint omit content. Existing write policy never grants read permission by implication.
7. Deleted record: authorized-at-commit recipient still receives frozen message while current dataset/document authority remains. Newly granted reader gets no historical backfill. Account/artifact deletion and block behavior follow the agreed retention/access policy.
8. Null/list/duplicate users; bad value types; count/text limits; human self suppression; agent-own-account delivery; testuser→real-user isolation. No raw token identifiers in presentation.
9. Missing browser operation ID on Notify fails before SQL and prompts refresh. Anonymous Notify fails sign-in-required before SQL; anonymous non-Notify behavior unchanged. Stable principal scope and payload fingerprint tested.
10. Old SQL adapter returns success without requested effect: app refuses before commit. Continuation/no-op/exact-one policy respected. Capture field never reaches public replies automatically.
11. Notification UI renders the explicit new view rather than legacy “mentioned you”; user prefix once, nonuser actors honestly, accessible link/read state, valid block controls only for users.
12. Teach and demonstrate real named query/write CLI commands; retain required UI verification for authored features and session fallback for existing row/cell-context actions. Prove the final demo against the current task server, not a reused unrelated server.

These cases are acceptance contracts and deterministic fixture instructions, not pre-existing passing tests. Root converts them into runnable tests at each adapter join before implementing/wiring the join. Do not claim red/green evidence until observed.
