/**
 * THE GROUP TREE, as the app reads it: `groups.parent_id` (one parent at most, never a cycle, all in this
 * installation's one database) and the installation's hierarchy revision (`group_hierarchy`, id 'installation').
 * The identity module (@artifactbin/auth identity-store) is their only writer; this file only reads.
 *
 * Membership is DIRECT rows only. What the tree adds is an AUDIENCE: a group reaches the direct members of
 * itself and of every descendant, so a share to Finance reaches a Retail-only member and a share to Retail
 * never reaches a Finance-only member or a sibling. Nothing here grants administration, ownership or an
 * editor role: those stay on the direct membership row (`getGroupRole`).
 *
 * NO LOCKS. A decision reads membership and edges at decision time, inside its own transaction, and neither waits on
 * nor holds up an identity write: a revocation (a removed member, a detached subtree, a deleted group) takes effect
 * from the next decision. Every read here keeps only live groups (`deleted_at IS NULL`), so a deleted group grants
 * nothing to anyone, whatever app rows still name it.
 */
import type {Queryable} from '@artifactbin/contracts';

const REVISION = "group_hierarchy WHERE id='installation'";

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

/** The installation's hierarchy revision as committed (0 before any topology change). */
export async function hierarchyRevision(query: Queryable): Promise<number> {
  return Number((await query.query<{revision: string | number}>(`SELECT revision FROM ${REVISION}`)).rows[0]?.revision ?? 0);
}

/** Each live group's chain: itself, then its parent, up to the root. A missing or deleted group has none. */
async function groupChains(query: Queryable, ids: readonly string[]): Promise<Map<string, string[]>> {
  const chains = new Map<string, string[]>();
  if (!ids.length) return chains;
  for (const row of (await query.query<{start: string; id: string}>(CHAINS_SQL, [[...new Set(ids)]])).rows)
    chains.set(row.start, [...chains.get(row.start) ?? [], row.id]);
  return chains;
}

export async function groupChain(query: Queryable, id: string): Promise<string[]> {
  return (await groupChains(query, [id])).get(id) ?? [];
}

/** Accounts a group's audience holds: the direct members of the group and of every descendant. */
export async function subtreeMemberIds(query: Queryable, groupId: string): Promise<string[]> {
  return (await query.query<{user_id: string}>(`SELECT DISTINCT user_id FROM group_members WHERE group_id IN (${subtreeSql('$1')}) ORDER BY user_id`, [groupId])).rows.map((row) => row.user_id);
}
