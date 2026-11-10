/**
 * THE GROUP TREE: `groups.parent_id` (one parent at most, never a cycle, all in this installation's one
 * database) and the installation's hierarchy guard row (`group_hierarchy`, id 'installation').
 *
 * Membership is DIRECT rows only. What the tree adds is an AUDIENCE: a group reaches the direct members of
 * itself and of every descendant, so a share to Finance reaches a Retail-only member and a share to Retail
 * never reaches a Finance-only member or a sibling. Nothing here grants administration, ownership or an
 * editor role: those stay on the direct membership row (`getGroupRole`).
 *
 * LOCKING (lib/artifact-access locks.ts, step 0 and the group tail):
 *  - a decision that enumerates the tree holds the guard FOR SHARE (`lockHierarchy`) before reading it;
 *  - a topology mutation (create, delete, reparent) bumps the revision as its FIRST statement
 *    (`bumpHierarchy`), which holds the guard exclusively until commit, so no decision runs halfway across a
 *    change of edges and every change moves `hierarchy_revision`;
 *  - a membership mutation holds the guard FOR SHARE, then its group and every ancestor FOR UPDATE in
 *    `id COLLATE "C"` order (`lockMembershipGroups`). A decision reading a share to an ancestor holds that
 *    ancestor FOR SHARE, so even a NEW descendant membership waits for it.
 */
import type {Queryable} from '@artifactbin/contracts';

const GUARD = "group_hierarchy WHERE id='installation'";

/** SQL: ids of the live groups `user` reaches — its direct memberships and all their ancestors. */
export const reachedGroupsSql = (user: string): string =>
  `WITH RECURSIVE reach(id) AS (SELECT gm.group_id FROM group_members gm JOIN groups g ON g.id=gm.group_id WHERE gm.user_id=${user} AND g.deleted_at IS NULL UNION SELECT p.id FROM reach r JOIN groups c ON c.id=r.id JOIN groups p ON p.id=c.parent_id WHERE p.deleted_at IS NULL) SELECT id FROM reach`;

/** SQL: ids of `group` (when live) and every live descendant. */
export const subtreeSql = (group: string): string =>
  `WITH RECURSIVE subtree(id) AS (SELECT g.id FROM groups g WHERE g.id=${group} AND g.deleted_at IS NULL UNION SELECT c.id FROM subtree s JOIN groups c ON c.parent_id=s.id WHERE c.deleted_at IS NULL) SELECT id FROM subtree`;

/** SQL over `$1` (text[]): each listed live group and its live ancestors, with the depth below the first. */
const CHAINS_SQL = `WITH RECURSIVE chain(start,id,parent_id,depth) AS (SELECT id,id,parent_id,0 FROM groups WHERE id=ANY($1::text[]) AND deleted_at IS NULL
  UNION ALL SELECT c.start,p.id,p.parent_id,c.depth+1 FROM chain c JOIN groups p ON p.id=c.parent_id WHERE p.deleted_at IS NULL AND c.depth<10000)
  SELECT start,id FROM chain ORDER BY start,depth`;

/** Step 0 of the authorization order: the guard FOR SHARE. Re-taking it in one transaction takes nothing new. */
export async function lockHierarchy(tx: Queryable): Promise<void> {
  await tx.query(`SELECT revision FROM ${GUARD} FOR SHARE`);
}

/** A topology mutation's first statement: the guard exclusively, and the revision moved. Rolled back with it. */
export async function bumpHierarchy(tx: Queryable): Promise<number> {
  const row = (await tx.query<{revision: string | number}>(
    "INSERT INTO group_hierarchy(id,revision) VALUES('installation',1) ON CONFLICT (id) DO UPDATE SET revision=group_hierarchy.revision+1 RETURNING revision",
  )).rows[0];
  return Number(row?.revision ?? 0);
}

/** The installation's hierarchy revision as committed (0 before any topology change). */
export async function hierarchyRevision(query: Queryable): Promise<number> {
  return Number((await query.query<{revision: string | number}>(`SELECT revision FROM ${GUARD}`)).rows[0]?.revision ?? 0);
}

/** Each live group's chain: itself, then its parent, up to the root. A missing or deleted group has none. */
export async function groupChains(query: Queryable, ids: readonly string[]): Promise<Map<string, string[]>> {
  const chains = new Map<string, string[]>();
  if (!ids.length) return chains;
  for (const row of (await query.query<{start: string; id: string}>(CHAINS_SQL, [[...new Set(ids)]])).rows)
    chains.set(row.start, [...chains.get(row.start) ?? [], row.id]);
  return chains;
}

export async function groupChain(query: Queryable, id: string): Promise<string[]> {
  return (await groupChains(query, [id])).get(id) ?? [];
}

/**
 * A MEMBERSHIP MUTATION'S LOCKS: the guard FOR SHARE, then every listed live group and all its ancestors FOR
 * UPDATE, in one statement ordered `id COLLATE "C"`. Returns the listed groups that are live (others locked nothing).
 */
export async function lockMembershipGroups(tx: Queryable, ids: readonly string[]): Promise<Set<string>> {
  await lockHierarchy(tx);
  const chains = await groupChains(tx, ids);
  const all = [...new Set([...chains.values()].flat())];
  if (all.length) await tx.query('SELECT id FROM groups WHERE id=ANY($1::text[]) ORDER BY id COLLATE "C" FOR UPDATE', [all]);
  return new Set(chains.keys());
}

/** Accounts a group's audience holds: the direct members of the group and of every descendant. */
export async function subtreeMemberIds(query: Queryable, groupId: string): Promise<string[]> {
  return (await query.query<{user_id: string}>(`SELECT DISTINCT user_id FROM group_members WHERE group_id IN (${subtreeSql('$1')}) ORDER BY user_id`, [groupId])).rows.map((row) => row.user_id);
}
