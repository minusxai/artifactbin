import {admissionPolicyOf} from '@artifactbin/auth';
import {isGroupRole} from '@artifactbin/contracts';
import {GroupError} from './errors';
import {groupAttempt,recordGroupChanges,type GroupMutationActor} from './mutations';
import {groupAdminSql,subtreeSql} from './hierarchy';
/**
 * GROUPS, AS THE APP SEES THEM. Every write (create, rename, delete, reparent, membership, invitations) is the
 * identity module's (lib/platform `services().identity`, contracts `IdentityService`): these functions translate a
 * request into its call, charge the app's quota before it, and run the app's half (audit, events, waking readers)
 * after it commits (./mutations). Reads join the shared tables directly. Membership and links never derive
 * authority from accounts or artifacts; users and groups share one handle namespace (identity's).
 */
import {normalizeCreateGroup} from '@artifactbin/contracts';
import type {UpdateGroupInput,AccountPreferences,CreateGroupInput,DefaultDestination,GroupAudienceMember,GroupDetail,GroupInvitation,GroupMember,GroupRelative,GroupRole,GroupSummary,Queryable as ContractQueryable} from '@artifactbin/contracts';
import { getDb, services, deploymentConfig, env, emit, serviceAudiences } from '../platform';
import {groupSignInServiceConfigured} from '@artifactbin/contracts';
export interface GroupRecord {id:string;handle:string;name:string;description:string;created_by:string;deleted_at:string|null;parent_id:string|null;}
export {GroupError} from './errors';
const summary=(group:GroupRecord,role:GroupRole|null):GroupSummary=>({id:group.id,handle:group.handle,name:group.name,description:group.description,role,parent_id:group.parent_id??null});
export async function getGroupById(id:string,query?:ContractQueryable):Promise<GroupRecord|null>{return (await (query??await getDb()).query<GroupRecord>('SELECT * FROM groups WHERE id=$1 AND deleted_at IS NULL',[id])).rows[0]??null;}
/**
 * SQL over a live `groups` row aliased `g` and the reader `user`: the reader's EFFECTIVE role there, `admin` when they
 * administer it directly or through an ancestor (./hierarchy `groupAdminSql`), else their direct membership's role, else
 * null. Editor and Member never come from the tree.
 */
export const effectiveRoleSql=(user:string)=>`CASE WHEN ${groupAdminSql(user,'g.id')} THEN 'admin' ELSE (SELECT m.role FROM group_members m WHERE m.group_id=g.id AND m.user_id=${user}) END`;
/**
 * The reader's role in a live group, the one every access decision asks (lib/artifact-access facts): `admin` for an
 * admin of it or of any ancestor, else the direct membership's role, else null. An inherited admin is not a member:
 * membership listings, mail and the last-admin guard read the direct rows.
 */
export async function getGroupRole(userId:string|null,groupId:string,query?:ContractQueryable):Promise<GroupRole|null>{if(!userId)return null;return (await (query??await getDb()).query<{role:GroupRole|null}>(`SELECT ${effectiveRoleSql('$2')} AS role FROM groups g WHERE g.id=$1 AND g.deleted_at IS NULL`,[groupId,userId])).rows[0]?.role??null;}
/**
 * The role an actor holds on a live group for a CONTENT decision (where it may publish, what it may edit): a person's
 * `getGroupRole`; a group's sign-in (lib/accounts `GroupPrincipal`) holds its level on its own group and nothing on any
 * other, as a direct member of that group alone would.
 */
export async function actorGroupRole(actor:{userId:string|null;principalGroup?:{id:string;role:'member'|'editor'}|null},groupId:string,query?:ContractQueryable):Promise<GroupRole|null>{
 if(actor.principalGroup)return actor.principalGroup.id===groupId&&await getGroupById(groupId,query)?actor.principalGroup.role:null;
 return getGroupRole(actor.userId,groupId,query);
}
/** The ancestor the reader administers live `groupId` through when they hold no direct `admin` row on it (an inherited admin), or null. */
async function inheritedAdminVia(userId:string,groupId:string,query:ContractQueryable):Promise<{id:string;handle:string;name:string}|null>{
 // `via_group_id` is the nearest group with a direct admin row: the group itself for a direct admin.
 return (await query.query<{id:string;handle:string;name:string}>('SELECT g.id,g.handle,g.name FROM group_admins ga JOIN groups g ON g.id=ga.via_group_id WHERE ga.group_id=$1 AND ga.user_id=$2 AND ga.via_group_id<>ga.group_id',[groupId,userId])).rows[0]??null;
}
/**
 * A new group, a root or (`parent_id`) a subgroup: a topology change, which moves the hierarchy revision. Only an
 * admin of the parent (directly or through an ancestor) creates beneath it, because the new subtree's members receive
 * the parent's shares.
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
/** The reader's DIRECT memberships. An inherited admin reaches a subgroup from its parent's page (`subgroups`), and is no member of it. */
export async function listGroups(userId:string):Promise<GroupSummary[]>{return (await (await getDb()).query<GroupSummary>('SELECT g.id,g.handle,g.name,g.description,m.role,g.parent_id FROM groups g JOIN group_members m ON m.group_id=g.id WHERE m.user_id=$1 AND g.deleted_at IS NULL ORDER BY g.name,g.id',[userId])).rows;}
const RELATIVE_SQL=`SELECT g.id,g.handle,g.name,${effectiveRoleSql('$2')} AS role FROM groups g WHERE g.deleted_at IS NULL AND `;
/** The people a group's shares reach through its subgroups who are not its own direct members, each with one subgroup that brings them in. */
const SUBGROUP_AUDIENCE_SQL=`SELECT * FROM (SELECT DISTINCT ON (m.user_id) m.user_id,u.username,u.name,g.id AS via_id,g.handle AS via_handle,g.name AS via_name
 FROM group_members m JOIN users u ON u.id=m.user_id JOIN groups g ON g.id=m.group_id
 WHERE m.group_id IN (${subtreeSql('$1')}) AND m.group_id<>$1 AND NOT EXISTS (SELECT 1 FROM group_members d WHERE d.group_id=$1 AND d.user_id=m.user_id)
 ORDER BY m.user_id,g.name,g.id) audience ORDER BY lower(coalesce(name,username,'')),user_id LIMIT 100`;
/**
 * A group's page, for a member or an admin of it (directly or through an ancestor). `members` are the direct rows, so an
 * inherited admin is never listed: `admin_via` names the ancestor their authority comes from (absent for everyone else).
 * `parent` and `subgroups` place it in the tree, each with the reader's role there (`getGroupRole`'s, so a subgroup of a
 * group they administer reads `admin`); `subgroup_audience` is who else its shares reach (./hierarchy: the direct
 * members of every descendant), who are NOT members of this group.
 */
export async function getGroupDetail(userId:string|null,idOrHandle:string):Promise<GroupDetail|null>{
 const db=await getDb();const group=(await db.query<GroupRecord>('SELECT * FROM groups WHERE (id=$1 OR handle=$2) AND deleted_at IS NULL',[idOrHandle,idOrHandle.replace(/^@/,'').toLowerCase()])).rows[0];
 if(!group)return null;const role=await getGroupRole(userId,group.id,db);if(!role)return null;
 const admin_via=role==='admin'?await inheritedAdminVia(userId!,group.id,db):null;
 const members=await searchGroupMembers(userId!,group.id,'');
 const linked_groups=(await db.query<GroupSummary>('SELECT g.id,g.handle,g.name,g.description,m.role,g.parent_id FROM group_links l JOIN groups g ON g.id=l.linked_group_id LEFT JOIN group_members m ON m.group_id=g.id AND m.user_id=$2 WHERE l.group_id=$1 AND g.deleted_at IS NULL ORDER BY g.name',[group.id,userId])).rows;
 const invitations=role==='admin'?(await db.query<GroupInvitation>('SELECT id,email,role,created_at,invited_by FROM group_invitations WHERE group_id=$1 ORDER BY created_at',[group.id])).rows:undefined;
 const parent=group.parent_id?(await db.query<GroupRelative>(RELATIVE_SQL+'g.id=$1',[group.parent_id,userId])).rows[0]??null:null;
 const subgroups=(await db.query<GroupRelative>(RELATIVE_SQL+'g.parent_id=$1 ORDER BY g.name,g.id',[group.id,userId])).rows;
 const subgroup_audience=subgroups.length?(await db.query<{user_id:string;username:string|null;name:string|null;via_id:string;via_handle:string;via_name:string}>(SUBGROUP_AUDIENCE_SQL,[group.id])).rows.map(({via_id,via_handle,via_name,...person}):GroupAudienceMember=>({...person,via:{id:via_id,handle:via_handle,name:via_name}})):[];
 return {group:summary(group,role),members,linked_groups,...(invitations?{invitations}:{}),parent,subgroups,subgroup_audience,...(admin_via?{admin_via}:{})};
}
export async function searchGroupMembers(userId:string,groupId:string,query:string):Promise<GroupMember[]>{const db=await getDb();if(!await getGroupRole(userId,groupId,db))throw new GroupError('not_found',404);return (await db.query<GroupMember>("SELECT m.user_id,u.username,u.name,m.role FROM group_members m JOIN users u ON u.id=m.user_id WHERE m.group_id=$1 AND ($2='' OR lower(m.user_id)=lower($2) OR strpos(lower(coalesce(u.username,'')||' '||coalesce(u.name,'')),lower($2))>0) ORDER BY (lower(m.user_id)=lower($2)) DESC,u.username,m.user_id LIMIT 100",[groupId,query.trim().replace(/^@/,'')])).rows;}
export async function setGroupMember(actorId:string,groupId:string,userId:string,role:GroupRole,actor?:GroupMutationActor):Promise<void>{
 await recordGroupChanges((await services().identity.setGroupMember({actorId,groupId,userId,role})).changes,actor);
}
export async function removeGroupMember(actorId:string,groupId:string,userId:string,actor?:GroupMutationActor):Promise<void>{
 await recordGroupChanges((await services().identity.removeGroupMember({actorId,groupId,userId})).changes,actor);
}
export async function inviteGroupMember(actorId:string,groupId:string,email:string,role:GroupRole,actor?:GroupMutationActor):Promise<GroupInvitation>{
 if(typeof email!=='string'||!/^\S+@\S+\.\S+$/.test(email.trim())||email.length>320||!isGroupRole(role))throw new GroupError('invalid_invitation');
 // Admission must be checked before identity queues mail; an invitation cannot override sign-in policy.
 if(deploymentConfig().mode==='company'){
  const actorRole=await getGroupRole(actorId,groupId);
  if(!actorRole)throw new GroupError('not_found',404);
  if(actorRole!=='admin')throw new GroupError('forbidden',403);
  const policy=admissionPolicyOf({},(_source,key)=>{const [module,name]=key.split('__');return env(module!,name!);});
  if(!policy.matches(email)){
   // Previously admitted people retain access when an operator tightens the new-account policy.
   const admitted=await (await getDb()).query('SELECT 1 FROM users u JOIN deployment_members m ON m.user_id=u.id WHERE lower(u.email)=$1 LIMIT 1',[email.trim().toLowerCase()]);
   if(!admitted.rows.length)throw new GroupError('invitation_email_not_allowed',400);
  }
 }
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
/** Links are the app's (`group_links`): an admin of the group (directly or through an ancestor) links another group they belong to or administer. No recipients, so no mail. */
export async function setGroupLink(actorId:string,groupId:string,linkedId:string,present:boolean,actor?:GroupMutationActor):Promise<void>{await (await getDb()).transaction(async tx=>{
 const role=await getGroupRole(actorId,groupId,tx);if(!role)throw new GroupError('not_found',404);if(role!=='admin')throw new GroupError('forbidden',403);
 if(present){if(groupId===linkedId||!await getGroupRole(actorId,linkedId,tx))throw new GroupError('invalid_link');const changed=await tx.query('INSERT INTO group_links(group_id,linked_group_id) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING group_id',[groupId,linkedId]);if(changed.rows.length)await recordGroupMutation(tx,actorId,groupId,'linked',{linked_group_id:linkedId},[],actor);}
 else{const changed=await tx.query('DELETE FROM group_links WHERE group_id=$1 AND linked_group_id=$2 RETURNING group_id',[groupId,linkedId]);if(changed.rows.length)await recordGroupMutation(tx,actorId,groupId,'unlinked',{linked_group_id:linkedId},[],actor);}
});}
/** The saved preference as it stands: one naming a deleted group is left in place (the home page reports it unavailable). */
export async function getAccountPreferences(userId:string):Promise<AccountPreferences>{return {default_destination:(await (await getDb()).query<{default_destination:DefaultDestination}>('SELECT default_destination FROM account_preferences WHERE user_id=$1',[userId])).rows[0]?.default_destination??{type:'inherit'}};}
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
 if(role==='admin'){
  if((await db.query('SELECT id FROM deployment_state WHERE default_group_id=$1',[id])).rows.length)throw new GroupError('default_group_locked',409);
  if((await db.query('SELECT id FROM artifacts WHERE group_id=$1 AND deleted_at IS NULL LIMIT 1',[id])).rows.length)throw new GroupError('group_not_empty',409);
 }
 await recordGroupChanges((await services().identity.deleteGroup({actorId,groupId:id,handle})).changes,actor);
}

export {recordGroupMutation,recordGroupChanges,groupQuota,mailGroupChanges} from './mutations';
import {recordGroupMutation} from './mutations';
export {groupAdminSql,groupReachSql,reachedGroupsSql,subtreeSql,subtreeMemberIds,groupChain} from './hierarchy';

/**
 * A PERSON'S SIGN-IN OF AN AGENT AS THE GROUP, as the group's Admins see it (contracts identity-service
 * `GROUP_SIGN_IN_RULE`): an agent acting as the group at `role`, authorised by `issued_by` (the person), and whether
 * it is still `live`. Never its secret.
 */
interface GroupSignIn {id:string;name:string|null;role:'member'|'editor';issued_by:{id:string;username:string|null;name:string|null};created_at:string;expires_at:string|null;last_used_at:string|null;live:boolean;}
/**
 * A SERVICE'S SIGN-INS UNDER ONE APPROVAL, as one row (contracts service-audiences `GROUP_SIGN_IN_PATH`): how many
 * unexpired ones it holds and when it last obtained one. Revoking the approval ends them all, so they are not listed
 * one by one (a service that signs in often would bury people's).
 */
interface GroupServiceSignIns {grant_id:string;service_id:string;role:'member'|'editor';count:number;last_issued_at:string;approved_at:string;}
/** One page of a group's sign-ins: people's newest first (`next` positions the following page), and every approval's row. */
export interface GroupSignInPage {sign_ins:GroupSignIn[];next:{created:string;id:string}|null;services:GroupServiceSignIns[];}
/** Refuse anyone but an Admin of the group (direct, or through an ancestor): `forbidden` for its other people, `not_found` otherwise. */
async function requireGroupAdmin(userId:string,groupId:string,db:ContractQueryable):Promise<void>{
 if((await db.query('SELECT 1 FROM group_admins WHERE group_id=$1 AND user_id=$2',[groupId,userId])).rows.length)return;
 throw await getGroupRole(userId,groupId,db)?new GroupError('forbidden',403):new GroupError('not_found',404);
}
/**
 * A group's unexpired, unrevoked sign-ins, for one of its Admins: people's in full, newest first, `limit` at a time
 * after `after` (the previous page's `next`); and a service's as one row per live approval, counting only the sign-ins
 * that would be accepted (none: no row).
 */
export async function listGroupSignIns(userId:string,groupId:string,page:{limit:number;after?:{created:string;id:string}}={limit:50}):Promise<GroupSignInPage>{
 const db=await getDb();await requireGroupAdmin(userId,groupId,db);
 const rows=(await db.query<GroupSignIn&{issuer_username:string|null;issuer_name:string|null;issuer_id:string;position:string}>(`SELECT t.id,t.name,t.group_role AS role,t.issued_by AS issuer_id,u.username AS issuer_username,u.name AS issuer_name,t.created_at,t.expires_at,t.last_used_at,t.live,
    t.created_at::text AS position
   FROM tokens t LEFT JOIN users u ON u.id=t.issued_by
  WHERE t.group_id=$1 AND t.user_id IS NULL AND t.grant_id IS NULL AND t.deleted_at IS NULL AND (t.expires_at IS NULL OR t.expires_at>now())
    AND ($3::timestamptz IS NULL OR (t.created_at,t.id) < ($3::timestamptz,$4::text))
  ORDER BY t.created_at DESC,t.id DESC LIMIT $2`,[groupId,page.limit+1,page.after?.created??null,page.after?.id??null])).rows;
 const shown=rows.slice(0,page.limit).map(({issuer_id,issuer_username,issuer_name,position:_position,...row})=>({...row,issued_by:{id:issuer_id,username:issuer_username,name:issuer_name}}));
 // The position is the database's own text of the time (microseconds), so a page never repeats or skips a row.
 const last=rows[page.limit-1];
 // Counted by approval: only the sign-ins a request would accept, by the rules that decide it on use (lib/accounts
 // `liveGroupSignIn`): the `tokens` view's `live`, and the service still configured as it was approved.
 const configured=serviceAudiences();
 const services=(await db.query<Omit<GroupServiceSignIns,'count'>&{count:string|number;service_origin:string|null}>(`SELECT g.id AS grant_id,g.service_id,g.role,count(t.id) AS count,max(t.created_at) AS last_issued_at,g.created_at AS approved_at,g.service_origin
   FROM group_sign_in_grants g JOIN tokens t ON t.grant_id=g.id AND t.group_id=g.group_id AND t.deleted_at IS NULL AND (t.expires_at IS NULL OR t.expires_at>now()) AND t.live
  WHERE g.group_id=$1 AND g.deleted_at IS NULL GROUP BY g.id,g.service_id,g.role,g.created_at,g.service_origin ORDER BY max(t.created_at) DESC,g.id`,[groupId])).rows
  .filter(row=>groupSignInServiceConfigured(configured,row.service_id,row.service_origin))
  .map(({service_origin:_origin,...row})=>({...row,count:Number(row.count),last_issued_at:new Date(row.last_issued_at).toISOString(),approved_at:new Date(row.approved_at).toISOString()}));
 return {sign_ins:shown,next:rows.length>page.limit&&last?{created:last.position,id:last.id}:null,services};
}
/** An Admin of the group ends one of its sign-ins, through the identity module (which checks the Admin again); false when none matched. */
export async function revokeGroupSignIn(userId:string,groupId:string,id:string):Promise<boolean>{
 const row=await services().identity.revokeGroupSignIn({actorId:userId,groupId,id});
 if(!row)return false;
 void emit({kind:'user',id:userId},'revoked',{kind:'token',id},{name:row.name,group_id:groupId});
 return true;
}

/**
 * A GROUP'S APPROVALS OF SERVICES (contracts service-audiences `GROUP_SIGN_IN_PATH`), as its Admins see and change them
 * on the group's settings page: each live approval with who approved it (history only), and the configured services
 * that may be approved (those that opted in with `group_sign_ins`). The identity module writes and re-checks the Admin.
 */
export interface ServiceGroupSignIn {id:string;service_id:string;role:'member'|'editor';approved_by:{id:string;username:string|null;name:string|null};created_at:string;
 /** Whether the service is still configured as it was approved (with the opt-in, at the same origin): only then does it act. */
 configured:boolean;}
export async function listServiceGroupSignIns(userId:string,groupId:string):Promise<{approvals:ServiceGroupSignIn[];services:{id:string;origin:string}[]}>{
 const db=await getDb();await requireGroupAdmin(userId,groupId,db);
 const configured=serviceAudiences();
 const approvals=(await db.query<Omit<ServiceGroupSignIn,'configured'>&{service_origin:string|null;approver_id:string;approver_username:string|null;approver_name:string|null}>(`SELECT g.id,g.service_id,g.role,g.created_at,g.service_origin,g.approved_by AS approver_id,u.username AS approver_username,u.name AS approver_name
   FROM group_sign_in_grants g LEFT JOIN users u ON u.id=g.approved_by WHERE g.group_id=$1 AND g.deleted_at IS NULL ORDER BY g.created_at,g.id`,[groupId])).rows
  .map(({approver_id,approver_username,approver_name,service_origin,...row})=>({...row,approved_by:{id:approver_id,username:approver_username,name:approver_name},configured:groupSignInServiceConfigured(configured,row.service_id,service_origin)}));
 return {approvals,services:serviceAudiences().filter(service=>service.groupSignIns).map(service=>({id:service.id,origin:service.origin}))};
}
/**
 * An Admin approves a configured service that opted in, at its configured origin; anything else is `unknown_service`
 * (400). A new approval is audited as the group's change (`service_sign_in_approved`: who, the service, the level).
 */
export async function approveServiceGroupSignIn(userId:string,groupId:string,serviceId:unknown,role:unknown,actor?:GroupMutationActor):Promise<{id:string}>{
 const service=typeof serviceId==='string'?serviceAudiences().find(entry=>entry.groupSignIns&&entry.id===serviceId):undefined;
 if(!service)throw new GroupError('unknown_service',400);
 if(role!=='member'&&role!=='editor')throw new GroupError('invalid_role',400);
 const {grant,changes}=await services().identity.approveServiceGroupSignIn({actorId:userId,groupId,serviceId:service.id,serviceOrigin:service.origin,role});
 await recordGroupChanges(changes,actor);
 return {id:grant.id};
}
/** An Admin ends an approval, audited (`service_sign_in_revoked`): false when none was live. */
export async function revokeServiceGroupSignIn(userId:string,groupId:string,id:string,actor?:GroupMutationActor):Promise<boolean>{
 const revoked=await services().identity.revokeServiceGroupSignIn({actorId:userId,groupId,id});
 if(!revoked)return false;
 await recordGroupChanges(revoked.changes,actor);
 return true;
}
