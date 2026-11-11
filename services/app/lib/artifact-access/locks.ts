/**
 * THE AUTHORIZATION LOCK ORDER. A write that decides access inside its transaction locks the artifacts it goes
 * through first, in ONE global order, and then decides; every APP fact the decision reads (a named share, a group
 * share) locks exactly the rows it reads, FOR SHARE, as it reads them (./access-facts `transactionAccessFacts`). So a
 * revocation of one of those rows waits for the write's commit, and one that committed first is what the decision
 * reads (Postgres READ COMMITTED takes each later statement's snapshot after the earlier locks are granted).
 *
 * INSERTS CAN NARROW TOO. Dataset rules match exactly one role, so a NEW row can take access away (a viewer named
 * share turns `signed_in` into `viewer`). Named shares, group shares, link role, visibility, owning group and policy
 * are written only while holding the artifact's own row, which this write holds (step 1 or 2).
 *
 * IDENTITY IS NOT LOCKED. Accounts, groups, memberships and the tree are the identity module's rows
 * (contracts `IDENTITY_OWNED_TABLES`; the app role holds SELECT only on them in a split-role database). A decision
 * reads them at decision time inside its own transaction and takes no lock on them, so it never waits for, or holds
 * up, an identity write: a membership granted or revoked, a subtree moved, a group deleted takes effect from the next
 * decision. The hierarchy revision (`group_hierarchy`) is a counter readers of the tree may watch, not a lock.
 *
 * The order, on the normal path:
 *
 *   1. documents: the page a write goes through, and the documents its user columns' memberOf names, by `lockOrder`
 *   2. datasets: the dataset written (FOR UPDATE) and those its values were read from (FOR SHARE), by `lockOrder`
 *   3. app facts, as the decision reads them: named shares, group shares
 *
 * Writers that lock several artifacts take them by `lockOrder` too (publishing a page locks it, then its linked
 * datasets). SQL that locks artifacts in one statement orders `id COLLATE "C"`, the same code-unit order.
 *
 * THE SAFETY NET. Not every writer can follow this order (erasing a test user takes its artifacts by owner). When two
 * writers meet in opposite orders, Postgres aborts one with 40P01: nothing of it commits, so no write ever lands under
 * stale authority. Guarded writes and those competing writers run their whole transaction under lib/platform
 * `retryOnConflict` (bounded, jittered), and answer a retryable conflict when it is exhausted. Correctness rests on
 * locking what is read before deciding; the order only keeps the retries rare.
 *
 * Pinned by services/app/__tests__/page-sql-door-locks.test.ts ("lock order") and the two-connection Postgres
 * regression services/app/lib/artifact-access/__tests__/lock-order-postgres.test.ts.
 */
import type { Queryable } from '@artifactbin/contracts';

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

/** Steps 1–2: the artifacts, in the global order. App facts lock themselves as the decision reads them. */
export async function lockAuthorization(tx: Queryable, locks: AuthorizationLocks): Promise<void> {
  const write = locks.write ?? null;
  const documents = [...new Set([...(locks.page ? [locks.page] : []), ...(locks.documents ?? [])])].filter((id) => id !== write).sort(lockOrder);
  for (const id of documents) await tx.query('SELECT id FROM artifacts WHERE id=$1 FOR SHARE', [id]);
  const datasets = [...new Set([...(write ? [write] : []), ...(locks.read ?? [])])].filter((id) => !documents.includes(id)).sort(lockOrder);
  for (const id of datasets) await tx.query(`SELECT id FROM artifacts WHERE id=$1 FOR ${id === write ? 'UPDATE' : 'SHARE'}`, [id]);
}
