/** Independent owners. Membership and links never derive authority from accounts or artifacts. */
import type {AccountPreferences,CreateGroupInput,DefaultDestination,GroupDetail,GroupInvitation,GroupMember,GroupRole,GroupSummary,Queryable as ContractQueryable} from '@artifactbin/contracts';
import {getDb,type Queryable} from '../platform/db';
import {generateInternalId} from '../platform/ids';
import {reserveHandle,RESERVED_HANDLES} from '../platform/handles';
export interface GroupRecord {id:string;handle:string;name:string;description:string;created_by:string;deleted_at:string|null;}
export class GroupError extends Error {constructor(public code:string,public status=400){super(code);}}
const roleValid=(role:unknown):role is GroupRole=>role==='editor'||role==='viewer';
const summary=(group:GroupRecord,role:GroupRole|null):GroupSummary=>({id:group.id,handle:group.handle,name:group.name,description:group.description,role});
export async function getGroupById(id:string,query?:ContractQueryable):Promise<GroupRecord|null>{return (await (query??await getDb()).query<GroupRecord>('SELECT * FROM groups WHERE id=$1 AND deleted_at IS NULL',[id])).rows[0]??null;}
export async function getGroupRole(userId:string|null,groupId:string,query?:ContractQueryable):Promise<GroupRole|null>{if(!userId)return null;return (await (query??await getDb()).query<{role:GroupRole}>('SELECT m.role FROM group_members m JOIN groups g ON g.id=m.group_id WHERE m.group_id=$1 AND m.user_id=$2 AND g.deleted_at IS NULL',[groupId,userId])).rows[0]?.role??null;}
async function requireEditor(tx:Queryable,actor:string,id:string){
 // Lock the group, not individual membership rows: concurrent editor removals serialize.
 if(!(await tx.query('SELECT id FROM groups WHERE id=$1 AND deleted_at IS NULL FOR UPDATE',[id])).rows.length)throw new GroupError('not_found',404);
 if(await getGroupRole(actor,id,tx)!=='editor')throw new GroupError('forbidden',403);
}
export async function createGroup(userId:string,input:CreateGroupInput):Promise<GroupSummary>{
 if(typeof input?.handle!=='string'||typeof input?.name!=='string'||(input.description!==undefined&&typeof input.description!=='string'))throw new GroupError('invalid_group');
 const handle=input.handle.toLowerCase().trim(),name=input.name.trim(),description=input.description?.trim()??'';
 if(!/^[a-z0-9][a-z0-9_-]{2,31}$/.test(handle)||RESERVED_HANDLES.has(handle)||!name||name.length>120||description.length>2000)throw new GroupError('invalid_group');
 const db=await getDb();return db.transaction(async tx=>{
 if(!(await tx.query("SELECT id FROM users WHERE id=$1 AND kind='account'",[userId])).rows.length)throw new GroupError('account_required',403);
 const id='grp_'+generateInternalId();
 try{await reserveHandle(tx,handle,'group',id);}catch(error){if((error as {code?:string}).code==='23505')throw new GroupError('handle_taken',409);throw error;}
 await tx.query('INSERT INTO groups(id,handle,name,description,created_by) VALUES($1,$2,$3,$4,$5)',[id,handle,name,description,userId]);
 await tx.query("INSERT INTO group_members(group_id,user_id,role) VALUES($1,$2,'editor')",[id,userId]);
 return {id,handle,name,description,role:'editor'};
 });
}
export async function listGroups(userId:string):Promise<GroupSummary[]>{return (await (await getDb()).query<GroupSummary>('SELECT g.id,g.handle,g.name,g.description,m.role FROM groups g JOIN group_members m ON m.group_id=g.id WHERE m.user_id=$1 AND g.deleted_at IS NULL ORDER BY g.name,g.id',[userId])).rows;}
export async function getGroupDetail(userId:string|null,idOrHandle:string):Promise<GroupDetail|null>{
 const db=await getDb();const group=(await db.query<GroupRecord>('SELECT * FROM groups WHERE (id=$1 OR handle=$2) AND deleted_at IS NULL',[idOrHandle,idOrHandle.replace(/^@/,'').toLowerCase()])).rows[0];
 if(!group)return null;const role=await getGroupRole(userId,group.id,db);if(!role)return null;
 const members=await searchGroupMembers(userId!,group.id,'');
 const linked_groups=(await db.query<GroupSummary>('SELECT g.id,g.handle,g.name,g.description,m.role FROM group_links l JOIN groups g ON g.id=l.linked_group_id LEFT JOIN group_members m ON m.group_id=g.id AND m.user_id=$2 WHERE l.group_id=$1 AND g.deleted_at IS NULL ORDER BY g.name',[group.id,userId])).rows;
 const invitations=role==='editor'?(await db.query<GroupInvitation>('SELECT id,email,role,created_at FROM group_invitations WHERE group_id=$1 ORDER BY created_at',[group.id])).rows:undefined;
 return {group:summary(group,role),members,linked_groups,...(invitations?{invitations}:{})};
}
export async function searchGroupMembers(userId:string,groupId:string,query:string):Promise<GroupMember[]>{const db=await getDb();if(!await getGroupRole(userId,groupId,db))throw new GroupError('not_found',404);return (await db.query<GroupMember>("SELECT m.user_id,u.username,u.name,m.role FROM group_members m JOIN users u ON u.id=m.user_id WHERE m.group_id=$1 AND ($2='' OR strpos(lower(coalesce(u.username,'')||' '||coalesce(u.name,'')),lower($2))>0) ORDER BY u.username,m.user_id LIMIT 100",[groupId,query])).rows;}
async function protectLastEditor(tx:Queryable,id:string,userId:string){if(await getGroupRole(userId,id,tx)==='editor'&&Number((await tx.query<{count:string}>('SELECT count(*) FROM group_members WHERE group_id=$1 AND role=\'editor\'',[id])).rows[0].count)<=1)throw new GroupError('last_editor',409);}
export async function setGroupMember(actorId:string,groupId:string,userId:string,role:GroupRole):Promise<void>{if(!roleValid(role))throw new GroupError('invalid_role');await (await getDb()).transaction(async tx=>{await requireEditor(tx,actorId,groupId);if(!(await tx.query("SELECT id FROM users WHERE id=$1 AND kind='account'",[userId])).rows.length)throw new GroupError('invalid_member');if(role!=='editor')await protectLastEditor(tx,groupId,userId);await tx.query('INSERT INTO group_members(group_id,user_id,role) VALUES($1,$2,$3) ON CONFLICT(group_id,user_id) DO UPDATE SET role=EXCLUDED.role',[groupId,userId,role]);});}
export async function removeGroupMember(actorId:string,groupId:string,userId:string):Promise<void>{await (await getDb()).transaction(async tx=>{await requireEditor(tx,actorId,groupId);await protectLastEditor(tx,groupId,userId);await tx.query('DELETE FROM group_members WHERE group_id=$1 AND user_id=$2',[groupId,userId]);});}
export async function inviteGroupMember(actorId:string,groupId:string,email:string,role:GroupRole):Promise<GroupInvitation>{if(typeof email!=='string'||!/^\S+@\S+\.\S+$/.test(email.trim())||email.length>320||!roleValid(role))throw new GroupError('invalid_invitation');return (await getDb()).transaction(async tx=>{await requireEditor(tx,actorId,groupId);return (await tx.query<GroupInvitation>('INSERT INTO group_invitations(id,group_id,email,role,invited_by) VALUES($1,$2,$3,$4,$5) ON CONFLICT(group_id,email) DO UPDATE SET role=EXCLUDED.role,invited_by=EXCLUDED.invited_by RETURNING id,email,role,created_at',['gin_'+generateInternalId(),groupId,email.trim().toLowerCase(),role,actorId])).rows[0];});}
export async function removeGroupInvitation(actorId:string,groupId:string,id:string):Promise<void>{await (await getDb()).transaction(async tx=>{await requireEditor(tx,actorId,groupId);await tx.query('DELETE FROM group_invitations WHERE group_id=$1 AND id=$2',[groupId,id]);});}
/** Only the admission workflow calls this after inbox verification. It may share its transaction. */
export async function acceptGroupInvitations(userId:string,verifiedEmail:string,query?:Queryable):Promise<string[]>{const accept=async(tx:Queryable)=>{
 const email=verifiedEmail.trim().toLowerCase();if(!(await tx.query("SELECT id FROM users WHERE id=$1 AND email=$2 AND kind='account'",[userId,email])).rows.length)throw new GroupError('verified_email_mismatch',403);
 const invitations=(await tx.query<{id:string;group_id:string;role:GroupRole}>('SELECT i.id,i.group_id,i.role FROM group_invitations i JOIN groups g ON g.id=i.group_id WHERE i.email=$1 AND g.deleted_at IS NULL ORDER BY i.group_id FOR UPDATE OF g,i',[email])).rows;
 for(const invitation of invitations){await tx.query("INSERT INTO group_members(group_id,user_id,role) VALUES($1,$2,$3) ON CONFLICT(group_id,user_id) DO UPDATE SET role=CASE WHEN group_members.role='editor' THEN 'editor' ELSE EXCLUDED.role END",[invitation.group_id,userId,invitation.role]);await tx.query('DELETE FROM group_invitations WHERE id=$1',[invitation.id]);}return invitations.map(i=>i.group_id);
 };return query?accept(query):(await getDb()).transaction(accept);}
export async function setGroupLink(actorId:string,groupId:string,linkedId:string,present:boolean):Promise<void>{await (await getDb()).transaction(async tx=>{await requireEditor(tx,actorId,groupId);if(present){if(groupId===linkedId||!await getGroupRole(actorId,linkedId,tx))throw new GroupError('invalid_link');await tx.query('INSERT INTO group_links(group_id,linked_group_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[groupId,linkedId]);}else await tx.query('DELETE FROM group_links WHERE group_id=$1 AND linked_group_id=$2',[groupId,linkedId]);});}
export async function getAccountPreferences(userId:string):Promise<AccountPreferences>{return {default_destination:(await (await getDb()).query<{default_destination:DefaultDestination}>('SELECT default_destination FROM account_preferences WHERE user_id=$1',[userId])).rows[0]?.default_destination??{type:'inherit'}};}
export async function setAccountPreferences(userId:string,destination:DefaultDestination):Promise<AccountPreferences>{if(!destination||!['personal','group','inherit'].includes(destination.type)||Object.keys(destination).some(k=>k!=='type'&&(destination.type!=='group'||k!=='id')))throw new GroupError('invalid_destination');await (await getDb()).transaction(async tx=>{if(destination.type==='group'&&(typeof destination.id!=='string'||!await getGroupRole(userId,destination.id,tx)))throw new GroupError('group_unavailable',403);await tx.query('INSERT INTO account_preferences(user_id,default_destination) VALUES($1,$2::jsonb) ON CONFLICT(user_id) DO UPDATE SET default_destination=EXCLUDED.default_destination',[userId,JSON.stringify(destination)]);});return {default_destination:destination};}
