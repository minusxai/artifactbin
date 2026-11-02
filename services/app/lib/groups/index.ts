import {GroupError} from '../group-mutations';
import {groupAttempt,recordGroupMutation,type GroupMutationActor} from '../group-mutations';
/** Independent owners. Membership and links never derive authority from accounts or artifacts; users and groups share accounts' handle namespace. */
import type {UpdateGroupInput,AccountPreferences,CreateGroupInput,DefaultDestination,GroupDetail,GroupInvitation,GroupMember,GroupRole,GroupSummary,Queryable as ContractQueryable} from '@artifactbin/contracts';
import {isTestDomainEmail} from '@artifactbin/contracts';
import { TEST_DOMAIN, getDb, type Queryable, generateInternalId } from '../platform';
import { reserveHandle, isValidHandle } from '../accounts';
export interface GroupRecord {id:string;handle:string;name:string;description:string;created_by:string;deleted_at:string|null;}
export {GroupError} from '../group-mutations';
const roleValid=(role:unknown):role is GroupRole=>role==='editor'||role==='viewer';
const summary=(group:GroupRecord,role:GroupRole|null):GroupSummary=>({id:group.id,handle:group.handle,name:group.name,description:group.description,role});
export async function getGroupById(id:string,query?:ContractQueryable):Promise<GroupRecord|null>{return (await (query??await getDb()).query<GroupRecord>('SELECT * FROM groups WHERE id=$1 AND deleted_at IS NULL',[id])).rows[0]??null;}
export async function getGroupRole(userId:string|null,groupId:string,query?:ContractQueryable):Promise<GroupRole|null>{if(!userId)return null;return (await (query??await getDb()).query<{role:GroupRole}>('SELECT m.role FROM group_members m JOIN groups g ON g.id=m.group_id WHERE m.group_id=$1 AND m.user_id=$2 AND g.deleted_at IS NULL',[groupId,userId])).rows[0]?.role??null;}
/** A test account (lib/accounts/test-accounts) brings only test accounts and test-domain addresses into a group. */
const isTestAccount=async(tx:Queryable,userId:string)=>(await tx.query<{test_account:boolean}>('SELECT test_account FROM users WHERE id=$1',[userId])).rows[0]?.test_account===true;
async function requireEditor(tx:Queryable,actor:string,id:string){
 // Lock the group, not individual membership rows: concurrent editor removals serialize.
 if(!(await tx.query('SELECT id FROM groups WHERE id=$1 AND deleted_at IS NULL FOR UPDATE',[id])).rows.length)throw new GroupError('not_found',404);
 const role=await getGroupRole(actor,id,tx);if(!role)throw new GroupError('not_found',404);if(role!=='editor')throw new GroupError('forbidden',403);
}
export async function createGroup(userId:string,input:CreateGroupInput,actor?:GroupMutationActor):Promise<GroupSummary>{
 if(typeof input?.handle!=='string'||typeof input?.name!=='string'||(input.description!==undefined&&typeof input.description!=='string'))throw new GroupError('invalid_group');
 const handle=input.handle.toLowerCase().trim(),name=input.name.trim(),description=input.description?.trim()??'';
 if(!isValidHandle(handle)||!name||name.length>120||description.length>2000)throw new GroupError('invalid_group');
 await groupAttempt(userId,'create');const db=await getDb();return db.transaction(async tx=>{
 if(!(await tx.query("SELECT id FROM users WHERE id=$1 AND kind='account'",[userId])).rows.length)throw new GroupError('account_required',403);
 const id='grp_'+generateInternalId();
 try{await reserveHandle(tx,handle,'group',id);}catch(error){if((error as {code?:string}).code==='23505')throw new GroupError('handle_taken',409);throw error;}
 await tx.query('INSERT INTO groups(id,handle,name,description,created_by) VALUES($1,$2,$3,$4,$5)',[id,handle,name,description,userId]);
 await tx.query("INSERT INTO group_members(group_id,user_id,role) VALUES($1,$2,'editor')",[id,userId]);
 await recordGroupMutation(tx,userId,id,'created',{},[],actor);
 return {id,handle,name,description,role:'editor'};
 });
}
export async function listGroups(userId:string):Promise<GroupSummary[]>{return (await (await getDb()).query<GroupSummary>('SELECT g.id,g.handle,g.name,g.description,m.role FROM groups g JOIN group_members m ON m.group_id=g.id WHERE m.user_id=$1 AND g.deleted_at IS NULL ORDER BY g.name,g.id',[userId])).rows;}
export async function getGroupDetail(userId:string|null,idOrHandle:string):Promise<GroupDetail|null>{
 const db=await getDb();const group=(await db.query<GroupRecord>('SELECT * FROM groups WHERE (id=$1 OR handle=$2) AND deleted_at IS NULL',[idOrHandle,idOrHandle.replace(/^@/,'').toLowerCase()])).rows[0];
 if(!group)return null;const role=await getGroupRole(userId,group.id,db);if(!role)return null;
 const members=await searchGroupMembers(userId!,group.id,'');
 const linked_groups=(await db.query<GroupSummary>('SELECT g.id,g.handle,g.name,g.description,m.role FROM group_links l JOIN groups g ON g.id=l.linked_group_id LEFT JOIN group_members m ON m.group_id=g.id AND m.user_id=$2 WHERE l.group_id=$1 AND g.deleted_at IS NULL ORDER BY g.name',[group.id,userId])).rows;
 const invitations=role==='editor'?(await db.query<GroupInvitation>('SELECT id,email,role,created_at,invited_by FROM group_invitations WHERE group_id=$1 ORDER BY created_at',[group.id])).rows:undefined;
 return {group:summary(group,role),members,linked_groups,...(invitations?{invitations}:{})};
}
export async function searchGroupMembers(userId:string,groupId:string,query:string):Promise<GroupMember[]>{const db=await getDb();if(!await getGroupRole(userId,groupId,db))throw new GroupError('not_found',404);return (await db.query<GroupMember>("SELECT m.user_id,u.username,u.name,m.role FROM group_members m JOIN users u ON u.id=m.user_id WHERE m.group_id=$1 AND ($2='' OR lower(m.user_id)=lower($2) OR strpos(lower(coalesce(u.username,'')||' '||coalesce(u.name,'')),lower($2))>0) ORDER BY (lower(m.user_id)=lower($2)) DESC,u.username,m.user_id LIMIT 100",[groupId,query.trim().replace(/^@/,'')])).rows;}
async function protectLastEditor(tx:Queryable,id:string,userId:string){if(await getGroupRole(userId,id,tx)==='editor'&&Number((await tx.query<{count:string}>('SELECT count(*) FROM group_members WHERE group_id=$1 AND role=\'editor\'',[id])).rows[0].count)<=1)throw new GroupError('last_editor',409);}
export async function setGroupMember(actorId:string,groupId:string,userId:string,role:GroupRole,actor?:GroupMutationActor):Promise<void>{
 if(!roleValid(role))throw new GroupError('invalid_role');
 await (await getDb()).transaction(async tx=>{
  await requireEditor(tx,actorId,groupId);
  const previous=await getGroupRole(userId,groupId,tx);if(!previous)throw new GroupError('not_member',404);
  if(await isTestAccount(tx,actorId)&&!await isTestAccount(tx,userId))throw new GroupError('test_account_restricted',403);
  if(previous===role)return;
  if(role!=='editor')await protectLastEditor(tx,groupId,userId);
  await tx.query('UPDATE group_members SET role=$3 WHERE group_id=$1 AND user_id=$2',[groupId,userId,role]);
  await recordGroupMutation(tx,actorId,groupId,'role_changed',{user_id:userId,previous_role:previous,role},[userId],actor);
 });
}
export async function removeGroupMember(actorId:string,groupId:string,userId:string,actor?:GroupMutationActor):Promise<void>{await (await getDb()).transaction(async tx=>{if(actorId===userId){if(!(await tx.query('SELECT id FROM groups WHERE id=$1 AND deleted_at IS NULL FOR UPDATE',[groupId])).rows.length||!await getGroupRole(actorId,groupId,tx))throw new GroupError('not_found',404);}else await requireEditor(tx,actorId,groupId);if(!await getGroupRole(userId,groupId,tx))return;await protectLastEditor(tx,groupId,userId);await tx.query('DELETE FROM group_members WHERE group_id=$1 AND user_id=$2',[groupId,userId]);await recordGroupMutation(tx,actorId,groupId,'member_removed',{user_id:userId},[userId],actor);});}
export async function inviteGroupMember(actorId:string,groupId:string,email:string,role:GroupRole,actor?:GroupMutationActor):Promise<GroupInvitation>{if(typeof email!=='string'||!/^\S+@\S+\.\S+$/.test(email.trim())||email.length>320||!roleValid(role))throw new GroupError('invalid_invitation');await groupAttempt(actorId,'invite');return (await getDb()).transaction(async tx=>{await requireEditor(tx,actorId,groupId);if(await isTestAccount(tx,actorId)&&!(TEST_DOMAIN&&isTestDomainEmail(email,TEST_DOMAIN)))throw new GroupError('test_account_restricted',403);const previous=(await tx.query<GroupInvitation>('SELECT id,email,role,created_at,invited_by FROM group_invitations WHERE group_id=$1 AND email=$2',[groupId,email.trim().toLowerCase()])).rows[0];if(previous?.role===role)return {...previous,changed:false};if(!previous&&Number((await tx.query<{count:string}>('SELECT count(*) FROM group_invitations WHERE group_id=$1',[groupId])).rows[0].count)>=500)throw new GroupError('rate_limited',429,3600);const invitation=(await tx.query<GroupInvitation>('INSERT INTO group_invitations(id,group_id,email,role,invited_by) VALUES($1,$2,$3,$4,$5) ON CONFLICT(group_id,email) DO UPDATE SET role=EXCLUDED.role,invited_by=EXCLUDED.invited_by RETURNING id,email,role,created_at,invited_by',['gin_'+generateInternalId(),groupId,email.trim().toLowerCase(),role,actorId])).rows[0];await recordGroupMutation(tx,actorId,groupId,'invited',{invitation_id:invitation.id,previous_role:previous?.role??null,role},[],actor);return {...invitation,changed:true};});}
export async function removeGroupInvitation(actorId:string,groupId:string,id:string,actor?:GroupMutationActor):Promise<void>{await (await getDb()).transaction(async tx=>{await requireEditor(tx,actorId,groupId);const changed=await tx.query('DELETE FROM group_invitations WHERE group_id=$1 AND id=$2 RETURNING id',[groupId,id]);if(!changed.rows.length)throw new GroupError('not_found',404);await recordGroupMutation(tx,actorId,groupId,'uninvited',{invitation_id:id},[],actor);});}
/**
 * Only the admission workflow calls this after inbox verification. It may share its transaction.
 *
 * It also runs on every request a verified-email session makes, and nearly always finds nothing, so a
 * caller that brings no transaction of its own first asks with one plain, unlocked read whether any live
 * group holds an invitation for the address, and returns when none does: no transaction, no row locks, no
 * pool connection held. When one exists the locked transaction below runs unchanged. The read is NOT
 * remembered: an invitation written on any process is seen by the invitee's very next request, which a
 * per-process "nothing pending" memo could not promise. A caller that passes its transaction (login
 * admission) always runs the checked, locked path.
 */
export async function acceptGroupInvitations(userId:string,verifiedEmail:string,query?:Queryable):Promise<string[]>{
 if(!query&&!(await (await getDb()).query('SELECT 1 FROM group_invitations i JOIN groups g ON g.id=i.group_id WHERE i.email=$1 AND g.deleted_at IS NULL LIMIT 1',[verifiedEmail.trim().toLowerCase()])).rows.length)return [];
 const accept=async(tx:Queryable)=>{
 const email=verifiedEmail.trim().toLowerCase();if(!(await tx.query("SELECT id FROM users WHERE id=$1 AND email=$2 AND kind='account'",[userId,email])).rows.length)throw new GroupError('verified_email_mismatch',403);
 const invitations=(await tx.query<{id:string;group_id:string;role:GroupRole}>('SELECT i.id,i.group_id,i.role FROM group_invitations i JOIN groups g ON g.id=i.group_id WHERE i.email=$1 AND g.deleted_at IS NULL ORDER BY i.group_id FOR UPDATE OF g,i',[email])).rows;
 for(const invitation of invitations){await tx.query("INSERT INTO group_members(group_id,user_id,role) VALUES($1,$2,$3) ON CONFLICT(group_id,user_id) DO UPDATE SET role=CASE WHEN group_members.role='editor' THEN 'editor' ELSE EXCLUDED.role END",[invitation.group_id,userId,invitation.role]);await tx.query('DELETE FROM group_invitations WHERE id=$1',[invitation.id]);await recordGroupMutation(tx,userId,invitation.group_id,'joined',{role:invitation.role},[]);}return invitations.map(i=>i.group_id);
 };return query?accept(query):(await getDb()).transaction(accept);}
export async function setGroupLink(actorId:string,groupId:string,linkedId:string,present:boolean,actor?:GroupMutationActor):Promise<void>{await (await getDb()).transaction(async tx=>{await requireEditor(tx,actorId,groupId);if(present){if(groupId===linkedId||!await getGroupRole(actorId,linkedId,tx))throw new GroupError('invalid_link');const changed=await tx.query('INSERT INTO group_links(group_id,linked_group_id) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING group_id',[groupId,linkedId]);if(changed.rows.length)await recordGroupMutation(tx,actorId,groupId,'linked',{linked_group_id:linkedId},[],actor);}else{const changed=await tx.query('DELETE FROM group_links WHERE group_id=$1 AND linked_group_id=$2 RETURNING group_id',[groupId,linkedId]);if(changed.rows.length)await recordGroupMutation(tx,actorId,groupId,'unlinked',{linked_group_id:linkedId},[],actor);}});}
export async function getAccountPreferences(userId:string):Promise<AccountPreferences>{return {default_destination:(await (await getDb()).query<{default_destination:DefaultDestination}>('SELECT default_destination FROM account_preferences WHERE user_id=$1',[userId])).rows[0]?.default_destination??{type:'inherit'}};}
export async function setAccountPreferences(userId:string,destination:DefaultDestination):Promise<AccountPreferences>{if(!destination||!['personal','group','inherit'].includes(destination.type)||Object.keys(destination).some(k=>k!=='type'&&(destination.type!=='group'||k!=='id')))throw new GroupError('invalid_destination');await (await getDb()).transaction(async tx=>{if(destination.type==='group'&&(typeof destination.id!=='string'||!await getGroupRole(userId,destination.id,tx)))throw new GroupError('group_unavailable',403);await tx.query('INSERT INTO account_preferences(user_id,default_destination) VALUES($1,$2::jsonb) ON CONFLICT(user_id) DO UPDATE SET default_destination=EXCLUDED.default_destination',[userId,JSON.stringify(destination)]);});return {default_destination:destination};}
export { selectNewArtifactDestination } from './destination';

/** Mutable presentation only; handles are reserved identity tombstones. */
export async function updateGroup(actorId:string,id:string,input:UpdateGroupInput,actor?:GroupMutationActor):Promise<GroupSummary>{
 if(!input||typeof input!=='object'||!Object.keys(input).length||Object.keys(input).some(key=>!['name','description'].includes(key))||(input.name!==undefined&&(typeof input.name!=='string'||!input.name.trim()||input.name.trim().length>120))||(input.description!==undefined&&(typeof input.description!=='string'||input.description.trim().length>2000)))throw new GroupError('invalid_group');
 return (await getDb()).transaction(async tx=>{
  await requireEditor(tx,actorId,id);const before=(await getGroupById(id,tx))!;
  const name=input.name?.trim()??before.name,description=input.description?.trim()??before.description;
  if(name===before.name&&description===before.description)return summary(before,'editor');
  const row=(await tx.query<GroupRecord>('UPDATE groups SET name=$2,description=$3 WHERE id=$1 RETURNING *',[id,name,description])).rows[0];
  await recordGroupMutation(tx,actorId,id,'updated',{previous:{name:before.name,description:before.description},next:{name,description}},[],actor);
  return summary(row,'editor');
 });
}
export async function deleteGroup(actorId:string,id:string,handle:string,actor?:GroupMutationActor):Promise<void>{
 await (await getDb()).transaction(async tx=>{
 await requireEditor(tx,actorId,id);
 const group=await getGroupById(id,tx);
 if(handle!==group!.handle)throw new GroupError('handle_mismatch',409);
 // Setup must lock this live group before assigning it; a plain state read avoids reverse lock ordering.
 if((await tx.query('SELECT id FROM deployment_state WHERE default_group_id=$1',[id])).rows.length)throw new GroupError('default_group_locked',409);
 if((await tx.query('SELECT id FROM artifacts WHERE group_id=$1 AND deleted_at IS NULL LIMIT 1',[id])).rows.length)throw new GroupError('group_not_empty',409);
 const members=(await tx.query<{user_id:string}>('SELECT user_id FROM group_members WHERE group_id=$1',[id])).rows.map(row=>row.user_id);
 await recordGroupMutation(tx,actorId,id,'deleted',{},members,actor);
 await tx.query('DELETE FROM artifact_group_shares WHERE group_id=$1',[id]);
 await tx.query('DELETE FROM group_invitations WHERE group_id=$1',[id]);
 await tx.query('DELETE FROM group_links WHERE group_id=$1 OR linked_group_id=$1',[id]);
 await tx.query('DELETE FROM group_members WHERE group_id=$1',[id]);
 await tx.query("UPDATE account_preferences SET default_destination='{\"type\":\"inherit\"}'::jsonb WHERE default_destination->>'type'='group' AND default_destination->>'id'=$1",[id]);
 await tx.query('UPDATE groups SET deleted_at=now() WHERE id=$1',[id]);
 });
}

export {recordGroupMutation,groupQuota} from '../group-mutations';
