import {authenticatingTestParent} from '../user-kinds';
/** Durable company bootstrap and admission. All state transitions hold the singleton row lock. */
import type {ArtifactDestination,DeploymentState,GroupSummary} from '@artifactbin/contracts';
import {getDb,type Queryable} from '../platform/db';
import {deploymentConfig,env} from '../platform/config';
import {admissionPolicyOf} from '@artifactbin/auth';
interface State {owner_user_id:string|null;default_group_id:string|null;setup_complete:boolean}
const ID='company';
export class DeploymentError extends Error {constructor(public code:string,public status:number,message:string){super(message);}}
export function validateDeploymentConfiguration():void {
 const config=deploymentConfig(),policy=admissionPolicyOf({},(_source,key)=>{const [module,name]=key.split('__');return env(module!,name!);});
 if(config.mode==='company'&&!policy.matches(config.ownerEmail!))throw new Error('APP__DEPLOYMENT_OWNER_EMAIL must match AUTH__ALLOWED_EMAIL_PATTERNS.');
}
async function state(db:Queryable,lock=false):Promise<State> {
 await db.query('INSERT INTO deployment_state(id) VALUES ($1) ON CONFLICT DO NOTHING',[ID]);
 return (await db.query<State>('SELECT owner_user_id,default_group_id,setup_complete FROM deployment_state WHERE id=$1'+(lock?' FOR UPDATE':''),[ID])).rows[0]!;
}
async function group(db:Queryable,id:string|null,userId:string|null,lock=false):Promise<GroupSummary|null> {
 if(!id)return null;
 return (await db.query<GroupSummary>('SELECT g.id,g.handle,g.name,g.description,m.role FROM groups g LEFT JOIN group_members m ON m.group_id=g.id AND m.user_id=$2 WHERE g.id=$1 AND g.deleted_at IS NULL'+(lock?' FOR UPDATE OF g':''),[id,userId])).rows[0]??null;
}
export async function getDeploymentState(userId:string|null):Promise<DeploymentState> {
 const {mode}=deploymentConfig();if(mode==='public')return {mode,setup_complete:true,is_owner:false,default_group:null};
 const db=await getDb(),s=await state(db),default_group=await group(db,s.default_group_id,userId);
 return {mode,setup_complete:s.setup_complete&&!!default_group,is_owner:!!userId&&s.owner_user_id===userId,default_group};
}
export async function getDeploymentDefaultDestination():Promise<ArtifactDestination|undefined> {
 const s=await getDeploymentState(null);
 if(s.mode==='public')return undefined;
 if(!s.setup_complete||!s.default_group)throw new DeploymentError('default_group_unavailable',409,'Default group unavailable; deployment owner must confirm an editor group.');
 return {type:'group',id:s.default_group.id};
}
export async function setupDeployment(userId:string,groupId:string):Promise<DeploymentState> {
 if(deploymentConfig().mode!=='company')throw new DeploymentError('company_required',400,'Company deployment required');
 const db=await getDb();await db.transaction(async tx=>{
  const s=await state(tx,true);if(s.owner_user_id!==userId)throw new DeploymentError('deployment_owner_required',403,'Deployment owner required');
  const g=await group(tx,groupId,userId,true);if(g?.role!=='editor')throw new DeploymentError('default_group_unavailable',403,'Default group requires editor membership');
  await tx.query('UPDATE deployment_state SET default_group_id=$2,setup_complete=true WHERE id=$1',[ID,groupId]);
 });return getDeploymentState(userId);
}
export async function admitDeploymentIdentity(identity:{userId:string;email?:string;emailVerified?:boolean}):Promise<boolean> {
 const config=deploymentConfig();if(config.mode==='public')return true;
 const policy=admissionPolicyOf({},(_source,key)=>{const [module,name]=key.split('__');return env(module!,name!);});
 const email=identity.email?.trim().toLowerCase(),db=await getDb();
 return db.transaction(async tx=>{
  const s=await state(tx,true);
  if(s.owner_user_id===identity.userId)return true;
  if((await tx.query('SELECT user_id FROM deployment_members WHERE user_id=$1',[identity.userId])).rows.length)return true;
  if(await canUseDelegatedDeploymentIdentity(identity.userId,tx))return true;
  if(!email||identity.emailVerified!==true)return false;
  if(!s.owner_user_id&&email===config.ownerEmail&&policy.matches(email)){
   await tx.query('UPDATE deployment_state SET owner_user_id=$2 WHERE id=$1',[ID,identity.userId]);
   await tx.query('INSERT INTO deployment_members(user_id) VALUES ($1) ON CONFLICT DO NOTHING',[identity.userId]);return true;
  }
  if(!s.setup_complete||!policy.matches(email)||!await group(tx,s.default_group_id,null,true))return false;
  const invitation=(await tx.query<{role:'editor'|'viewer'}>('SELECT role FROM group_invitations WHERE group_id=$1 AND lower(email)=$2 FOR UPDATE',[s.default_group_id,email])).rows[0];
  if(policy.inviteOnly&&!invitation)return false;
  await tx.query("INSERT INTO group_members(group_id,user_id,role) VALUES ($1,$2,$3) ON CONFLICT (group_id,user_id) DO UPDATE SET role=CASE WHEN group_members.role='editor' THEN 'editor' ELSE excluded.role END",[s.default_group_id,identity.userId,invitation?.role??'viewer']);
  if(invitation)await tx.query('DELETE FROM group_invitations WHERE group_id=$1 AND lower(email)=$2',[s.default_group_id,email]);
  await tx.query('INSERT INTO deployment_members(user_id) VALUES ($1) ON CONFLICT DO NOTHING',[identity.userId]);return true;
 });
}

/** Credential IDs already admitted remain valid when policy or defaults change. */
export async function canUseDeploymentIdentity(userId:string|null|undefined,query?:Queryable):Promise<boolean> {
 if(deploymentConfig().mode==='public')return true;
 if(!userId)return false;
 const db=query??await getDb();
 return (await db.query('SELECT user_id FROM deployment_members WHERE user_id=$1',[userId])).rows.length>0||await canUseDelegatedDeploymentIdentity(userId,db);
}

async function canUseDelegatedDeploymentIdentity(userId:string,db:Queryable):Promise<boolean> {
 const parent=await authenticatingTestParent(userId,db);
 if(!parent)return false;
 return (await db.query('SELECT m.user_id FROM deployment_members m JOIN deployment_state s ON s.id=$2 WHERE m.user_id=$1 AND s.setup_complete=true',[parent,ID])).rows.length>0;
}
