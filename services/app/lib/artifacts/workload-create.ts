/** Trusted, group-owned static creation; no human identity or ambient API authority. */
import {createHash} from 'node:crypto';
import {ARTIFACT_WORKLOAD_LIMIT,type ArtifactWorkloadScope} from '@artifactbin/contracts';
import {getDb,retryOnConflict,PUBLIC_BASE_URL} from '@/lib/platform';
import {createArtifact,afterCreated,type ArtifactInput} from './store';
import {artifactState} from './state';
import {lookupCreation,CreationReplay,type CreationOperation} from './creation-ledger';
export class WorkloadCreationRefusal extends Error {constructor(message:string,readonly status=403){super(message);}}
export async function createWorkloadArtifact(scope:ArtifactWorkloadScope,input:ArtifactInput,digest:string):Promise<{status:number;body:Record<string,unknown>}>{
 const key=scope.creationKey;
 if(scope.role!=='editor'||!key||key.length>200||!scope.rootFolderId)throw new Error('Creation scope required');
 const operation:CreationOperation={scope:createHash('sha256').update(JSON.stringify(['workload-v1',scope.principal.issuerId,scope.principal.subjectId,scope.principal.grantId,scope.principal.groupId])).digest('hex'),key,fingerprint:digest,reply:row=>{
  const body={url:new URL('/a/'+row.id,PUBLIC_BASE_URL).href,state:artifactState(row),edit_id:row.edit_id,sharing_revision:row.sharing_revision??0,id:row.id,title:row.title,format:row.format,version:row.version,html:row.source,visibility:'private',parent_id:scope.rootFolderId};
  if(Buffer.byteLength(JSON.stringify(body))>ARTIFACT_WORKLOAD_LIMIT)throw new WorkloadCreationRefusal('Workload output too large',413);
  return {status:201,body};
 }};
 try{
  const db=await getDb();
  const result=await retryOnConflict(()=>db.transaction(async tx=>{
   if(!(await tx.query('SELECT 1 FROM groups WHERE id=$1 AND deleted_at IS NULL',[scope.principal.groupId])).rows.length)throw new WorkloadCreationRefusal('Invalid workload group');
   const folder=(await tx.query<{id:string;ancestor_ids:string[]}>("SELECT id,ancestor_ids FROM artifacts WHERE id=$1 AND group_id=$2 AND format='folder' AND deleted_at IS NULL FOR SHARE",[scope.rootFolderId,scope.principal.groupId])).rows[0];
   if(!folder)throw new WorkloadCreationRefusal('Invalid workload folder');
   // Every ancestor must still be a live folder of the exact owning group.
   const ancestors=[...folder.ancestor_ids,folder.id];
   const live=await tx.query('SELECT id FROM artifacts WHERE id=ANY($1::text[]) AND group_id=$2 AND format=\'folder\' AND deleted_at IS NULL ORDER BY id COLLATE "C" FOR SHARE',[ancestors,scope.principal.groupId]);
   if(live.rows.length!==ancestors.length)throw new WorkloadCreationRefusal('Invalid workload ancestry');
   const replay=await lookupCreation(tx,operation);if(replay)throw new CreationReplay(replay);
   const created=await createArtifact(null,null,{...input,title:input.title,format:'html',visibility:'private',destination:{type:'group',id:scope.principal.groupId},ancestor_ids:ancestors},{tx,operation,workloadGroup:scope.principal.groupId});
   // Unlike an interactive publication journal, this stable scheduled slot must remain recoverable indefinitely.
   await tx.query("UPDATE artifact_creation_operations SET response_until='infinity' WHERE scope=$1 AND operation_key=$2",[operation.scope,operation.key]);
   return created;
  }));
  await afterCreated(result,null);return operation.reply(result);
 }catch(error){if(error instanceof CreationReplay)return error.reply;throw error;}
}
