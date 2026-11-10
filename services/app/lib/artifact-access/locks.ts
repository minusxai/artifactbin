/**
 * THE AUTHORIZATION LOCK ORDER. A write that decides access inside its transaction locks the
 * artifacts it goes through first, in ONE global order, and then decides; every fact the decision reads (a share,
 * a group share, a membership, an account) locks exactly the rows it reads, FOR SHARE, as it reads them
 * (./access-facts `transactionAccessFacts`). So a revocation of anything the decision used (an UPDATE or DELETE of
 * one of those rows) waits for the write's commit, and one that committed first is what the decision reads
 * (Postgres READ COMMITTED takes each later statement's snapshot after the earlier locks are granted).
 *
 * INSERTS CAN NARROW TOO. Dataset rules match exactly one role, so a NEW row can take access away: a membership in a
 * group with a viewer share, or a viewer named share, turns `signed_in` (allowed) into `viewer` (denied). An absent
 * row cannot be locked, so each such insert is serialized through the parent row its writer locks first:
 *  - named shares, group shares, link role, visibility, owning group, policy: the artifact's own row, which this
 *    write holds (step 1 or 2) — every writer of them locks the artifact FOR UPDATE first;
 *  - memberships: the group's row, which the decision takes FOR SHARE for every group that could change the role
 *    (the artifact's owning group and every group its group shares name, joined or not) — every membership writer
 *    locks the group AND ALL ITS ANCESTORS FOR UPDATE first (lib/groups lockMembershipGroups), so a new membership
 *    anywhere in a shared group's subtree (which that share reaches) waits for the decision too.
 * The remaining facts are existing rows (the accounts' kinds), locked as they are read. Editor-group trust only widens
 * (it admits `backend_only` rules, it never changes the role). Facts the decision did not read are not locked.
 *
 * THE TREE. A group share and a group-owned row reach a subtree (lib/groups hierarchy), so a decision enumerates
 * edges. Step 0 holds the installation's hierarchy guard row FOR SHARE for the whole transaction; every topology
 * mutation (group create, delete, reparent) takes it exclusively as its first statement, so no edge moves under a
 * decision in flight, and a move committed first is what the decision reads.
 *
 * The order, on the normal path:
 *
 *   0. the hierarchy guard (`group_hierarchy`), FOR SHARE, at the transaction's start — never upgraded
 *   1. documents: the page a write goes through, and the documents its user columns' memberOf names, by `lockOrder`
 *   2. datasets: the dataset written (FOR UPDATE) and those its values were read from (FOR SHARE), by `lockOrder`
 *   3. facts, as the decision reads them: shares, group shares, groups (the owning and shared groups, in
 *      `id COLLATE "C"` order), memberships (in those groups' subtrees), accounts
 *
 * Two tails come after the artifacts too: a transaction that activates scheduled functions locks each affected
 * publisher's `users` row FOR UPDATE, by `lockOrder`, as a step-3 fact (lib/artifacts schedule-capacity.ts); a page
 * function call's write locks its schedule row FOR SHARE last (lib/function-schedules claims.ts), which is neither an
 * artifact nor an access fact.
 *
 * Writers that lock several artifacts take them by `lockOrder` too (publishing a page locks it, then its linked
 * datasets). SQL that locks artifacts in one statement orders `id COLLATE "C"`, the same code-unit order.
 *
 * THE SAFETY NET. Not every writer can follow this order (a group's deletion locks the group before the shares
 * that name it; erasing a test user locks its account first; a group-owned publish locks the group before the
 * page), and facts are read in the decision's order. When two writers meet in opposite orders, Postgres aborts one
 * with 40P01: nothing of it commits, so no write ever lands under stale authority. Guarded writes and those competing
 * writers run their whole transaction under lib/platform `retryOnConflict` (bounded, jittered), and answer a
 * retryable conflict when it is exhausted. Correctness rests on locking what is read before deciding; the order only
 * keeps the retries rare.
 *
 * Pinned by services/app/__tests__/page-sql-door-locks.test.ts ("lock order") and the two-connection Postgres
 * regression services/app/lib/artifact-access/__tests__/lock-order-postgres.test.ts.
 */
import type { Queryable } from '@artifactbin/contracts';
import { lockHierarchy } from '@/lib/groups';

/** The one order every multi-artifact lock takes: code units (ids are ASCII), identical to SQL `COLLATE "C"`. */
export const lockOrder = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export interface AuthorizationLocks {
  /** The page a write goes through (step 1). */
  page?: string | null;
  /** Documents the write's user columns name in memberOf (step 1). */
  documents?: readonly string[];
  /** The dataset written, locked FOR UPDATE (step 2). */
  write?: string | null;
  /** Datasets the write's values were read from, locked FOR SHARE (step 2). */
  read?: readonly string[];
}

/** Steps 0–2: the hierarchy guard, then the artifacts, in the global order. Facts lock themselves as the decision reads them. */
export async function lockAuthorization(tx: Queryable, locks: AuthorizationLocks): Promise<void> {
  await lockHierarchy(tx);
  const write = locks.write ?? null;
  const documents = [...new Set([...(locks.page ? [locks.page] : []), ...(locks.documents ?? [])])].filter((id) => id !== write).sort(lockOrder);
  for (const id of documents) await tx.query('SELECT id FROM artifacts WHERE id=$1 FOR SHARE', [id]);
  const datasets = [...new Set([...(write ? [write] : []), ...(locks.read ?? [])])].filter((id) => !documents.includes(id)).sort(lockOrder);
  for (const id of datasets) await tx.query(`SELECT id FROM artifacts WHERE id=$1 FOR ${id === write ? 'UPDATE' : 'SHARE'}`, [id]);
}
