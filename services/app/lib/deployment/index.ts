import {canUseDeploymentIdentity} from '../accounts';
import {recordGroupChanges} from '../groups';
/** Durable company bootstrap and admission. All state transitions hold the singleton row lock. */
import type {ArtifactDestination,DeploymentState,GroupSummary} from '@artifactbin/contracts';
import { getDb, type Queryable, dataServices, deploymentConfig, embedTrustedOrigins, env, pageSchedulesEnabled, serviceAudiences, services } from '../platform';
import {admissionPolicyOf} from '@artifactbin/auth';
interface State {owner_user_id:string|null;default_group_id:string|null;setup_complete:boolean}
const ID='company';
export class DeploymentError extends Error {constructor(public code:string,public status:number,message:string){super(message);}}
/** Run at boot (server.ts): a refused setting stops the start with its name. */
export function validateDeploymentConfiguration():void {
 serviceAudiences();dataServices();pageSchedulesEnabled();embedTrustedOrigins();
 const config=deploymentConfig(),policy=admissionPolicyOf({},(_source,key)=>{const [module,name]=key.split('__');return env(module!,name!);});
 if(config.mode==='company'&&!policy.matches(config.ownerEmail!))throw new Error('APP__DEPLOYMENT_OWNER_EMAIL must match AUTH__ALLOWED_EMAIL_PATTERNS.');
}
async function state(db:Queryable,lock=false):Promise<State> {
 await db.query('INSERT INTO deployment_state(id) VALUES ($1) ON CONFLICT DO NOTHING',[ID]);
 return (await db.query<State>('SELECT owner_user_id,default_group_id,setup_complete FROM deployment_state WHERE id=$1'+(lock?' FOR UPDATE':''),[ID])).rows[0]!;
}
/** The live group and the reader's direct role in it, read at decision time (identity rows are never locked here). */
async function group(db:Queryable,id:string|null,userId:string|null):Promise<GroupSummary|null> {
 if(!id)return null;
 return (await db.query<GroupSummary>('SELECT g.id,g.handle,g.name,g.description,m.role FROM groups g LEFT JOIN group_members m ON m.group_id=g.id AND m.user_id=$2 WHERE g.id=$1 AND g.deleted_at IS NULL',[id,userId])).rows[0]??null;
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
  const g=await group(tx,groupId,userId);if(g?.role!=='editor')throw new DeploymentError('default_group_unavailable',403,'Default group requires editor membership');
  await tx.query('UPDATE deployment_state SET default_group_id=$2,setup_complete=true WHERE id=$1',[ID,groupId]);
 });return getDeploymentState(userId);
}
/**
 * The verdict a plain read already settles, or undefined when only the writing path can decide. Every
 * authenticated request in a non-public deployment asks, and nearly all are people already admitted (or
 * plainly refused), so they must not queue on the one `deployment_state` lock. Only first-owner binding and
 * admitting a new member write, and those still take it. A refusal read without the lock can lose a race
 * with a concurrent admission by at most one request; an admission is never taken back.
 */
async function settledAdmission(db:Queryable,identity:{userId:string;emailVerified?:boolean},email:string|undefined,config:ReturnType<typeof deploymentConfig>,matches:(email:string)=>boolean):Promise<boolean|undefined> {
 const s=(await db.query<State>('SELECT owner_user_id,default_group_id,setup_complete FROM deployment_state WHERE id=$1',[ID])).rows[0];
 if(!s)return undefined;
 if(s.owner_user_id===identity.userId)return true;
 if(await canUseDeploymentIdentity(identity.userId,db))return true;
 if(!email||identity.emailVerified!==true)return false;
 if(!s.owner_user_id&&email===config.ownerEmail&&matches(email))return undefined;
 if(!s.setup_complete||!matches(email))return false;
 return undefined;
}
export async function admitDeploymentIdentity(identity:{userId:string;email?:string;emailVerified?:boolean}):Promise<boolean> {
 const config=deploymentConfig();if(config.mode==='public')return true;
 const policy=admissionPolicyOf({},(_source,key)=>{const [module,name]=key.split('__');return env(module!,name!);});
 const email=identity.email?.trim().toLowerCase(),db=await getDb();
 const settled=await settledAdmission(db,identity,email,config,e=>policy.matches(e));
 if(settled!==undefined)return settled;
 const decided=await db.transaction(async tx=>{
  const s=await state(tx,true);
  if(s.owner_user_id===identity.userId)return true;
  if(await canUseDeploymentIdentity(identity.userId,tx))return true;
  if(!email||identity.emailVerified!==true)return false;
  if(!s.owner_user_id&&email===config.ownerEmail&&policy.matches(email)){
   await tx.query('UPDATE deployment_state SET owner_user_id=$2 WHERE id=$1',[ID,identity.userId]);
   await tx.query('INSERT INTO deployment_members(user_id) VALUES ($1) ON CONFLICT DO NOTHING',[identity.userId]);return true;
  }
  if(!s.setup_complete||!policy.matches(email)||!s.default_group_id||!await group(tx,s.default_group_id,null))return false;
  return {groupId:s.default_group_id};
 });
 if(typeof decided==='boolean')return decided;
 // Joining the default group is the identity module's write, after this transaction (never inside it); the admission
 // row follows once it succeeded. An admission is never taken back, so a crash between the two only re-asks.
 const admitted=await services().identity.admitToGroup({userId:identity.userId,email:email!,groupId:decided.groupId,inviteOnly:policy.inviteOnly});
 if(!admitted.admitted)return false;
 await recordGroupChanges(admitted.changes);
 await db.query('INSERT INTO deployment_members(user_id) VALUES ($1) ON CONFLICT DO NOTHING',[identity.userId]);
 return true;
}
