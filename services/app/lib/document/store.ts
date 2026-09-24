/** Atomic document persistence. A CAS retry uses a fresh SQL snapshot and the original client base. */
import type {DocumentEdit, DocumentEditResult, DocumentSnapshot, RichDocument} from '@artifactbin/contracts';
import {getDb} from '../db';
import {createArtifact, editorScope, type TokenActor} from '../artifacts';
import {assertDocument, assertPrimitive, DocumentError, validNodeId} from './model';
import {compileDocumentOperations} from './sql';
import {validateDocumentMarkup} from './mdx';

export async function createDocument(actor:TokenActor,title:string,document:RichDocument):Promise<DocumentSnapshot>{
 assertDocument(document);validateDocumentMarkup(document);
 if(typeof title!=='string'||title.length>300)throw new DocumentError('Invalid title');
 const row=await createArtifact(actor.tokenId,actor.userId,{title,format:'markup',content:'',source:null,meta:{documentSchema:1}},{document});
 return {id:row.id,version:row.version,document};
}


function assertEdit(edit:DocumentEdit):void {
 if(!edit || !Number.isSafeInteger(edit.baseVersion) || edit.baseVersion<1 || typeof edit.operationId!=='string' || !/^[A-Za-z0-9_-]{1,128}$/.test(edit.operationId))throw new DocumentError('Invalid edit identity');
 for(const ids of [edit.changedIds,edit.ancestorIds])if(!Array.isArray(ids)||ids.length>20000||!ids.every(id=>typeof id==='string'&&validNodeId(id))||new Set(ids).size!==ids.length)throw new DocumentError('Invalid affected IDs');
 if(!edit.changedIds.length||!Array.isArray(edit.operations))throw new DocumentError('Empty edit');
 const affected=new Set(edit.changedIds);
 for(const op of edit.operations){assertPrimitive(op);const ids='nodeId'in op?[op.nodeId]:op.kind==='addNodes'?Object.keys(op.nodes):op.ids;if(!ids.every(id=>affected.has(id)))throw new DocumentError('Operation target missing from changed IDs');}
}
export async function editDocument(actor:TokenActor,id:string,edit:DocumentEdit):Promise<DocumentEditResult>{
 const scope=editorScope(actor);
 let compiled:ReturnType<typeof compileDocumentOperations>;
 try{
  assertEdit(edit);
  compiled=compileDocumentOperations(edit.operations,[id,scope.val,edit.baseVersion,edit.operationId,edit.changedIds,edit.ancestorIds,actor.userId,actor.tokenId||null]);
 }catch(error){if(error instanceof DocumentError)return {updated:false,reason:'invalid',detail:error.message};throw error;}
 const identities=new Map<string,boolean>();
 for(const op of edit.operations){if(op.kind==='addNodes')for(const nodeId of Object.keys(op.nodes))identities.set(nodeId,true);if(op.kind==='removeNodes')for(const nodeId of op.ids)identities.set(nodeId,false);}
 const added=`$${compiled.params.push([...identities].filter(([,live])=>live).map(([nodeId])=>nodeId))}::text[]`;
 const removed=`$${compiled.params.push([...identities].filter(([,live])=>!live).map(([nodeId])=>nodeId))}::text[]`;
 const sql=`WITH observed AS MATERIALIZED (
   SELECT * FROM artifacts WHERE id=$1 AND ${scope.where('$2')} AND document IS NOT NULL
 ), receipt AS MATERIALIZED (
   SELECT v.version+1 AS version, CASE WHEN o.version=v.version+1 THEN o.document ELSE (SELECT later.document FROM artifact_versions later WHERE later.artifact_id=o.id AND later.version=v.version+1) END AS document FROM artifact_versions v JOIN observed o ON o.id=v.artifact_id WHERE v.operation_id=$4
 ), intervening AS MATERIALIZED (
   SELECT v.* FROM artifact_versions v JOIN observed o ON o.id=v.artifact_id WHERE v.version >= $3 AND v.version < o.version
 ), eligible AS MATERIALIZED (
   SELECT * FROM observed o WHERE $3 <= o.version
   AND (SELECT count(*) FROM intervening WHERE operation_id IS NOT NULL AND changed_ids IS NOT NULL AND ancestor_ids IS NOT NULL)=o.version-$3
   AND NOT EXISTS (SELECT 1 FROM intervening WHERE changed_ids && $5::text[] OR ancestor_ids && $5::text[] OR changed_ids && $6::text[])
   AND NOT EXISTS (SELECT 1 FROM receipt)
 ), input AS (SELECT document FROM eligible), ${compiled.ctes},
 updated AS (
   UPDATE artifacts SET document=result.document, version=artifacts.version+1,
     actor_user_id=$7, actor_token_id=$8, updated_at=now(), edit_id=$4
   FROM eligible o, ${compiled.result} result
   WHERE artifacts.id=o.id AND artifacts.version=o.version AND artifacts.sharing_revision=o.sharing_revision
   RETURNING artifacts.version,artifacts.document
 ), archived AS (
   INSERT INTO artifact_versions(artifact_id,version,title,description,format,content,source,document,meta,actor_user_id,actor_token_id,operation_id,changed_ids,ancestor_ids)
   SELECT o.id,o.version,o.title,o.description,o.format,o.content,o.source,o.document,o.meta,o.actor_user_id,o.actor_token_id,$4,$5::text[],$6::text[]
   FROM observed o CROSS JOIN updated RETURNING version
 ), reserved_ids AS (
   INSERT INTO artifact_source_ids(artifact_id,source_id,provenance,first_version)
   SELECT $1,node_id,'authored',u.version FROM updated u CROSS JOIN unnest(${added}) AS node_id
   ON CONFLICT(artifact_id,source_id) DO UPDATE SET retired_version=NULL
 ), retired_ids AS (
   UPDATE artifact_source_ids SET retired_version=u.version FROM updated u
   WHERE artifact_id=$1 AND source_id=ANY(${removed})
 ), notified AS (
   SELECT pg_notify('artifact_' || lower($1),$4) FROM archived
 )
 SELECT CASE WHEN EXISTS(SELECT 1 FROM updated) THEN 'updated'
   WHEN EXISTS(SELECT 1 FROM receipt) THEN 'duplicate'
   WHEN NOT EXISTS(SELECT 1 FROM observed) THEN 'not_found'
   WHEN NOT EXISTS(SELECT 1 FROM eligible) THEN 'conflict'
   WHEN NOT EXISTS(SELECT 1 FROM ${compiled.result}) THEN 'invalid'
   ELSE 'retry' END AS status,
   COALESCE((SELECT version FROM updated),(SELECT version FROM receipt),(SELECT version FROM observed)) AS version,
   COALESCE((SELECT document FROM updated),(SELECT document FROM receipt)) AS document,
   (SELECT count(*) FROM notified) AS notifications`;
 const db=await getDb();
 for(let attempt=0;attempt<5;attempt++){
  const row=(await db.query<{status:'updated'|'duplicate'|'not_found'|'conflict'|'invalid'|'retry';version:number|null;document:RichDocument|null}>(sql,compiled.params)).rows[0]!;
  if(row.status==='retry')continue;
  if(row.status==='updated')return {updated:true,version:row.version!,document:row.document!};
  return {updated:false,reason:row.status,...(row.version===null?{}:{version:row.version}),...(row.document?{document:row.document}:{})};
 }
 return {updated:false,reason:'conflict',detail:'The document is busy. Your draft has been preserved; retry the edit.'};
}
