/**
 * WHO BELONGS TO A GROUP: `groupMemberMethods(db, t, options)` is the identity store's writes to `group_members` and
 * `group_invitations` (a role changed, a member removed, an invitation sent, withdrawn, accepted or spent on admission),
 * each in its own transaction with the group row locked, each answering the `GroupChange`s it committed. The rules
 * they share (who administers, the last admin, the locks, the change record) are ./group-access.
 */
import {IdentityError, type GroupChange, type IdentityService, type TransactionalQueryable} from '@artifactbin/contracts/identity-module';
import {isGroupRole, groupRoleRank, type GroupInvitation, type GroupRole} from '@artifactbin/contracts/groups';
import {isTestDomainEmail} from '@artifactbin/contracts/test-domain';
import {insertMissingGroupMembers,isTestAccount,liveGroup,lockGroups,memberRole,protectLastAdmin,recordChange,requireAdmin} from './group-access';
import {internalId,type IdentityTables} from './tables';
import {companySignInRoot} from './company-group';

type GroupMemberMethods = Pick<IdentityService, 'setGroupMember' | 'removeGroupMember' | 'inviteGroupMember' | 'removeGroupInvitation' | 'acceptGroupInvitations' | 'admitToGroup'>;

export function groupMemberMethods(db: TransactionalQueryable, t: IdentityTables, options: {testDomain?: string; appSchema?: string}): GroupMemberMethods {
  return {
    async setGroupMember({actorId, groupId, userId, role: next}) {
      if (!isGroupRole(next)) throw new IdentityError('invalid_role');
      return db.transaction(async tx => {
        await requireAdmin(tx, t, actorId, groupId);
        const previous = await memberRole(tx, t, userId, groupId);
        if (!previous) throw new IdentityError('not_member', 404);
        if (await isTestAccount(tx, t, actorId) && !await isTestAccount(tx, t, userId)) throw new IdentityError('test_account_restricted', 403);
        if (previous === next) return {changes: []};
        if (next !== 'admin') await protectLastAdmin(tx, t, groupId, userId);
        await tx.query(`UPDATE ${t.group_members} SET role=$3 WHERE group_id=$1 AND user_id=$2`, [groupId, userId, next]);
        const changes: GroupChange[] = [];
        await recordChange(tx, t, changes, actorId, groupId, 'role_changed', {user_id: userId, previous_role: previous, role: next}, [userId]);
        return {changes};
      });
    },

    async removeGroupMember({actorId, groupId, userId}) {
      return db.transaction(async tx => {
        if (actorId === userId) {
          if (!(await lockGroups(tx, t, [groupId])).has(groupId) || !await memberRole(tx, t, actorId, groupId)) throw new IdentityError('not_found', 404);
        } else await requireAdmin(tx, t, actorId, groupId);
        if (!await memberRole(tx, t, userId, groupId)) return {changes: []};
        await protectLastAdmin(tx, t, groupId, userId);
        const company = await companySignInRoot(tx, t.groups, options.appSchema);
        if (company?.rootId === groupId) {
          if (company.ownerId === userId) throw new IdentityError('deployment_owner_required', 409);
          await tx.query(`UPDATE ${t.users} SET deployment_admission_revoked=true WHERE id=$1 AND kind='account'`, [userId]);
          // An invitation left over from before removal cannot readmit the account.
          await tx.query(`DELETE FROM ${t.group_invitations} i USING ${t.users} u
            WHERE i.group_id=$1 AND u.id=$2 AND lower(i.email)=lower(u.email)`, [groupId, userId]);
        }
        await tx.query(`DELETE FROM ${t.group_members} WHERE group_id=$1 AND user_id=$2`, [groupId, userId]);
        const changes: GroupChange[] = [];
        await recordChange(tx, t, changes, actorId, groupId, 'member_removed', {user_id: userId}, [userId]);
        return {changes};
      });
    },

    async inviteGroupMember({actorId, groupId, email: rawEmail, role: invited}) {
      if (typeof rawEmail !== 'string' || !/^\S+@\S+\.\S+$/.test(rawEmail.trim()) || rawEmail.length > 320 || !isGroupRole(invited)) throw new IdentityError('invalid_invitation');
      const email = rawEmail.trim().toLowerCase();
      return db.transaction(async tx => {
        await requireAdmin(tx, t, actorId, groupId);
        if ((await liveGroup(tx, t, groupId))?.trusted_issuer != null) throw new IdentityError('host_managed_membership', 403);
        if (await isTestAccount(tx, t, actorId) && !(options.testDomain && isTestDomainEmail(email, options.testDomain))) throw new IdentityError('test_account_restricted', 403);
        const previous = (await tx.query<GroupInvitation>(`SELECT id,email,role,created_at,invited_by FROM ${t.group_invitations} WHERE group_id=$1 AND email=$2`, [groupId, email])).rows[0];
        if (previous?.role === invited) return {invitation: {...previous, changed: false}, changes: []};
        if (!previous && Number((await tx.query<{count: string}>(`SELECT count(*) FROM ${t.group_invitations} WHERE group_id=$1`, [groupId])).rows[0]!.count) >= 500) throw new IdentityError('rate_limited', 429, 3600);
        const invitation = (await tx.query<GroupInvitation>(`INSERT INTO ${t.group_invitations}(id,group_id,email,role,invited_by) VALUES($1,$2,$3,$4,$5)
          ON CONFLICT(group_id,email) DO UPDATE SET role=EXCLUDED.role,invited_by=EXCLUDED.invited_by RETURNING id,email,role,created_at,invited_by`, ['gin_' + internalId(), groupId, email, invited, actorId])).rows[0]!;
        const changes: GroupChange[] = [];
        await recordChange(tx, t, changes, actorId, groupId, 'invited', {invitation_id: invitation.id, previous_role: previous?.role ?? null, role: invited});
        return {invitation: {...invitation, changed: true}, changes};
      });
    },

    async removeGroupInvitation({actorId, groupId, invitationId}) {
      return db.transaction(async tx => {
        await requireAdmin(tx, t, actorId, groupId);
        if (!(await tx.query(`DELETE FROM ${t.group_invitations} WHERE group_id=$1 AND id=$2 RETURNING id`, [groupId, invitationId])).rows.length) throw new IdentityError('not_found', 404);
        const changes: GroupChange[] = [];
        await recordChange(tx, t, changes, actorId, groupId, 'uninvited', {invitation_id: invitationId});
        return {changes};
      });
    },

    async acceptGroupInvitations({userId, email: verified}) {
      const email = verified.trim().toLowerCase();
      return db.transaction(async tx => {
        if (!(await tx.query(`SELECT id FROM ${t.users} WHERE id=$1 AND email=$2 AND kind='account'`, [userId, email])).rows.length) throw new IdentityError('verified_email_mismatch', 403);
        // Every invited group locked first (one statement, canonical order), then its invitations: each is consumed once.
        const locked = await lockGroups(tx, t, (await tx.query<{group_id: string}>(`SELECT DISTINCT group_id FROM ${t.group_invitations} WHERE email=$1`, [email])).rows.map(row => row.group_id));
        const invitations = (await tx.query<{id: string; group_id: string; role: GroupRole}>(`SELECT i.id,i.group_id,i.role FROM ${t.group_invitations} i JOIN ${t.groups} g ON g.id=i.group_id
          WHERE i.email=$1 AND g.deleted_at IS NULL AND g.trusted_issuer IS NULL ORDER BY i.group_id FOR UPDATE OF i`, [email])).rows.filter(invitation => locked.has(invitation.group_id));
        const changes: GroupChange[] = [];
        for (const invitation of invitations) {
          const accepted = (await tx.query<{role:GroupRole}>(`INSERT INTO ${t.group_members} AS m (group_id,user_id,role) VALUES($1,$2,$3) ON CONFLICT(group_id,user_id) DO UPDATE SET role=CASE WHEN m.role='admin' OR EXCLUDED.role='admin' THEN 'admin' WHEN m.role='editor' OR EXCLUDED.role='editor' THEN 'editor' ELSE 'member' END RETURNING role`, [invitation.group_id, userId, invitation.role])).rows[0]!.role;
          await tx.query(`DELETE FROM ${t.group_invitations} WHERE id=$1`, [invitation.id]);
          await recordChange(tx, t, changes, userId, invitation.group_id, 'joined', {role: accepted});
        }
        return {groupIds: invitations.map(invitation => invitation.group_id), changes};
      });
    },

    async admitToGroup({userId, email: rawEmail, groupId, inviteOnly}) {
      const email = rawEmail.trim().toLowerCase();
      return db.transaction(async tx => {
        if (!(await lockGroups(tx, t, [groupId])).has(groupId)) return {admitted: false, changes: []};
        const invitation = (await tx.query<{role: GroupRole}>(`SELECT role FROM ${t.group_invitations} WHERE group_id=$1 AND lower(email)=$2 FOR UPDATE`, [groupId, email])).rows[0];
        if ((await liveGroup(tx, t, groupId))?.trusted_issuer != null) return {admitted: false, changes: []};
        const person = (await tx.query<{deployment_admission_revoked: boolean}>(`SELECT deployment_admission_revoked
          FROM ${t.users} WHERE id=$1 FOR UPDATE`, [userId])).rows[0];
        const revoked = person?.deployment_admission_revoked === true;
        if ((inviteOnly || revoked) && !invitation) return {admitted: false, changes: []};
        if (revoked) {
          const company = await companySignInRoot(tx, t.groups, options.appSchema);
          if (company?.rootId !== groupId) return {admitted: false, changes: []};
          await tx.query(`UPDATE ${t.users} SET deployment_admission_revoked=false WHERE id=$1`, [userId]);
        }
        const previous = (await tx.query<{role: GroupRole}>(`SELECT role FROM ${t.group_members} WHERE group_id=$1 AND user_id=$2`, [groupId, userId])).rows[0]?.role ?? null;
        if (!invitation) await insertMissingGroupMembers(tx,t,groupId,[userId]);
        else await tx.query(`INSERT INTO ${t.group_members} AS m (group_id,user_id,role) VALUES ($1,$2,$3) ON CONFLICT (group_id,user_id) DO UPDATE SET role=CASE WHEN m.role='admin' OR EXCLUDED.role='admin' THEN 'admin' WHEN m.role='editor' OR EXCLUDED.role='editor' THEN 'editor' ELSE 'member' END`, [groupId, userId, invitation.role]);
        if (invitation) await tx.query(`DELETE FROM ${t.group_invitations} WHERE group_id=$1 AND lower(email)=$2`, [groupId, email]);
        const changes: GroupChange[] = [];
        if (!previous || (invitation && groupRoleRank(invitation.role) > groupRoleRank(previous)))
          await recordChange(tx, t, changes, userId, groupId, 'joined', {previous_role: previous, role: invitation?.role ?? 'member'});
        return {admitted: true, changes};
      });
    },
  };
}
