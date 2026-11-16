/** Durable workload slots and cumulative storage charges. All facts here use the caller's transaction.
 * Host admission happens outside it; a committed effect is never retracted by later revocation.
 */
import type {Queryable} from '@artifactbin/contracts';
import {artifactQuotaLimit} from './quota-policy';
import {assetByteQuotaLimit} from './asset-quota';

import {createHash} from 'node:crypto';
import type {AccessActor} from '@/lib/accounts';
import {lockSubjects} from '@/lib/platform';
import {DatasetError} from '@/lib/datasets';
import type {ArtifactRow} from '@/lib/artifact-access';
export const publicationNamespace=(actor:AccessActor):string=>{
 const g=actor.workload;if(!g?.publication)throw new DatasetError('Publication authority required',403);
 const p=g.principal;return 'workload:'+createHash('sha256').update(JSON.stringify([p.issuerId,p.subjectId,p.groupId,p.grantId,g.publication.slot])).digest('hex');
};
export async function assertPublicationPlacement(tx:Queryable,actor:AccessActor,ancestors:readonly string[]):Promise<void>{
 const g=actor.workload;if(!g?.publication||g.role!=='editor')throw new DatasetError('Publication authority required',403);
 if(!(await tx.query('SELECT 1 FROM groups WHERE id=$1 AND deleted_at IS NULL',[g.principal.groupId])).rows.length)throw new DatasetError('Group unavailable',403);
 const root=g.rootFolderId;
 if(root&&!ancestors.includes(root))throw new DatasetError('Outside publication root',403);
 if(ancestors.length>=6)throw new DatasetError('Invalid depth',400);
 for(const [index,id] of ancestors.entries()){
  const row=(await tx.query<{ancestor_ids:string[]}>('SELECT ancestor_ids FROM artifacts WHERE id=$1 AND group_id=$2 AND format=\'folder\' AND deleted_at IS NULL FOR SHARE',[id,g.principal.groupId])).rows[0];
  if(!row||JSON.stringify(row.ancestor_ids)!==JSON.stringify(ancestors.slice(0,index)))throw new DatasetError('Publication placement changed',403);
 }
}
export async function chargePublication(tx:Queryable,actor:AccessActor,input:{source:string|null;meta:Record<string,unknown>;ancestor_ids?:string[];publicationBytes?:number},id:string,creating:boolean):Promise<void>{
 const g=actor.workload!;const ns=publicationNamespace(actor);
 const p=g.principal,grantNamespace=publicationFingerprint([p.issuerId,p.subjectId,p.groupId,p.grantId]);
 await lockSubjects(tx,'workload-publication',[g.principal.groupId,ns]);
 await assertPublicationPlacement(tx,actor,input.ancestor_ids??[]);
 const bytes=Buffer.byteLength(input.source??'')+Math.max(Number(input.meta.bytes??0),input.publicationBytes??0);
 const usage=async(where:string,value:string)=>(await tx.query<{n:number;b:string}>(`SELECT count(DISTINCT artifact_id)::int AS n,COALESCE(sum(bytes),0)::text AS b FROM workload_publication_audit WHERE ${where}=$1`,[value])).rows[0]!;
 const slot=await usage('grant_namespace',grantNamespace),group=await usage('group_id',g.principal.groupId);
 const count=creating?1:0,countLimit=artifactQuotaLimit(),byteLimit=assetByteQuotaLimit();
 if(slot.n+count>g.publication!.maxArtifacts||Number(slot.b)+bytes>g.publication!.maxBytes||(countLimit>0&&group.n+count>countLimit)||(byteLimit&&Number(group.b)+bytes>byteLimit))throw new DatasetError('Workload quota exceeded',403);
 await tx.query('INSERT INTO workload_publication_audit(namespace,group_id,artifact_id,bytes,binding,grant_namespace) VALUES($1,$2,$3,$4,$5::jsonb,$6)',[ns,g.principal.groupId,id,bytes,JSON.stringify(g.principal),grantNamespace]);
}
export async function recordPublicationOutput(tx:Queryable,actor:AccessActor,row:ArtifactRow):Promise<void>{
 await tx.query('INSERT INTO workload_publication_outputs(namespace,artifact_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[publicationNamespace(actor),row.id]);
}
const ordered=(value:unknown):unknown=>Array.isArray(value)?value.map(ordered):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,ordered((value as Record<string,unknown>)[key])])):value;
export const publicationFingerprint=(value:unknown):string=>createHash('sha256').update(JSON.stringify(ordered(value))).digest('hex');
/** Called only after request validation and online admission. The claim survives partial dependency commits. */
export async function claimPublicationIntent(tx:Queryable,actor:AccessActor,resource:string,body:unknown,key?:string|null):Promise<void>{
 const ns=publicationNamespace(actor),intent=actor.workload!.principal.intentHash,fingerprint=publicationFingerprint(body);
 await lockSubjects(tx,'workload-publication',[actor.workload!.principal.groupId,ns]);
 for(const name of [resource,...(key?['request:'+key]:[])]){
  await tx.query('INSERT INTO workload_publication_intents(namespace,resource,fingerprint,intent_hash) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[ns,name,fingerprint,intent]);
  const row=(await tx.query<{fingerprint:string;intent_hash:string}>('SELECT fingerprint,intent_hash FROM workload_publication_intents WHERE namespace=$1 AND resource=$2',[ns,name])).rows[0];
  if(row?.fingerprint!==fingerprint||row.intent_hash!==intent)throw new DatasetError('Publication intent conflict',409);
 }
}
/** Refresh only from the committed server graph, including dependencies just committed by this request. */
export async function publicationOutputs(tx:Queryable,actor:AccessActor):Promise<string[]>{
 return (await tx.query<{artifact_id:string}>('SELECT artifact_id FROM workload_publication_outputs WHERE namespace=$1',[publicationNamespace(actor)])).rows.map(row=>row.artifact_id);
}

/** Validate the selected parent before an intent can occupy the durable slot. */
export async function validatePublicationParent(tx:Queryable,actor:AccessActor,parentId:string|null):Promise<void>{
 const parent=parentId?(await tx.query<{ancestor_ids:string[]}>('SELECT ancestor_ids FROM artifacts WHERE id=$1 AND group_id=$2 AND format=\'folder\' AND deleted_at IS NULL FOR SHARE',[parentId,actor.workload!.principal.groupId])).rows[0]:null;
 if(parentId&&!parent)throw new DatasetError('Invalid publication parent',403);
 await assertPublicationPlacement(tx,actor,parent?[...parent.ancestor_ids,parentId!]:[]);
}
