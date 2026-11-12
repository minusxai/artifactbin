/**
 * GROUPS, MEMBERSHIP, INVITATIONS AND THE TREE: the identity store's writes to `groups`, `group_members`,
 * `group_invitations` and `group_hierarchy`, and the mail each change sends (`./mail`).
 *
 * The tree is `groups.parent_id` (one parent at most, never a cycle). Membership is DIRECT rows only; what the tree
 * adds (a group's audience reaching its descendants' members) is the app's read, never stored here.
 *
 * LOCKING IS THIS MODULE'S OWN, for its own invariants, and nothing outside it waits on it (readers lock nothing):
 *  - a topology change (create, delete, reparent) moves the hierarchy revision as its FIRST statement, so topology
 *    changes run one at a time (no cycle can be built by two concurrent reparents) and each moves the revision;
 *  - a change to who belongs locks the group row FOR UPDATE (concurrent admin removals cannot remove the last
 *    admin); a change touching several groups locks them in one statement ordered `id COLLATE "C"`;
 *  - an invitation is consumed with its row locked, so acceptance happens exactly once.
 * A refusal is an IdentityError; every change answers the `GroupChange`s it committed, for the app to act on after.
 */
import {IdentityError,isGroupRole,groupRoleRank,isTestDomainEmail,normalizeCreateGroup,type GroupChange,type GroupInvitation,type GroupRole,type GroupSummary,type IdentityService,type Queryable,type TransactionalQueryable} from '@artifactbin/contracts';
import {reserveHandle} from './accounts';
import {enqueueGroupMail} from './mail';
import {internalId,isUniqueViolation,type IdentityTables} from './tables';

interface GroupRow {id: string; handle: string; name: string; description: string; created_by: string; deleted_at: string | null; parent_id: string | null}
const roleValid = isGroupRole;
const summary = (group: GroupRow, role: GroupRole | null): GroupSummary => ({id: group.id, handle: group.handle, name: group.name, description: group.description, role, parent_id: group.parent_id ?? null});
/** No edge moved: rolled back, so the revision does not move either. */
class Unchanged extends Error { constructor(public parentId: string | null) { super('unchanged'); } }

type GroupMethods = Pick<IdentityService, 'createGroup' | 'updateGroup' | 'setGroupParent' | 'deleteGroup' | 'setGroupMember' | 'removeGroupMember' | 'inviteGroupMember'
  | 'removeGroupInvitation' | 'acceptGroupInvitations' | 'admitToGroup'>;

export function groupMethods(db: TransactionalQueryable, t: IdentityTables, options: {testDomain?: string}): GroupMethods {
  const role = async (q: Queryable, userId: string, groupId: string): Promise<GroupRole | null> =>
    (await q.query<{role: GroupRole}>(`SELECT m.role FROM ${t.group_members} m JOIN ${t.groups} g ON g.id=m.group_id WHERE m.group_id=$1 AND m.user_id=$2 AND g.deleted_at IS NULL`, [groupId, userId])).rows[0]?.role ?? null;
  const live = async (q: Queryable, id: string): Promise<GroupRow | null> =>
    (await q.query<GroupRow>(`SELECT * FROM ${t.groups} WHERE id=$1 AND deleted_at IS NULL`, [id])).rows[0] ?? null;
  const isTestAccount = async (q: Queryable, userId: string) =>
    (await q.query<{test_account: boolean}>(`SELECT test_account FROM ${t.users} WHERE id=$1`, [userId])).rows[0]?.test_account === true;
  /** Lock live groups FOR UPDATE in the canonical order; the ids that were live. */
  const lockGroups = async (q: Queryable, ids: readonly string[]): Promise<Set<string>> => {
    if (!ids.length) return new Set();
    return new Set((await q.query<{id: string}>(`SELECT id FROM ${t.groups} WHERE id=ANY($1::text[]) AND deleted_at IS NULL ORDER BY id COLLATE "C" FOR UPDATE`, [[...new Set(ids)]])).rows.map(row => row.id));
  };
  /** The actor directly administers this live group, which is now locked. */
  const requireAdmin = async (q: Queryable, actorId: string, id: string, missing = 'not_found') => {
    if (!(await lockGroups(q, [id])).has(id)) throw new IdentityError(missing, 404);
    const held = await role(q, actorId, id);
    if (!held) throw new IdentityError(missing, 404);
    if (held !== 'admin') throw new IdentityError('forbidden', 403);
  };
  const protectLastAdmin = async (q: Queryable, id: string, userId: string) => {
    if (await role(q, userId, id) === 'admin' && Number((await q.query<{count: string}>(`SELECT count(*) FROM ${t.group_members} WHERE group_id=$1 AND role='admin'`, [id])).rows[0]!.count) <= 1)
      throw new IdentityError('last_admin', 409);
  };
  /** A topology change's first statement: the revision moved (rolled back with the change). */
  const bumpHierarchy = async (q: Queryable): Promise<number> => Number((await q.query<{revision: string | number}>(
    `INSERT INTO ${t.group_hierarchy} AS h (id,revision) VALUES('installation',1) ON CONFLICT (id) DO UPDATE SET revision=h.revision+1 RETURNING revision`)).rows[0]?.revision ?? 0);
  const chainOf = async (q: Queryable, id: string): Promise<string[]> => (await q.query<{id: string}>(
    `WITH RECURSIVE up(id,depth) AS (SELECT id,0 FROM ${t.groups} WHERE id=$1 AND deleted_at IS NULL UNION ALL SELECT g.parent_id,u.depth+1 FROM up u JOIN ${t.groups} g ON g.id=u.id WHERE g.parent_id IS NOT NULL AND u.depth<10000) SELECT id FROM up ORDER BY depth`, [id])).rows.map(row => row.id);
  /** Record a change: it is answered to the caller, and its mail is queued in this transaction. */
  const change = async (q: Queryable, changes: GroupChange[], actorId: string, groupId: string, action: string, details: Record<string, unknown> = {}, recipients: string[] = []) => {
    const made: GroupChange = {id: 'ga_' + internalId(), groupId, actorId, action, details, recipients: [...new Set(recipients)]};
    changes.push(made);
    await enqueueGroupMail(q, t, made);
  };

  return {
    async createGroup({actorId, handle: rawHandle, name: rawName, description: rawDescription, parentId: rawParent}) {
      const valid = normalizeCreateGroup({handle: rawHandle, name: rawName, description: rawDescription, parent_id: rawParent});
      if (!valid) throw new IdentityError('invalid_group');
      const {handle, name, description, parentId} = valid;
      return db.transaction(async tx => {
        const hierarchyRevision = await bumpHierarchy(tx);
        if (!(await tx.query(`SELECT id FROM ${t.users} WHERE id=$1 AND kind='account'`, [actorId])).rows.length) throw new IdentityError('account_required', 403);
        // Only a direct admin of the parent creates beneath it: the new subtree's members receive the parent's shares.
        if (parentId) await requireAdmin(tx, actorId, parentId, 'parent_not_found');
        const id = 'grp_' + internalId();
        try { await reserveHandle(t, tx, handle, 'group', id); } catch (error) { if (isUniqueViolation(error)) throw new IdentityError('handle_taken', 409); throw error; }
        await tx.query(`INSERT INTO ${t.groups}(id,handle,name,description,created_by,parent_id) VALUES($1,$2,$3,$4,$5,$6)`, [id, handle, name, description, actorId, parentId]);
        await tx.query(`INSERT INTO ${t.group_members}(group_id,user_id,role) VALUES($1,$2,'admin')`, [id, actorId]);
        const changes: GroupChange[] = [];
        await change(tx, changes, actorId, id, 'created', parentId ? {parent_id: parentId} : {});
        if (parentId) await change(tx, changes, actorId, parentId, 'subgroup_attached', {group_id: id});
        return {group: {id, handle, name, description, role: 'admin', parent_id: parentId}, hierarchyRevision, changes};
      });
    },

    async updateGroup({actorId, groupId, ...input}) {
      if (!input || !Object.keys(input).length || Object.keys(input).some(key => !['name', 'description'].includes(key))
        || (input.name !== undefined && (typeof input.name !== 'string' || !input.name.trim() || input.name.trim().length > 120))
        || (input.description !== undefined && (typeof input.description !== 'string' || input.description.trim().length > 2000))) throw new IdentityError('invalid_group');
      return db.transaction(async tx => {
        await requireAdmin(tx, actorId, groupId);
        const before = (await live(tx, groupId))!;
        const name = input.name?.trim() ?? before.name, description = input.description?.trim() ?? before.description;
        if (name === before.name && description === before.description) return {group: summary(before, 'admin'), changes: []};
        const row = (await tx.query<GroupRow>(`UPDATE ${t.groups} SET name=$2,description=$3 WHERE id=$1 RETURNING *`, [groupId, name, description])).rows[0]!;
        const changes: GroupChange[] = [];
        await change(tx, changes, actorId, groupId, 'updated', {previous: {name: before.name, description: before.description}, next: {name, description}});
        return {group: summary(row, 'admin'), changes};
      });
    },

    /**
     * REPARENT (or detach, `parentId` null). The actor directly administers the moved group, its current parent and its new
     * one. `fromParentId` is the parent the caller saw: a group with a parent is never given another without it
     * (`already_has_parent`), a stale one is `parent_changed`, and a parent inside the moved subtree is a cycle.
     */
    async setGroupParent({actorId, groupId: id, parentId, fromParentId}) {
      if ((parentId !== null && (typeof parentId !== 'string' || !parentId)) || (fromParentId !== undefined && fromParentId !== null && typeof fromParentId !== 'string')) throw new IdentityError('invalid_parent');
      try {
        return await db.transaction(async tx => {
          const revision = await bumpHierarchy(tx);
          // Edges move only under the revision, which this transaction now holds: the parent read here is current.
          const previous = (await live(tx, id))?.parent_id ?? null;
          await lockGroups(tx, [id, ...(previous ? [previous] : []), ...(parentId ? [parentId] : [])]);
          await requireAdmin(tx, actorId, id);
          if (fromParentId !== undefined && fromParentId !== previous) throw new IdentityError('parent_changed', 409);
          if (previous === parentId) throw new Unchanged(previous);
          if (previous && parentId && fromParentId === undefined) throw new IdentityError('already_has_parent', 409);
          if (previous) await requireAdmin(tx, actorId, previous, 'parent_not_found');
          if (parentId) {
            await requireAdmin(tx, actorId, parentId, 'parent_not_found');
            if ((await chainOf(tx, parentId)).includes(id)) throw new IdentityError('hierarchy_cycle', 409);
          }
          await tx.query(`UPDATE ${t.groups} SET parent_id=$2 WHERE id=$1`, [id, parentId]);
          const changes: GroupChange[] = [];
          await change(tx, changes, actorId, id, 'reparented', {previous_parent_id: previous, parent_id: parentId});
          if (previous) await change(tx, changes, actorId, previous, 'subgroup_detached', {group_id: id});
          if (parentId) await change(tx, changes, actorId, parentId, 'subgroup_attached', {group_id: id});
          return {changed: true, parent_id: parentId, previous_parent_id: previous, hierarchy_revision: revision, changes};
        });
      } catch (error) {
        if (error instanceof Unchanged) return {changed: false, parent_id: error.parentId, previous_parent_id: error.parentId, changes: []};
        throw error;
      }
    },

    /** Soft delete. Its own membership and invitation rows go with it; nothing outside this module is touched. */
    async deleteGroup({actorId, groupId: id, handle}) {
      return db.transaction(async tx => {
        await bumpHierarchy(tx);
        await requireAdmin(tx, actorId, id);
        if (handle !== (await live(tx, id))!.handle) throw new IdentityError('handle_mismatch', 409);
        if ((await tx.query(`SELECT 1 FROM ${t.groups} WHERE parent_id=$1 AND deleted_at IS NULL LIMIT 1`, [id])).rows.length) throw new IdentityError('group_has_children', 409);
        const members = (await tx.query<{user_id: string}>(`SELECT user_id FROM ${t.group_members} WHERE group_id=$1`, [id])).rows.map(row => row.user_id);
        const changes: GroupChange[] = [];
        await change(tx, changes, actorId, id, 'deleted', {}, members);
        await tx.query(`DELETE FROM ${t.group_invitations} WHERE group_id=$1`, [id]);
        await tx.query(`DELETE FROM ${t.group_members} WHERE group_id=$1`, [id]);
        await tx.query(`UPDATE ${t.groups} SET deleted_at=now() WHERE id=$1`, [id]);
        return {changes};
      });
    },

    async setGroupMember({actorId, groupId, userId, role: next}) {
      if (!roleValid(next)) throw new IdentityError('invalid_role');
      return db.transaction(async tx => {
        await requireAdmin(tx, actorId, groupId);
        const previous = await role(tx, userId, groupId);
        if (!previous) throw new IdentityError('not_member', 404);
        if (await isTestAccount(tx, actorId) && !await isTestAccount(tx, userId)) throw new IdentityError('test_account_restricted', 403);
        if (previous === next) return {changes: []};
        if (next !== 'admin') await protectLastAdmin(tx, groupId, userId);
        await tx.query(`UPDATE ${t.group_members} SET role=$3 WHERE group_id=$1 AND user_id=$2`, [groupId, userId, next]);
        const changes: GroupChange[] = [];
        await change(tx, changes, actorId, groupId, 'role_changed', {user_id: userId, previous_role: previous, role: next}, [userId]);
        return {changes};
      });
    },

    async removeGroupMember({actorId, groupId, userId}) {
      return db.transaction(async tx => {
        if (actorId === userId) {
          if (!(await lockGroups(tx, [groupId])).has(groupId) || !await role(tx, actorId, groupId)) throw new IdentityError('not_found', 404);
        } else await requireAdmin(tx, actorId, groupId);
        if (!await role(tx, userId, groupId)) return {changes: []};
        await protectLastAdmin(tx, groupId, userId);
        await tx.query(`DELETE FROM ${t.group_members} WHERE group_id=$1 AND user_id=$2`, [groupId, userId]);
        const changes: GroupChange[] = [];
        await change(tx, changes, actorId, groupId, 'member_removed', {user_id: userId}, [userId]);
        return {changes};
      });
    },

    async inviteGroupMember({actorId, groupId, email: rawEmail, role: invited}) {
      if (typeof rawEmail !== 'string' || !/^\S+@\S+\.\S+$/.test(rawEmail.trim()) || rawEmail.length > 320 || !roleValid(invited)) throw new IdentityError('invalid_invitation');
      const email = rawEmail.trim().toLowerCase();
      return db.transaction(async tx => {
        await requireAdmin(tx, actorId, groupId);
        if (await isTestAccount(tx, actorId) && !(options.testDomain && isTestDomainEmail(email, options.testDomain))) throw new IdentityError('test_account_restricted', 403);
        const previous = (await tx.query<GroupInvitation>(`SELECT id,email,role,created_at,invited_by FROM ${t.group_invitations} WHERE group_id=$1 AND email=$2`, [groupId, email])).rows[0];
        if (previous?.role === invited) return {invitation: {...previous, changed: false}, changes: []};
        if (!previous && Number((await tx.query<{count: string}>(`SELECT count(*) FROM ${t.group_invitations} WHERE group_id=$1`, [groupId])).rows[0]!.count) >= 500) throw new IdentityError('rate_limited', 429, 3600);
        const invitation = (await tx.query<GroupInvitation>(`INSERT INTO ${t.group_invitations}(id,group_id,email,role,invited_by) VALUES($1,$2,$3,$4,$5)
          ON CONFLICT(group_id,email) DO UPDATE SET role=EXCLUDED.role,invited_by=EXCLUDED.invited_by RETURNING id,email,role,created_at,invited_by`, ['gin_' + internalId(), groupId, email, invited, actorId])).rows[0]!;
        const changes: GroupChange[] = [];
        await change(tx, changes, actorId, groupId, 'invited', {invitation_id: invitation.id, previous_role: previous?.role ?? null, role: invited});
        return {invitation: {...invitation, changed: true}, changes};
      });
    },

    async removeGroupInvitation({actorId, groupId, invitationId}) {
      return db.transaction(async tx => {
        await requireAdmin(tx, actorId, groupId);
        if (!(await tx.query(`DELETE FROM ${t.group_invitations} WHERE group_id=$1 AND id=$2 RETURNING id`, [groupId, invitationId])).rows.length) throw new IdentityError('not_found', 404);
        const changes: GroupChange[] = [];
        await change(tx, changes, actorId, groupId, 'uninvited', {invitation_id: invitationId});
        return {changes};
      });
    },

    async acceptGroupInvitations({userId, email: verified}) {
      const email = verified.trim().toLowerCase();
      return db.transaction(async tx => {
        if (!(await tx.query(`SELECT id FROM ${t.users} WHERE id=$1 AND email=$2 AND kind='account'`, [userId, email])).rows.length) throw new IdentityError('verified_email_mismatch', 403);
        // Every invited group locked first (one statement, canonical order), then its invitations: each is consumed once.
        const locked = await lockGroups(tx, (await tx.query<{group_id: string}>(`SELECT DISTINCT group_id FROM ${t.group_invitations} WHERE email=$1`, [email])).rows.map(row => row.group_id));
        const invitations = (await tx.query<{id: string; group_id: string; role: GroupRole}>(`SELECT i.id,i.group_id,i.role FROM ${t.group_invitations} i JOIN ${t.groups} g ON g.id=i.group_id
          WHERE i.email=$1 AND g.deleted_at IS NULL ORDER BY i.group_id FOR UPDATE OF i`, [email])).rows.filter(invitation => locked.has(invitation.group_id));
        const changes: GroupChange[] = [];
        for (const invitation of invitations) {
          const accepted = (await tx.query<{role:GroupRole}>(`INSERT INTO ${t.group_members} AS m (group_id,user_id,role) VALUES($1,$2,$3) ON CONFLICT(group_id,user_id) DO UPDATE SET role=CASE WHEN m.role='admin' OR EXCLUDED.role='admin' THEN 'admin' WHEN m.role='editor' OR EXCLUDED.role='editor' THEN 'editor' ELSE 'member' END RETURNING role`, [invitation.group_id, userId, invitation.role])).rows[0]!.role;
          await tx.query(`DELETE FROM ${t.group_invitations} WHERE id=$1`, [invitation.id]);
          await change(tx, changes, userId, invitation.group_id, 'joined', {role: accepted});
        }
        return {groupIds: invitations.map(invitation => invitation.group_id), changes};
      });
    },

    async admitToGroup({userId, email: rawEmail, groupId, inviteOnly}) {
      const email = rawEmail.trim().toLowerCase();
      return db.transaction(async tx => {
        if (!(await lockGroups(tx, [groupId])).has(groupId)) return {admitted: false, changes: []};
        const invitation = (await tx.query<{role: GroupRole}>(`SELECT role FROM ${t.group_invitations} WHERE group_id=$1 AND lower(email)=$2 FOR UPDATE`, [groupId, email])).rows[0];
        if (inviteOnly && !invitation) return {admitted: false, changes: []};
        const previous = (await tx.query<{role: GroupRole}>(`SELECT role FROM ${t.group_members} WHERE group_id=$1 AND user_id=$2`, [groupId, userId])).rows[0]?.role ?? null;
        await tx.query(`INSERT INTO ${t.group_members} AS m (group_id,user_id,role) VALUES ($1,$2,$3) ON CONFLICT (group_id,user_id) DO UPDATE SET role=CASE WHEN m.role='admin' OR EXCLUDED.role='admin' THEN 'admin' WHEN m.role='editor' OR EXCLUDED.role='editor' THEN 'editor' ELSE 'member' END`, [groupId, userId, invitation?.role ?? 'member']);
        if (invitation) await tx.query(`DELETE FROM ${t.group_invitations} WHERE group_id=$1 AND lower(email)=$2`, [groupId, email]);
        const changes: GroupChange[] = [];
        if (!previous || (invitation && groupRoleRank(invitation.role) > groupRoleRank(previous)))
          await change(tx, changes, userId, groupId, 'joined', {previous_role: previous, role: invitation?.role ?? 'member'});
        return {admitted: true, changes};
      });
    },
  };
}
