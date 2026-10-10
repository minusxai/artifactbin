/** Artifact ownership is distinct from attribution and request credentials. */
import type {ArtifactDestination} from '@artifactbin/contracts';
import type {TokenActor} from '../accounts';
import {getAccountPreferences,getGroupRole} from '../groups';
import {selectNewArtifactDestination} from '../groups/destination';
import {DeploymentError,getDeploymentDefaultDestination} from '../deployment';
import {getDb,type Queryable} from '../platform/db';
import {DatasetError} from '../datasets/errors';
import type {ArtifactRow} from './access';

export function parseArtifactDestination(value:unknown):ArtifactDestination|undefined {
 if(value===undefined)return undefined;
 if(!value||typeof value!=='object'||Array.isArray(value))throw new DatasetError('Invalid destination',400);
 const d=value as Record<string,unknown>;
 if(d.type==='personal'&&Object.keys(d).every(k=>k==='type'))return {type:'personal'};
 if(d.type==='group'&&typeof d.id==='string'&&d.id&&Object.keys(d).every(k=>k==='type'||k==='id'))return {type:'group',id:d.id};
 throw new DatasetError('Invalid destination',400);
}
const destinationOf=(row:Pick<ArtifactRow,'user_id'> & Partial<Pick<ArtifactRow,'group_id'>>):ArtifactDestination=>row.group_id?{type:'group',id:row.group_id}:{type:'personal'};
export async function newArtifactDestination(actor:TokenActor,explicit?:ArtifactDestination,parentId?:string|null):Promise<ArtifactDestination>{
 const db=await getDb();
 const parent=parentId?(await db.query<ArtifactRow>('SELECT * FROM artifacts WHERE id=$1 AND deleted_at IS NULL',[parentId])).rows[0]:undefined;
 if(parentId&&!parent)throw new DatasetError('Invalid parent',400);
 if(parent&&!parent.group_id&&(parent.user_id?parent.user_id!==actor.userId:parent.token_id!==actor.tokenId))throw new DatasetError('Invalid parent',400);
 const preference=actor.userId?(await getAccountPreferences(actor.userId)).default_destination:undefined;
 let deployment_default:ArtifactDestination|undefined;
 if(!explicit&&!parent&&(!preference||preference.type==='inherit')){
  try{deployment_default=await getDeploymentDefaultDestination();}
  catch(error){if(error instanceof DeploymentError)throw new DatasetError(error.message,error.status);throw error;}
 }
 let destination:ArtifactDestination;
 try{destination=selectNewArtifactDestination({explicit,parent:parent?destinationOf(parent):undefined,preference,deployment_default});}
 catch{throw new DatasetError('Destination conflicts with parent owner',400);}
 if(destination.type==='group'&&await getGroupRole(actor.userId,destination.id)!=='editor')throw new DatasetError('Destination requires group editor membership',403);
 return destination;
}
export async function assertDestination(tx:Queryable,actor:TokenActor,destination:ArtifactDestination):Promise<void>{
 if(destination.type==='group'){
  // Lock membership and group rows until creation/transfer commits; removal waits.
  const found=await tx.query('SELECT id FROM groups WHERE id=$1 AND deleted_at IS NULL FOR UPDATE',[destination.id]);
  if(!found.rows.length||await getGroupRole(actor.userId,destination.id,tx)!=='editor')throw new DatasetError('Destination requires group editor membership',403);
 }
}

/** Recheck placement under the write lock, so transfer cannot strand a child. */
export async function assertOwnerPlacement(tx:Queryable,owner:{userId:string|null;tokenId:string;groupId?:string|null},ancestors:string[]):Promise<void>{
 const id=ancestors.at(-1);if(!id)return;
 const parent=(await tx.query<ArtifactRow>("SELECT * FROM artifacts WHERE id=$1 AND format='folder' AND deleted_at IS NULL FOR SHARE",[id])).rows[0];
 if(!parent||(owner.groupId?parent.group_id!==owner.groupId:parent.group_id||(owner.userId?parent.user_id!==owner.userId:parent.user_id||parent.token_id!==owner.tokenId))||JSON.stringify([...parent.ancestor_ids,parent.id])!==JSON.stringify(ancestors))throw new DatasetError('Parent owner or placement changed',409);
}
