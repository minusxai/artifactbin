/**
 * GROUPS, MEMBERSHIP, INVITATIONS AND THE TREE: the identity store's writes to `groups`, `group_members`,
 * `group_invitations` and `group_hierarchy`, and the mail each change sends (`./mail`).
 *
 * The tree is `groups.parent_id` (one parent at most, never a cycle). Membership is DIRECT rows only; what the tree
 * adds (a group's audience reaching its descendants' members) is the app's read, never stored here. ADMINISTRATION
 * flows down it: an admin of a group is an EFFECTIVE ADMIN of every live group below it (./rules `groupAdminsSql`,
 * `effectiveAdminVia` here, the `group_admins` read view), and may do there whatever a direct admin may. Editor and
 * Member never flow down. An inherited admin is not a member: never listed, mailed or counted as a group's last admin.
 *
 * LOCKING IS THIS MODULE'S OWN, for its own invariants, and nothing outside it waits on it (readers lock nothing):
 *  - a topology change (create, delete, reparent) moves the hierarchy revision as its FIRST statement, so topology
 *    changes run one at a time (no cycle can be built by two concurrent reparents) and each moves the revision;
 *  - a change to who belongs locks the group row FOR UPDATE (concurrent admin removals cannot remove the last
 *    admin); a change touching several groups locks them in one statement ordered `id COLLATE "C"`. An inherited
 *    admin's authority is read from the ancestors' rows at decision time, unlocked, as every reader reads it: a
 *    removed ancestor role refuses the very next change;
 *  - an invitation is consumed with its row locked, so acceptance happens exactly once.
 * A refusal is an IdentityError; every change answers the `GroupChange`s it committed, for the app to act on after.
 *
 * `groupMethods(db, t, options)` is the whole surface: the tree and group sign-in approvals here, membership and
 * invitations in ./group-members, the checks and locks both use in ./group-access.
 */
import {IdentityError, type GroupSignInGrant, type GroupChange, type IdentityService, type TransactionalQueryable} from '@artifactbin/contracts/identity-module';
import {normalizeCreateGroup, type GroupRole, type GroupSummary} from '@artifactbin/contracts/groups';
import {IDENTITY_SCHEMA} from '@artifactbin/contracts/identity-service';
import {plainIdentifier} from '@artifactbin/utils/sql-identifier';
import {companyGroupState} from './company-group';
import {bumpHierarchy,chainOf,effectiveAdminVia,insertGroup,memberRole,isTestAccount,liveGroup,lockGroups,recordChange,requireAdmin,type GroupRow} from './group-access';
import {groupMemberMethods} from './group-members';
import {internalId,type IdentityTables} from './tables';

const summary = (group: GroupRow, role: GroupRole | null): GroupSummary => ({id: group.id, handle: group.handle, name: group.name, description: group.description, role, parent_id: group.parent_id ?? null});
/** No edge moved: rolled back, so the revision does not move either. */
class Unchanged extends Error { constructor(public parentId: string | null) { super('unchanged'); } }

type GroupMethods = Pick<IdentityService, 'setDefaultDestination' | 'revokeGroupSignIn' | 'approveServiceGroupSignIn' | 'revokeServiceGroupSignIn' | 'createGroup' | 'updateGroup' | 'setGroupParent' | 'deleteGroup' | 'setGroupMember' | 'removeGroupMember' | 'inviteGroupMember'
  | 'removeGroupInvitation' | 'acceptGroupInvitations' | 'admitToGroup'>;

export function groupMethods(db: TransactionalQueryable, t: IdentityTables, options: {testDomain?: string; appSchema?: string; readSchema?: string}): GroupMethods {
  return {
    async setDefaultDestination({userId, destination}) {
      if (!destination || !['personal','group','inherit'].includes(destination.type) ||
          Object.keys(destination).some(key => key !== 'type' && !(destination.type === 'group' && key === 'id')))
        throw new IdentityError('invalid_destination');
      await db.transaction(async tx => {
        if (destination.type === 'group' && (typeof destination.id !== 'string' ||
            !(await memberRole(tx,t,userId,destination.id) || await effectiveAdminVia(tx,t,userId,destination.id))))
          throw new IdentityError('group_unavailable',403);
        await tx.query(`INSERT INTO ${t.account_preferences}(user_id,default_destination) VALUES($1,$2::jsonb)
          ON CONFLICT(user_id) DO UPDATE SET default_destination=EXCLUDED.default_destination`, [userId,JSON.stringify(destination)]);
      });
    },
    async revokeGroupSignIn({actorId, groupId, id}) {
      return db.transaction(async tx => {
        await requireAdmin(tx, t, actorId, groupId);
        const row = (await tx.query<{name: string | null}>(`UPDATE ${t.tokens} SET deleted_at=now() WHERE id=$1 AND group_id=$2 AND user_id IS NULL AND deleted_at IS NULL RETURNING name`, [id, groupId])).rows[0];
        return row ? {name: row.name} : null;
      });
    },
    async approveServiceGroupSignIn({actorId, groupId, serviceId, serviceOrigin, role: level}) {
      if (level !== 'member' && level !== 'editor') throw new IdentityError('invalid_role');
      if (typeof serviceId !== 'string' || !/^[a-z][a-z0-9-]{0,62}$/.test(serviceId)) throw new IdentityError('invalid_service');
      if (typeof serviceOrigin !== 'string' || !/^https?:\/\/[^/\s]{1,253}$/.test(serviceOrigin)) throw new IdentityError('invalid_service');
      return db.transaction(async tx => {
        await requireAdmin(tx, t, actorId, groupId);
        // A test account approves nothing, as it signs no agent in as a group itself (./accounts `mintGroupSignIn`).
        if (await isTestAccount(tx, t, actorId)) throw new IdentityError('test_account_restricted', 403);
        // One live approval per group, service (at its origin) and level: approving it again answers the one already
        // there, and records nothing.
        const existing = (await tx.query<GroupSignInGrant>(`SELECT * FROM ${t.group_sign_in_grants} WHERE group_id=$1 AND service_id=$2 AND role=$3 AND service_origin=$4 AND deleted_at IS NULL`, [groupId, serviceId, level, serviceOrigin])).rows[0];
        if (existing) return {grant: existing, changes: []};
        const grant = (await tx.query<GroupSignInGrant>(`INSERT INTO ${t.group_sign_in_grants}(id,group_id,role,service_id,approved_by,service_origin) VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
          ['sgg_' + internalId(), groupId, level, serviceId, actorId, serviceOrigin])).rows[0]!;
        // Audited as the group's change (who, the group, the service, the level); it mails nobody.
        const changes: GroupChange[] = [];
        await recordChange(tx, t, changes, actorId, groupId, 'service_sign_in_approved', {grant_id: grant.id, service_id: serviceId, role: level});
        return {grant, changes};
      });
    },
    async revokeServiceGroupSignIn({actorId, groupId, id}) {
      return db.transaction(async tx => {
        await requireAdmin(tx, t, actorId, groupId);
        const grant = (await tx.query<GroupSignInGrant>(`UPDATE ${t.group_sign_in_grants} SET deleted_at=now() WHERE id=$1 AND group_id=$2 AND deleted_at IS NULL RETURNING *`, [id, groupId])).rows[0];
        if (!grant) return null;
        const changes: GroupChange[] = [];
        await recordChange(tx, t, changes, actorId, groupId, 'service_sign_in_revoked', {grant_id: grant.id, service_id: grant.service_id, role: grant.role});
        return {grant, changes};
      });
    },
    async createGroup({actorId, handle: rawHandle, name: rawName, description: rawDescription, parentId: rawParent}) {
      const valid = normalizeCreateGroup({handle: rawHandle, name: rawName, description: rawDescription, parent_id: rawParent});
      if (!valid) throw new IdentityError('invalid_group');
      const {handle, name, description, parentId} = valid;
      return db.transaction(async tx => {
        const hierarchyRevision = await bumpHierarchy(tx, t);
        if (!(await tx.query(`SELECT id FROM ${t.users} WHERE id=$1 AND kind='account'`, [actorId])).rows.length) throw new IdentityError('account_required', 403);
        // Only an admin of the parent (directly or through an ancestor) creates beneath it: the new subtree's members
        // receive the parent's shares. The creator becomes the new group's first direct admin.
        if (parentId) await requireAdmin(tx, t, actorId, parentId, 'parent_not_found');
        else {
          const company = await companyGroupState(tx, options.appSchema);
          if (company) {
            // The setup owner needs a first root to select. The hierarchy lock serializes competing creations.
            const mayBootstrap = !company.setup_complete && company.owner_user_id === actorId &&
              !(await tx.query(`SELECT 1 FROM ${t.groups} g JOIN ${t.group_members} m ON m.group_id=g.id
                WHERE g.parent_id IS NULL AND g.deleted_at IS NULL AND m.user_id=$1 AND m.role='admin' LIMIT 1`, [actorId])).rows.length;
            if (!mayBootstrap) throw new IdentityError('company_parent_required', 409);
          }
        }
        const id = await insertGroup(tx, t, actorId, valid);
        const changes: GroupChange[] = [];
        await recordChange(tx, t, changes, actorId, id, 'created', parentId ? {parent_id: parentId} : {});
        if (parentId) await recordChange(tx, t, changes, actorId, parentId, 'subgroup_attached', {group_id: id});
        return {group: {id, handle, name, description, role: 'admin', parent_id: parentId}, hierarchyRevision, changes};
      });
    },

    async updateGroup({actorId, groupId, interactiveTokenId, ...input}) {
      if (!input || !Object.keys(input).length || Object.keys(input).some(key => !['name', 'description', 'tenancy_id'].includes(key))
        || (input.tenancy_id != null && (typeof input.tenancy_id !== 'string' || !input.tenancy_id.trim() || input.tenancy_id.length > 200 || /[\u0000-\u001f\u007f]/.test(input.tenancy_id)))
        || (input.name !== undefined && (typeof input.name !== 'string' || !input.name.trim() || input.name.trim().length > 120))
        || (input.description !== undefined && (typeof input.description !== 'string' || input.description.trim().length > 2000))) throw new IdentityError('invalid_group');
      return db.transaction(async tx => {
        await requireAdmin(tx, t, actorId, groupId);
        if (interactiveTokenId !== undefined) {
          if (!interactiveTokenId || input.tenancy_id !== undefined) throw new IdentityError('forbidden', 403);
          const read = plainIdentifier(options.readSchema ?? IDENTITY_SCHEMA, 'read schema');
          if (!(await tx.query(`SELECT 1 FROM ${read}.tokens WHERE id=$1 AND group_id=$2 AND user_id=$3
            AND group_role='admin' AND live`, [interactiveTokenId,groupId,actorId])).rows.length)
            throw new IdentityError('forbidden', 403);
        }
        const before = (await liveGroup(tx, t, groupId))!;
        const name = input.name?.trim() ?? before.name, description = input.description?.trim() ?? before.description;
        if (input.tenancy_id !== undefined && before.trusted_issuer !== null) throw new IdentityError('host_managed_tenancy', 403);
        const tenancy = input.tenancy_id === undefined ? before.tenancy_id : input.tenancy_id;
        if (tenancy === before.tenancy_id && name === before.name && description === before.description) return {group: summary(before, 'admin'), changes: []};
        const row = (await tx.query<GroupRow>(`UPDATE ${t.groups} SET name=$2,description=$3,tenancy_id=$4 WHERE id=$1 RETURNING *`, [groupId, name, description, tenancy])).rows[0]!;
        const changes: GroupChange[] = [];
        await recordChange(tx, t, changes, actorId, groupId, 'updated', {previous: {name: before.name, description: before.description, tenancy_id: before.tenancy_id}, next: {name, description, tenancy_id: tenancy}});
        return {group: summary(row, 'admin'), changes};
      });
    },

    /**
     * REPARENT (or detach, `parentId` null). The actor administers (directly or through an ancestor) the moved group, its
     * current parent and its new one. Every group keeps its own direct admin (`protectLastAdmin`), so a detached group
     * is never left without one. `fromParentId` is the parent the caller saw: a group with a parent is never given another without it
     * (`already_has_parent`), a stale one is `parent_changed`, and a parent inside the moved subtree is a cycle.
     */
    async setGroupParent({actorId, groupId: id, parentId, fromParentId}) {
      if ((parentId !== null && (typeof parentId !== 'string' || !parentId)) || (fromParentId !== undefined && fromParentId !== null && typeof fromParentId !== 'string')) throw new IdentityError('invalid_parent');
      try {
        return await db.transaction(async tx => {
          const revision = await bumpHierarchy(tx, t);
          // Edges move only under the revision, which this transaction now holds: the parent read here is current.
          const group = await liveGroup(tx, t, id);
          const previous = group?.parent_id ?? null;
          await lockGroups(tx, t, [id, ...(previous ? [previous] : []), ...(parentId ? [parentId] : [])]);
          await requireAdmin(tx, t, actorId, id);
          if (fromParentId !== undefined && fromParentId !== previous) throw new IdentityError('parent_changed', 409);
          if (previous === parentId) throw new Unchanged(previous);
          if (group?.trusted_issuer != null) throw new IdentityError('host_managed_parent', 409);
          if (!parentId && await companyGroupState(tx, options.appSchema)) throw new IdentityError('company_parent_required', 409);
          if (previous && parentId && fromParentId === undefined) throw new IdentityError('already_has_parent', 409);
          if (previous) await requireAdmin(tx, t, actorId, previous, 'parent_not_found');
          if (parentId) {
            await requireAdmin(tx, t, actorId, parentId, 'parent_not_found');
            if ((await chainOf(tx, t, parentId)).includes(id)) throw new IdentityError('hierarchy_cycle', 409);
          }
          await tx.query(`UPDATE ${t.groups} SET parent_id=$2,parent_edge_id=gen_random_uuid() WHERE id=$1`, [id, parentId]);
          const changes: GroupChange[] = [];
          await recordChange(tx, t, changes, actorId, id, 'reparented', {previous_parent_id: previous, parent_id: parentId});
          if (previous) await recordChange(tx, t, changes, actorId, previous, 'subgroup_detached', {group_id: id});
          if (parentId) await recordChange(tx, t, changes, actorId, parentId, 'subgroup_attached', {group_id: id});
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
        await bumpHierarchy(tx, t);
        await requireAdmin(tx, t, actorId, id);
        const group = (await liveGroup(tx, t, id))!;
        if (group.trusted_issuer != null) {
          if (!group.parent_id) throw new IdentityError('forbidden', 403);
          await requireAdmin(tx, t, actorId, group.parent_id);
        }
        if (handle !== group.handle) throw new IdentityError('handle_mismatch', 409);
        if ((await tx.query(`SELECT 1 FROM ${t.groups} WHERE parent_id=$1 AND deleted_at IS NULL LIMIT 1`, [id])).rows.length) throw new IdentityError('group_has_children', 409);
        const members = (await tx.query<{user_id: string}>(`SELECT user_id FROM ${t.group_members} WHERE group_id=$1`, [id])).rows.map(row => row.user_id);
        const changes: GroupChange[] = [];
        await recordChange(tx, t, changes, actorId, id, 'deleted', {}, members);
        await tx.query(`DELETE FROM ${t.group_invitations} WHERE group_id=$1`, [id]);
        await tx.query(`DELETE FROM ${t.group_members} WHERE group_id=$1`, [id]);
        await tx.query(`UPDATE ${t.groups} SET deleted_at=now() WHERE id=$1`, [id]);
        return {changes};
      });
    },
    ...groupMemberMethods(db, t, options),
  };
}
