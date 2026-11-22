/**
 * WHAT EVERY GROUP CHANGE CHECKS AND RECORDS (./groups, ./group-members), as plain functions of a query and the
 * tables: a group's live row and a member's direct role; the locks (`lockGroups`, live groups FOR UPDATE in the
 * canonical order); who administers a group (`effectiveAdminVia`, `requireAdmin`); the last-admin rule; the
 * hierarchy revision a topology change moves first (`bumpHierarchy`) and a group's ancestors (`chainOf`); and
 * `recordChange`, which answers a change to the caller and queues its mail in the same transaction.
 */
import {IdentityError, type GroupChange} from '@artifactbin/contracts/identity-module';
import type {GroupRole} from '@artifactbin/contracts/groups';
import type {Queryable} from '@artifactbin/contracts/db';
import {enqueueGroupMail} from './mail';
import {groupAdminsSql} from './rules';
import {reserveHandle} from './accounts';
import {internalId,isUniqueViolation,type IdentityTables} from './tables';

export interface GroupRow {trusted_issuer: string | null; tenancy_id: string | null; id: string; handle: string; name: string; description: string; created_by: string; deleted_at: string | null; parent_id: string | null}

/** The group `userId` effectively administers live `groupId` through (itself, or its nearest ancestor with a direct `admin` row), or null. */
export async function effectiveAdminVia(q: Queryable, t: IdentityTables, userId: string, groupId: string): Promise<string | null> {
  return (await q.query<{via_group_id: string}>(`SELECT ga.via_group_id FROM (${groupAdminsSql(t)}) ga WHERE ga.group_id=$1 AND ga.user_id=$2`, [groupId, userId])).rows[0]?.via_group_id ?? null;
}
/** Every live group `userId` effectively administers, directly or through an ancestor, ordered by id. */
export async function effectiveAdminGroupIds(q: Queryable, t: IdentityTables, userId: string): Promise<string[]> {
  return (await q.query<{group_id: string}>(`SELECT ga.group_id FROM (${groupAdminsSql(t)}) ga WHERE ga.user_id=$1 ORDER BY ga.group_id COLLATE "C"`, [userId])).rows.map(row => row.group_id);
}

/** `userId`'s direct role in live `groupId`, or null. */
export const memberRole = async (q: Queryable, t: IdentityTables, userId: string, groupId: string): Promise<GroupRole | null> =>
  (await q.query<{role: GroupRole}>(`SELECT m.role FROM ${t.group_members} m JOIN ${t.groups} g ON g.id=m.group_id WHERE m.group_id=$1 AND m.user_id=$2 AND g.deleted_at IS NULL`, [groupId, userId])).rows[0]?.role ?? null;
export const liveGroup = async (q: Queryable, t: IdentityTables, id: string): Promise<GroupRow | null> =>
  (await q.query<GroupRow>(`SELECT * FROM ${t.groups} WHERE id=$1 AND deleted_at IS NULL`, [id])).rows[0] ?? null;
export const isTestAccount = async (q: Queryable, t: IdentityTables, userId: string) =>
  (await q.query<{test_account: boolean}>(`SELECT test_account FROM ${t.users} WHERE id=$1`, [userId])).rows[0]?.test_account === true;
/** Lock live groups FOR UPDATE in the canonical order; the ids that were live. */
export const lockGroups = async (q: Queryable, t: IdentityTables, ids: readonly string[]): Promise<Set<string>> => {
  if (!ids.length) return new Set();
  return new Set((await q.query<{id: string}>(`SELECT id FROM ${t.groups} WHERE id=ANY($1::text[]) AND deleted_at IS NULL ORDER BY id COLLATE "C" FOR UPDATE`, [[...new Set(ids)]])).rows.map(row => row.id));
};
/**
 * The actor administers this live group, which is now locked: directly, or through an ancestor (`effectiveAdminVia`).
 * Neither a member nor an admin: `missing` (404); a member without admin anywhere above: forbidden.
 */
export const requireAdmin = async (q: Queryable, t: IdentityTables, actorId: string, id: string, missing = 'not_found') => {
  if (!(await lockGroups(q, t, [id])).has(id)) throw new IdentityError(missing, 404);
  if (await effectiveAdminVia(q, t, actorId, id)) return;
  if (!await memberRole(q, t, actorId, id)) throw new IdentityError(missing, 404);
  throw new IdentityError('forbidden', 403);
};
/** A change may not leave a group without a DIRECT admin: an inherited admin is never counted. */
export const protectLastAdmin = async (q: Queryable, t: IdentityTables, id: string, userId: string) => {
  if (await memberRole(q, t, userId, id) === 'admin' && Number((await q.query<{count: string}>(`SELECT count(*) FROM ${t.group_members} WHERE group_id=$1 AND role='admin'`, [id])).rows[0]!.count) <= 1)
    throw new IdentityError('last_admin', 409);
};
/** Add direct Member seats after the caller has authorized the account set and serialized group writes. */
export async function insertMissingGroupMembers(q: Queryable, t: IdentityTables, groupId: string, userIds: string[]): Promise<string[]> {
  if (!userIds.length) return [];
  return (await q.query<{user_id: string}>(`INSERT INTO ${t.group_members}(group_id,user_id,role)
    SELECT $1,id,'member' FROM unnest($2::text[]) AS id
    ON CONFLICT (group_id,user_id) DO NOTHING RETURNING user_id`, [groupId,userIds])).rows.map(row => row.user_id);
}

/** Insert a fresh group and its first direct Admin after the caller has checked creation authority. */
export async function insertGroup(q: Queryable, t: IdentityTables, actorId: string,
  {handle, name, description, parentId}: {handle: string; name: string; description: string; parentId: string | null}): Promise<string> {
  const id = 'grp_' + internalId();
  try {
    await reserveHandle(t, q, handle, 'group', id);
    await q.query(`INSERT INTO ${t.groups}(id,handle,name,description,created_by,parent_id) VALUES($1,$2,$3,$4,$5,$6)`,
      [id, handle, name, description, actorId, parentId]);
  } catch (error) {
    if (isUniqueViolation(error)) throw new IdentityError('handle_taken', 409);
    throw error;
  }
  await q.query(`INSERT INTO ${t.group_members}(group_id,user_id,role) VALUES($1,$2,'admin')`, [id, actorId]);
  return id;
}

/** A topology change's first statement: the revision moved (rolled back with the change). */
export const bumpHierarchy = async (q: Queryable, t: IdentityTables): Promise<number> => Number((await q.query<{revision: string | number}>(
  `INSERT INTO ${t.group_hierarchy} AS h (id,revision) VALUES('installation',1) ON CONFLICT (id) DO UPDATE SET revision=h.revision+1 RETURNING revision`)).rows[0]?.revision ?? 0);
/** `id` and its ancestors, nearest first. */
export const chainOf = async (q: Queryable, t: IdentityTables, id: string): Promise<string[]> => (await q.query<{id: string}>(
  `WITH RECURSIVE up(id,depth) AS (SELECT id,0 FROM ${t.groups} WHERE id=$1 AND deleted_at IS NULL UNION ALL SELECT g.parent_id,u.depth+1 FROM up u JOIN ${t.groups} g ON g.id=u.id WHERE g.parent_id IS NOT NULL AND u.depth<10000) SELECT id FROM up ORDER BY depth`, [id])).rows.map(row => row.id);
/** Record a change: it is answered to the caller, and its mail is queued in this transaction. */
export const recordChange = async (q: Queryable, t: IdentityTables, changes: GroupChange[], actorId: string, groupId: string, action: string, details: Record<string, unknown> = {}, recipients: string[] = []) => {
  const made: GroupChange = {id: 'ga_' + internalId(), groupId, actorId, action, details, recipients: [...new Set(recipients)]};
  changes.push(made);
  await enqueueGroupMail(q, t, made);
};
