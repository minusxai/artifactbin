/** Artifact ownership is distinct from attribution and request credentials. */
import type {ArtifactDestination} from '@artifactbin/contracts/groups';
import type { AccessActor } from '@/lib/accounts';
import {actorGroupRole, getAccountPreferences, selectNewArtifactDestination} from '../groups';
import {DeploymentError,getDeploymentDefaultDestination} from '../deployment';
import { getDb, type Queryable } from '../platform';
import {DatasetError} from '../datasets';
import type { ArtifactRow } from '@/lib/artifact-access';

export function parseArtifactDestination(value:unknown):ArtifactDestination|undefined {
 if(value===undefined)return undefined;
 if(!value||typeof value!=='object'||Array.isArray(value))throw new DatasetError('Invalid destination',400);
 const d=value as Record<string,unknown>;
 if(d.type==='personal'&&Object.keys(d).every(k=>k==='type'))return {type:'personal'};
 if(d.type==='group'&&typeof d.id==='string'&&d.id&&Object.keys(d).every(k=>k==='type'||k==='id'))return {type:'group',id:d.id};
 throw new DatasetError('Invalid destination',400);
}
const destinationOf=(row:Pick<ArtifactRow,'user_id'> & Partial<Pick<ArtifactRow,'group_id'>>):ArtifactDestination=>row.group_id?{type:'group',id:row.group_id}:{type:'personal'};
/**
 * A GROUP'S SIGN-IN (lib/accounts `GroupPrincipal`) creates only in its own group: a personal destination would make a
 * row owned by a rotating token and no person, so it is refused with this, answered `group_principal_personal_refused`.
 */
export class GroupPersonalDestination extends DatasetError {
 constructor(){super('A sign-in acting as a group creates only in its group',403);}
}
/** Preserve the uniform placement refusal when resolving a parent's destination first. */
export class ArtifactParentRefusal extends DatasetError {
 constructor(){super('Invalid parent',400);}
}
// Member publication is a new page only. A private page needs an explicit group choice:
// a preference or parent alone cannot turn a private draft into a page the group can read.
export function permitsMemberPage(input:{format?:string;visibility?:string;explicitGroup:boolean;shares?:unknown;linkRole?:unknown;bundleDependency?:boolean}):boolean {
 return (input.format==='html' || (input.bundleDependency===true && input.explicitGroup && ['dataset','file','image','pdf'].includes(input.format??'')))
  && (input.explicitGroup || input.visibility==='public' || input.visibility==='unlisted')
  && input.shares===undefined && (input.linkRole===undefined || input.linkRole===null || input.linkRole==='viewer');
}
const canCreate=(role:'member'|'admin'|'editor'|null,memberPage:boolean)=>role==='admin'||role==='editor'||(role==='member'&&memberPage);
export async function newArtifactDestination(actor:AccessActor,explicit?:ArtifactDestination,parentId?:string|null,memberPage=false):Promise<ArtifactDestination>{
 const db=await getDb();
 if(actor.principalGroup){
  // Its group, unless told otherwise; never personal. At editor level only, as a direct Member may not publish.
  if(explicit?.type==='personal')throw new GroupPersonalDestination();
  const destination=explicit??{type:'group' as const,id:actor.principalGroup.id};
  const parent=parentId?(await db.query<ArtifactRow>('SELECT * FROM artifacts WHERE id=$1 AND deleted_at IS NULL',[parentId])).rows[0]:undefined;
  if(parentId&&(!parent||parent.format!=='folder'||parent.group_id!==destination.id))throw new ArtifactParentRefusal();
  if(!canCreate(await actorGroupRole(actor,destination.id,db),false))throw new DatasetError('Publication is unavailable for this group destination',403);
  return destination;
 }
 const parent=parentId?(await db.query<ArtifactRow>('SELECT * FROM artifacts WHERE id=$1 AND deleted_at IS NULL',[parentId])).rows[0]:undefined;
 if(parentId&&(!parent||parent.format!=='folder'))throw new ArtifactParentRefusal();
 if(parent&&(parent.group_id?!canCreate(await actorGroupRole(actor,parent.group_id),memberPage):(parent.user_id?parent.user_id!==actor.userId:parent.token_id!==actor.tokenId)))throw new ArtifactParentRefusal();
 const preference=actor.userId?(await getAccountPreferences(actor.userId)).default_destination:undefined;
 let deployment_default:ArtifactDestination|undefined;
 if(!explicit&&!parent&&(!preference||preference.type==='inherit')){
  try{deployment_default=await getDeploymentDefaultDestination();}
  catch(error){if(error instanceof DeploymentError)throw new DatasetError(error.message,error.status);throw error;}
 }
 let destination:ArtifactDestination;
 try{destination=selectNewArtifactDestination({explicit,parent:parent?destinationOf(parent):undefined,preference,deployment_default});}
 catch{throw new DatasetError('Destination conflicts with parent owner',400);}
 if(destination.type==='group'&&!canCreate(await actorGroupRole(actor,destination.id),memberPage))throw new DatasetError('Publication is unavailable for this group destination',403);
 return destination;
}
export async function assertDestination(tx:Queryable,actor:AccessActor,destination:ArtifactDestination,memberPage=false):Promise<boolean>{
 if(actor.principalGroup&&destination.type!=='group')throw new GroupPersonalDestination();
 if(destination.type==='group'){
  // Read at decision time, unlocked: a membership revoked after this commit refuses the next request
  // (a deleted group's pages grant nobody anything).
  const role=await actorGroupRole(actor,destination.id,tx);
  if(!canCreate(role,!actor.principalGroup&&memberPage))throw new DatasetError('Publication is unavailable for this group destination',403);
  return role==='member';
 }
 return false;
}

/** Recheck placement under the write lock, so transfer cannot strand a child. */
export async function assertOwnerPlacement(tx:Queryable,owner:AccessActor,ancestors:string[]):Promise<void>{
 const id=ancestors.at(-1);if(!id)return;
 const parent=(await tx.query<ArtifactRow>("SELECT * FROM artifacts WHERE id=$1 AND format='folder' AND deleted_at IS NULL FOR SHARE",[id])).rows[0];
 if(!parent||(owner.groupId?parent.group_id!==owner.groupId:parent.group_id||(owner.userId?parent.user_id!==owner.userId:parent.user_id||parent.token_id!==owner.tokenId))||JSON.stringify([...parent.ancestor_ids,parent.id])!==JSON.stringify(ancestors))throw new DatasetError('Parent owner or placement changed',409);
}
