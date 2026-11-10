# Artifact access

The access rule for artifacts, in JavaScript (`access.ts`) and in SQL (`scopes.ts`): ownership, the role lattice,
access facts, dataset grant context, capabilities and the authorization lock order (`locks.ts`). It writes no
artifact row; lib/artifacts does. Server-only, entered through `index.ts`.

## Rules
- Change the rule in both languages in one edit: `access.ts` and `scopes.ts` must give every actor the same role.
- What a public or unlisted link grants: `linkRoleOf` (the row's `link_role`, viewer when null; nothing on a private
  row), capped at `ANONYMOUS_CEILING` (viewer) for a caller with no account, a guest, or a test user outside its
  sandbox. It never grants ownership (delete, sharing), never puts a row in a listing (listings read
  `roleWithoutLink`), and on a dataset it is one input to the dataset's single role: what that role may write is
  the dataset's own rules, never the link.
- Lock before deciding. A write that decides access inside its transaction calls `lockAuthorization` first
  (documents, then datasets, each tier by `lockOrder`; SQL locking several rows orders `id COLLATE "C"`), then
  reads every fact through `transactionAccessFacts`, which locks each row it reads FOR SHARE in that statement.
  Never decide from a fact read before the locks or outside the transaction.
- An insert can narrow a role (a dataset rule matches exactly one role) and an absent row cannot be locked: insert
  or change shares, group shares, link role, visibility and policy only while holding the artifact's row FOR
  UPDATE, and memberships only while holding the group's row FOR UPDATE.
- Facts read inside a write are read-only: never stamp or update a fact row while deciding (an upgraded share
  lock deadlocks two readers of one page). Unresolved invitations are stamped by ordinary reads only.
- A writer that cannot follow the order (it locks a group or an account first) runs its whole transaction under
  lib/platform `retryOnConflict`.
- A new writer of these tables joins the lock-order trace in `services/app/__tests__/page-sql-door.test.ts`
  ("every writer locks its artifacts by tier and lockOrder, before its facts"); a new tier or tail joins the
  order list in the `locks.ts` header.

## Checks
- `npm test -- --files services/app/lib/artifact-access/__tests__/access.test.ts services/app/lib/artifact-access/__tests__/grants.test.ts services/app/lib/artifact-access/__tests__/group-shares.test.ts services/app/lib/artifact-access/__tests__/proofs.test.ts services/app/lib/dataset-permissions/__tests__/role.test.ts services/app/__tests__/page-sql-door.test.ts`
- `__tests__/lock-order-postgres.test.ts` is the two-connection Postgres regression; it runs only where Docker
  has the Postgres image (CI's integration project) and is skipped elsewhere.
