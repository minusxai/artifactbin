# artifact-access

The access rule for artifacts (see `index.ts`): row scopes, the role lattice, access facts, grants and
capabilities. Nothing here writes the artifacts table.

## Lock order

A write that decides access inside its transaction is correct because of one rule, and fast because of a second.

**Correctness: lock what the decision reads, before it decides.** The commit first locks the artifacts it goes
through (`locks.ts`, `lockAuthorization`). Then every fact the decision reads (a share, a group share, a membership,
an account) locks exactly the rows it reads, `FOR SHARE`, in the statement that reads them
(`access-facts.ts`, `transactionAccessFacts`). A revocation is an UPDATE or DELETE of one of those rows. It either
committed first, in which case the decision reads it (READ COMMITTED gives each statement a fresh snapshot after its
locks), or it waits for the write's commit.

**Absence: an insert can narrow a role too.** Dataset rules match exactly one role, so a new row can take access
away: joining a group with a viewer share, or a new viewer named share, turns `signed_in` (allowed) into `viewer`
(denied). An absent row cannot be locked, so each such insert is serialized through the parent row its writer locks
first:

- Named shares, group shares, link role, visibility, the owning group and the policy are inserted or changed only
  under the artifact's own row lock (sharing edits, membership invites, `setArtifactGroupShare`, replace), and the
  write holds that row.
- Memberships are inserted only under the group's row lock (invitation acceptance, the deployment's default group).
  The decision locks, `FOR SHARE`, every group that could change the role: the owning group, and every group named by
  the artifact's group shares, whether or not the actor has joined it.
- The accounts' kinds are existing rows, locked as they are read. Editor-group trust only widens: it admits
  `backend_only` rules and never changes the role.

Each pattern has a two-connection Postgres case that inserts the absent fact during an in-flight write.

Facts the decision never read are not locked. Transaction-bound facts are read-only: an unresolved invitation is matched by
email and stamped only by ordinary reads, never inside a write, so two readers of one page never upgrade a share lock.

**The normal path: one order for artifacts.**

1. documents: the page a write goes through, and the documents its user columns name in `memberOf`
2. datasets: the one written (`FOR UPDATE`), then those its values were read from (`FOR SHARE`)

A transaction that activates scheduled functions (lib/artifacts `schedule-capacity.ts`: create, fork, publication,
revert, trash restore) then locks each affected publisher's `users` row FOR UPDATE, in `lockOrder`, as a fact of step
3 after its artifacts, and counts the publisher's active schedules. A page function call's write locks its schedule
row (lib/function-schedules `claims.ts`) FOR SHARE last; that row is neither an artifact nor an access fact.

Within each tier, artifacts are ordered by `lockOrder` (code units; ids are ASCII), and SQL that locks several
artifacts in one statement orders `id COLLATE "C"`, the same order. Every multi-artifact writer uses it: publishing a
page locks it, then its datasets; `memberOf` validation; transfers. Facts come after the artifacts, in the order the
decision happens to read them.

**The safety net: retry deadlocks and serialization failures.** Some writers cannot follow the order. A group
deletion locks the group before the shares that name it. A test user's erasure locks the account first. A
group-owned publish locks the group before the page. Facts are also read in decision order. When two writers meet in
opposite orders, Postgres aborts one with `40P01`, or `40001` for serialization: nothing of it commits, so no write
ever lands under stale authority. Every guarded write (`mutateDataset`, so the page SQL door, page GraphQL and
`caps.query`) and every such competing writer runs its whole transaction under lib/platform `retryOnConflict`. That
is 4 attempts with jittered backoff; when they are exhausted it answers a retryable conflict (dataset writes:
`dataset_changed`, 409; other routes: 503 `conflict`). A write's durable receipt is claimed outside the retried
transaction and completed inside it, so a retried write applies at most once.

Why that is enough: correctness comes from the first rule alone, since every fact is locked before it is used and an
aborted attempt commits nothing. The order only keeps aborts rare, and the retry turns the remaining ones into a
short wait.

A new writer of these tables takes artifacts by tier and `lockOrder` where it can, runs its transaction under
`retryOnConflict` where it cannot, and adds itself to the lock-order trace in
`services/app/__tests__/page-sql-door.test.ts`. The two-connection Postgres regression is
`__tests__/lock-order-postgres.test.ts`.
