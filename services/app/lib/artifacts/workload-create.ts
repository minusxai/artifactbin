/** Trusted, group-owned static creation; no human identity or ambient API authority. */
import type {AccessActor} from '@/lib/accounts';
import {DatasetError} from '@/lib/datasets';
import {publicationNamespace,claimPublicationIntent,validatePublicationParent} from './workload-publication';
import {SERVICE_PAYLOAD_LIMIT,type ArtifactWorkloadScope} from '@artifactbin/contracts';
import {getDb,retryOnConflict,PUBLIC_BASE_URL} from '@/lib/platform';
import {createArtifact,afterCreated,type ArtifactInput} from './store';
import {artifactState} from './state';
import {lookupCreation,CreationReplay,type CreationOperation} from './creation-ledger';
export class WorkloadCreationRefusal extends Error {constructor(message:string,readonly status=403){super(message);}}
export async function createWorkloadArtifact(scope:ArtifactWorkloadScope,input:ArtifactInput,digest:string):Promise<{status:number;body:Record<string,unknown>}>{
 const key=scope.creationKey;
 if(scope.role!=='editor'||!key||key.length>200||!scope.rootFolderId||!scope.publication)throw new Error('Creation scope required');
 const actor:AccessActor={userId:null,tokenId:null,email:null,documentEditor:false,workload:{...scope,writeArtifactIds:[],publication:{...scope.publication!,slot:key}}};
 const operation:CreationOperation={scope:publicationNamespace(actor),key:'primary',fingerprint:digest,reply:row=>{
  const body={url:new URL('/a/'+row.id,PUBLIC_BASE_URL).href,state:artifactState(row),edit_id:row.edit_id,sharing_revision:row.sharing_revision??0,id:row.id,title:row.title,format:row.format,version:row.version,html:row.source,visibility:'private',parent_id:scope.rootFolderId};
  if(Buffer.byteLength(JSON.stringify(body))>SERVICE_PAYLOAD_LIMIT)throw new WorkloadCreationRefusal(`Workload output is past the ${SERVICE_PAYLOAD_LIMIT}-byte service payload limit`,413);
  return {status:201,body};
 }};
 try{
  const db=await getDb();
  const result=await retryOnConflict(()=>db.transaction(async tx=>{
   await validatePublicationParent(tx,actor,scope.rootFolderId);
   const folder=(await tx.query<{id:string;ancestor_ids:string[]}>("SELECT id,ancestor_ids FROM artifacts WHERE id=$1 AND group_id=$2 AND format='folder' AND deleted_at IS NULL",[scope.rootFolderId,scope.principal.groupId])).rows[0];
   if(!folder)throw new WorkloadCreationRefusal('Invalid workload folder');
   const ancestors=[...folder.ancestor_ids,folder.id];
   const replay=await lookupCreation(tx,operation);if(replay)throw new CreationReplay(replay);
   await claimPublicationIntent(tx,actor,'primary',{digest});
   const created=await createArtifact(null,null,{...input,title:input.title,format:'html',visibility:'private',destination:{type:'group',id:scope.principal.groupId},ancestor_ids:ancestors},{tx,operation,workloadActor:actor,resource:'primary'});
   // Unlike an interactive publication journal, this stable scheduled slot must remain recoverable indefinitely.
   await tx.query("UPDATE artifact_creation_operations SET response_until='infinity' WHERE scope=$1 AND operation_key=$2",[operation.scope,operation.key]);
   return created;
  }));
  await afterCreated(result,null);return operation.reply(result);
 }catch(error){if(error instanceof CreationReplay)return error.reply;if(error instanceof DatasetError)return {status:error.status,body:{error:'publication_refused'}};throw error;}
}
