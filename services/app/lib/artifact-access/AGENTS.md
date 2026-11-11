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
  reads every fact through `transactionAccessFacts`, which locks each APP fact it reads (shares, group shares) FOR
  SHARE in that statement. Never decide from a fact read before the locks or outside the transaction.
- An insert can narrow a role (a dataset rule matches exactly one role) and an absent row cannot be locked: insert
  or change shares, group shares, link role, visibility and policy only while holding the artifact's row FOR UPDATE.
- Identity facts (accounts, groups, memberships, the tree) are the identity module's rows, read through its views
  (contracts `IDENTITY_VIEWS`) at decision time inside the decision's transaction and NEVER locked: the app role may
  not lock them (validate's table-ownership check refuses it), a decision never waits for or blocks an identity write,
  and a membership granted or revoked, a subtree moved or a group deleted takes effect from the next decision. A
  deleted group grants nothing: every read keeps `deleted_at IS NULL`, whatever app rows still name the group.
- Groups form one tree (lib/groups hierarchy). Shares and a group-owned row's member audience reach a group's
  subtree in both languages (`reachedGroupsSql`, `groupAudience`); ownership and editor powers stay on direct rows.
  The hierarchy revision is a counter identity moves on every topology change (readers of the tree may watch
  it), not a lock.
- Facts read inside a write are read-only: never stamp or update a fact row while deciding (an upgraded share
  lock deadlocks two readers of one page). Unresolved invitations are stamped by ordinary reads only.
- A writer that cannot follow the order runs its whole transaction under lib/platform `retryOnConflict`. An app
  invariant keyed on an account (a quota, a count) serializes on lib/platform `lockSubjects`, never the account row.
- A new writer of these tables joins the lock-order trace in `services/app/__tests__/page-sql-door-locks.test.ts`
  ("every writer locks its artifacts by tier and lockOrder, before its facts"); a new tier or tail joins the
  order list in the `locks.ts` header.

## Checks
- `npm test -- --files services/app/lib/artifact-access/__tests__/access.test.ts services/app/lib/artifact-access/__tests__/grants.test.ts services/app/lib/artifact-access/__tests__/group-shares.test.ts services/app/lib/artifact-access/__tests__/proofs.test.ts services/app/lib/artifact-access/__tests__/subgroups.test.ts services/app/lib/dataset-permissions/__tests__/role.test.ts services/app/__tests__/page-sql-door-locks.test.ts`
- `__tests__/lock-order-postgres.test.ts` is the two-connection Postgres regression (subtree cases, identity changes
  not waiting, the next decision refusing); `services/app/lib/platform/__tests__/identity-roles-postgres.test.ts` proves the
  split-role grants. Both run only where Docker has the Postgres image (CI's integration project, locally
  `npm run test:integration -- <file>`) and are skipped elsewhere.
