import {GroupError} from './errors';
import {groupAttempt,recordGroupChanges,type GroupMutationActor} from './mutations';
import {subtreeSql} from './hierarchy';
/**
 * GROUPS, AS THE APP SEES THEM. Every write (create, rename, delete, reparent, membership, invitations) is the
 * identity module's (lib/platform `services().identity`, contracts `IdentityService`): these functions translate a
 * request into its call, charge the app's quota before it, and run the app's half (audit, events, waking readers)
 * after it commits (./mutations). Reads join the shared tables directly. Membership and links never derive
 * authority from accounts or artifacts; users and groups share one handle namespace (identity's).
 */
import {normalizeCreateGroup} from '@artifactbin/contracts';
import type {UpdateGroupInput,AccountPreferences,CreateGroupInput,DefaultDestination,GroupAudienceMember,GroupDetail,GroupInvitation,GroupMember,GroupRelative,GroupRole,GroupSummary,Queryable as ContractQueryable} from '@artifactbin/contracts';
import { getDb, services } from '../platform';
export interface GroupRecord {id:string;handle:string;name:string;description:string;created_by:string;deleted_at:string|null;parent_id:string|null;}
export {GroupError} from './errors';
const summary=(group:GroupRecord,role:GroupRole|null):GroupSummary=>({id:group.id,handle:group.handle,name:group.name,description:group.description,role,parent_id:group.parent_id??null});
export async function getGroupById(id:string,query?:ContractQueryable):Promise<GroupRecord|null>{return (await (query??await getDb()).query<GroupRecord>('SELECT * FROM groups WHERE id=$1 AND deleted_at IS NULL',[id])).rows[0]??null;}
export async function getGroupRole(userId:string|null,groupId:string,query?:ContractQueryable):Promise<GroupRole|null>{if(!userId)return null;return (await (query??await getDb()).query<{role:GroupRole}>('SELECT m.role FROM group_members m JOIN groups g ON g.id=m.group_id WHERE m.group_id=$1 AND m.user_id=$2 AND g.deleted_at IS NULL',[groupId,userId])).rows[0]?.role??null;}
/**
 * A new group, a root or (`parent_id`) a subgroup: a topology change, which moves the hierarchy revision. Only a
 * direct editor of the parent creates beneath it, because the new subtree's members receive the parent's shares.
 */
export async function createGroup(userId:string,input:CreateGroupInput,actor?:GroupMutationActor):Promise<GroupSummary>{
 if(!normalizeCreateGroup(input))throw new GroupError('invalid_group');
 await groupAttempt(userId,'create');
 const created=await services().identity.createGroup({actorId:userId,handle:input.handle,name:input.name,...(input.description!==undefined?{description:input.description}:{}),...(input.parent_id!==undefined?{parentId:input.parent_id}:{})});
 await recordGroupChanges(created.changes,actor);
 return created.group;
}
/**
 * REPARENT (or detach, `parentId` null): a topology change (identity `setGroupParent` says what it refuses). Readers
 * of what the OLD ancestry shared are woken too, since the moved subtree's members no longer receive it.
 */
export async function setGroupParent(actorId:string,id:string,parentId:string|null,fromParentId?:string|null,actor?:GroupMutationActor):Promise<{changed:boolean;parent_id:string|null;hierarchy_revision?:number}>{
 const moved=await services().identity.setGroupParent({actorId,groupId:id,parentId,...(fromParentId!==undefined?{fromParentId}:{})});
 await recordGroupChanges(moved.changes,actor,moved.changed&&moved.previous_parent_id?[moved.previous_parent_id]:[]);
 return {changed:moved.changed,parent_id:moved.parent_id,...(moved.hierarchy_revision!==undefined?{hierarchy_revision:moved.hierarchy_revision}:{})};
}
export async function listGroups(userId:string):Promise<GroupSummary[]>{return (await (await getDb()).query<GroupSummary>('SELECT g.id,g.handle,g.name,g.description,m.role,g.parent_id FROM groups g JOIN group_members m ON m.group_id=g.id WHERE m.user_id=$1 AND g.deleted_at IS NULL ORDER BY g.name,g.id',[userId])).rows;}
const RELATIVE_SQL='SELECT g.id,g.handle,g.name,m.role FROM groups g LEFT JOIN group_members m ON m.group_id=g.id AND m.user_id=$2 WHERE g.deleted_at IS NULL AND ';
/** The people a group's shares reach through its subgroups who are not its own direct members, each with one subgroup that brings them in. */
const SUBGROUP_AUDIENCE_SQL=`SELECT * FROM (SELECT DISTINCT ON (m.user_id) m.user_id,u.username,u.name,g.id AS via_id,g.handle AS via_handle,g.name AS via_name
 FROM group_members m JOIN users u ON u.id=m.user_id JOIN groups g ON g.id=m.group_id
 WHERE m.group_id IN (${subtreeSql('$1')}) AND m.group_id<>$1 AND NOT EXISTS (SELECT 1 FROM group_members d WHERE d.group_id=$1 AND d.user_id=m.user_id)
 ORDER BY m.user_id,g.name,g.id) audience ORDER BY lower(coalesce(name,username,'')),user_id LIMIT 100`;
/**
 * A group's page, for a direct member. `members` are the direct rows; `parent` and `subgroups` place it in the tree
 * (each with the reader's own direct role there, never an inherited one); `subgroup_audience` is who else its shares
 * reach (./hierarchy: the direct members of every descendant), who are NOT members of this group.
 */
export async function getGroupDetail(userId:string|null,idOrHandle:string):Promise<GroupDetail|null>{
 const db=await getDb();const group=(await db.query<GroupRecord>('SELECT * FROM groups WHERE (id=$1 OR handle=$2) AND deleted_at IS NULL',[idOrHandle,idOrHandle.replace(/^@/,'').toLowerCase()])).rows[0];
 if(!group)return null;const role=await getGroupRole(userId,group.id,db);if(!role)return null;
 const members=await searchGroupMembers(userId!,group.id,'');
 const linked_groups=(await db.query<GroupSummary>('SELECT g.id,g.handle,g.name,g.description,m.role,g.parent_id FROM group_links l JOIN groups g ON g.id=l.linked_group_id LEFT JOIN group_members m ON m.group_id=g.id AND m.user_id=$2 WHERE l.group_id=$1 AND g.deleted_at IS NULL ORDER BY g.name',[group.id,userId])).rows;
 const invitations=role==='editor'?(await db.query<GroupInvitation>('SELECT id,email,role,created_at,invited_by FROM group_invitations WHERE group_id=$1 ORDER BY created_at',[group.id])).rows:undefined;
 const parent=group.parent_id?(await db.query<GroupRelative>(RELATIVE_SQL+'g.id=$1',[group.parent_id,userId])).rows[0]??null:null;
 const subgroups=(await db.query<GroupRelative>(RELATIVE_SQL+'g.parent_id=$1 ORDER BY g.name,g.id',[group.id,userId])).rows;
 const subgroup_audience=subgroups.length?(await db.query<{user_id:string;username:string|null;name:string|null;via_id:string;via_handle:string;via_name:string}>(SUBGROUP_AUDIENCE_SQL,[group.id])).rows.map(({via_id,via_handle,via_name,...person}):GroupAudienceMember=>({...person,via:{id:via_id,handle:via_handle,name:via_name}})):[];
 return {group:summary(group,role),members,linked_groups,...(invitations?{invitations}:{}),parent,subgroups,subgroup_audience};
}
export async function searchGroupMembers(userId:string,groupId:string,query:string):Promise<GroupMember[]>{const db=await getDb();if(!await getGroupRole(userId,groupId,db))throw new GroupError('not_found',404);return (await db.query<GroupMember>("SELECT m.user_id,u.username,u.name,m.role FROM group_members m JOIN users u ON u.id=m.user_id WHERE m.group_id=$1 AND ($2='' OR lower(m.user_id)=lower($2) OR strpos(lower(coalesce(u.username,'')||' '||coalesce(u.name,'')),lower($2))>0) ORDER BY (lower(m.user_id)=lower($2)) DESC,u.username,m.user_id LIMIT 100",[groupId,query.trim().replace(/^@/,'')])).rows;}
export async function setGroupMember(actorId:string,groupId:string,userId:string,role:GroupRole,actor?:GroupMutationActor):Promise<void>{
 await recordGroupChanges((await services().identity.setGroupMember({actorId,groupId,userId,role})).changes,actor);
}
export async function removeGroupMember(actorId:string,groupId:string,userId:string,actor?:GroupMutationActor):Promise<void>{
 await recordGroupChanges((await services().identity.removeGroupMember({actorId,groupId,userId})).changes,actor);
}
export async function inviteGroupMember(actorId:string,groupId:string,email:string,role:GroupRole,actor?:GroupMutationActor):Promise<GroupInvitation>{
 if(typeof email!=='string'||!/^\S+@\S+\.\S+$/.test(email.trim())||email.length>320||(role!=='editor'&&role!=='viewer'))throw new GroupError('invalid_invitation');
 await groupAttempt(actorId,'invite');
 const invited=await services().identity.inviteGroupMember({actorId,groupId,email,role});
 await recordGroupChanges(invited.changes,actor);
 return invited.invitation;
}
export async function removeGroupInvitation(actorId:string,groupId:string,id:string,actor?:GroupMutationActor):Promise<void>{
 await recordGroupChanges((await services().identity.removeGroupInvitation({actorId,groupId,invitationId:id})).changes,actor);
}
/**
 * A verified address's pending invitations join the account (identity consumes each exactly once). It runs on
 * every request a verified-email session makes and nearly always finds nothing, so it first asks with one plain,
 * unlocked read whether any live group holds an invitation for the address, and returns when none does. The read
 * is NOT remembered: an invitation written on any process is seen by the invitee's very next request.
 */
export async function acceptGroupInvitations(userId:string,verifiedEmail:string):Promise<string[]>{
 const email=verifiedEmail.trim().toLowerCase();
 if(!(await (await getDb()).query('SELECT 1 FROM group_invitations i JOIN groups g ON g.id=i.group_id WHERE i.email=$1 AND g.deleted_at IS NULL LIMIT 1',[email])).rows.length)return [];
 const accepted=await services().identity.acceptGroupInvitations({userId,email});
 await recordGroupChanges(accepted.changes);
 return accepted.groupIds;
}
/** Links are the app's (`group_links`): a direct editor of the group links another group they belong to. No recipients, so no mail. */
export async function setGroupLink(actorId:string,groupId:string,linkedId:string,present:boolean,actor?:GroupMutationActor):Promise<void>{await (await getDb()).transaction(async tx=>{
 const role=await getGroupRole(actorId,groupId,tx);if(!role)throw new GroupError('not_found',404);if(role!=='editor')throw new GroupError('forbidden',403);
 if(present){if(groupId===linkedId||!await getGroupRole(actorId,linkedId,tx))throw new GroupError('invalid_link');const changed=await tx.query('INSERT INTO group_links(group_id,linked_group_id) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING group_id',[groupId,linkedId]);if(changed.rows.length)await recordGroupMutation(tx,actorId,groupId,'linked',{linked_group_id:linkedId},[],actor);}
 else{const changed=await tx.query('DELETE FROM group_links WHERE group_id=$1 AND linked_group_id=$2 RETURNING group_id',[groupId,linkedId]);if(changed.rows.length)await recordGroupMutation(tx,actorId,groupId,'unlinked',{linked_group_id:linkedId},[],actor);}
});}
/** A preference naming a group that is no longer live reads as `inherit`: deleting a group rewrites nobody's row. */
export async function getAccountPreferences(userId:string):Promise<AccountPreferences>{return {default_destination:(await (await getDb()).query<{default_destination:DefaultDestination}>(`SELECT p.default_destination FROM account_preferences p WHERE p.user_id=$1
 AND (p.default_destination->>'type'<>'group' OR EXISTS (SELECT 1 FROM groups g WHERE g.id=p.default_destination->>'id' AND g.deleted_at IS NULL))`,[userId])).rows[0]?.default_destination??{type:'inherit'}};}
export async function setAccountPreferences(userId:string,destination:DefaultDestination):Promise<AccountPreferences>{if(!destination||!['personal','group','inherit'].includes(destination.type)||Object.keys(destination).some(k=>k!=='type'&&(destination.type!=='group'||k!=='id')))throw new GroupError('invalid_destination');await (await getDb()).transaction(async tx=>{if(destination.type==='group'&&(typeof destination.id!=='string'||!await getGroupRole(userId,destination.id,tx)))throw new GroupError('group_unavailable',403);await tx.query('INSERT INTO account_preferences(user_id,default_destination) VALUES($1,$2::jsonb) ON CONFLICT(user_id) DO UPDATE SET default_destination=EXCLUDED.default_destination',[userId,JSON.stringify(destination)]);});return {default_destination:destination};}
export { selectNewArtifactDestination } from './destination';

/** Mutable presentation only; handles are reserved identity tombstones. */
export async function updateGroup(actorId:string,id:string,input:UpdateGroupInput,actor?:GroupMutationActor):Promise<GroupSummary>{
 if(!input||typeof input!=='object')throw new GroupError('invalid_group');
 const updated=await services().identity.updateGroup({...input,actorId,groupId:id});
 await recordGroupChanges(updated.changes,actor);
 return updated.group;
}
/**
 * Delete a group (identity soft-deletes it, refusing one with live subgroups: `group_has_children`). The app refuses
 * first what only it can see: the deployment's default group, and a group that still owns pages. Those reads are
 * guidance, not a lock: rows that still name a deleted group (a page it owned, a share to it, a link, a preference)
 * are left as they are and simply grant nothing, because every read keeps live groups only.
 */
export async function deleteGroup(actorId:string,id:string,handle:string,actor?:GroupMutationActor):Promise<void>{
 const db=await getDb();
 const role=await getGroupRole(actorId,id,db);
 if(role==='editor'){
  if((await db.query('SELECT id FROM deployment_state WHERE default_group_id=$1',[id])).rows.length)throw new GroupError('default_group_locked',409);
  if((await db.query('SELECT id FROM artifacts WHERE group_id=$1 AND deleted_at IS NULL LIMIT 1',[id])).rows.length)throw new GroupError('group_not_empty',409);
 }
 await recordGroupChanges((await services().identity.deleteGroup({actorId,groupId:id,handle})).changes,actor);
}

export {recordGroupMutation,recordGroupChanges,groupQuota,mailGroupChanges} from './mutations';
import {recordGroupMutation} from './mutations';
export {reachedGroupsSql,subtreeSql,subtreeMemberIds} from './hierarchy';
export {ensureIdentityViews,identityViewStatements,syncIdentitySettings} from './identity-views';
