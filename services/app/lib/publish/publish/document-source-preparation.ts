/** HTTP source authoring is an opt-in adapter over the shared browser/CLI
 * compiler. It observes an authorized head but never commits or certifies it:
 * /edits independently checks ownership and graph dependencies at commit. */
import {MAX_DOCUMENT_BYTES,type DocumentUpdate} from '@artifactbin/contracts';
import { type ArtifactRow, editorScope, loadArtifactDocument, type PreparedMarkupWrite, writerFor } from '@/lib/artifacts';
import type { TokenActor } from '@/lib/accounts';
import {createDocumentGraph, stampNodeIds, prepareClientDocumentPublication} from '@/lib/document';
import {getDb} from '@/lib/platform/db';
import {json} from '@/lib/http/http';
import {prepareDocumentAuthoringContext} from './document-authoring-context';

export async function prepareDocumentSource(actor:TokenActor,id:string,body:Record<string,unknown>):Promise<Response>{
 if(typeof body.source!=='string'||Buffer.byteLength(body.source)>MAX_DOCUMENT_BYTES)return json({error:'invalid_authoring_context'},400);
 if(typeof body.edit_id!=='string'||!Number.isSafeInteger(body.expectedVersion)||Number(body.expectedVersion)<1)return json({error:'observed_snapshot_required'},400);
 const metadata=body.metadata;
 if(metadata!==undefined&&(!metadata||typeof metadata!=='object'||Array.isArray(metadata)||!Object.entries(metadata).every(([key,value])=>['title','description','theme','template','colorMode'].includes(key)&&(value===null||typeof value==='string'))))return json({error:'invalid_metadata'},400);
 const db=await getDb(),scope=editorScope(actor);
 const head=await loadArtifactDocument<ArtifactRow>(db,`SELECT * FROM artifacts WHERE id=$1 AND format='markup' AND deleted_at IS NULL AND ${scope.where('$2')}`,[id,scope.val]);
 if(!head)return json({error:'not_found'},404);
 if(head.edit_id!==body.edit_id||head.version!==body.expectedVersion)return json({error:'doc_changed',edit_id:head.edit_id,version:head.version,source:head.source},409);
 if(head.document?.kind!=='graph')return json({error:'invalid_document_snapshot'},400);
 try{
  const document_update=await prepareClientDocumentPublication({...head,document:head.document},{source:body.source,metadata:metadata as DocumentUpdate['metadata']},async source=>{
   const response=await prepareDocumentAuthoringContext(actor,id,{source});
   if(!response.ok)throw response;
   return response.json();
  });
  return json({valid:true,edit_id:head.edit_id,document_update});
 }catch(error){
  if(error instanceof Response)return error;
  return json({error:'invalid_markup',detail:error instanceof Error?error.message:'Invalid document source'},400);
 }
}

/** Administrative authoring uses the same client compiler and commit contract. */
export async function publishMarkupForArtifact(current:ArtifactRow,source:string,metaOverride:Record<string,unknown>=current.meta):Promise<Response|PreparedMarkupWrite>{
 const db=await getDb();
 const reserved=await db.query<{source_id:string}>('SELECT source_id FROM artifact_source_ids WHERE artifact_id=$1',[current.id]);
 const identity=stampNodeIds(source,{previousSource:current.source,reservedIds:reserved.rows.map(row=>row.source_id)});
 try{
  const document=current.document?.kind==='graph'?current.document:createDocumentGraph(current.source??'',current.version);
  const metadata={theme:(metaOverride.theme??null) as string|null,template:(metaOverride.template??null) as string|null,colorMode:(metaOverride.colorMode??null) as 'light'|'dark'|null};
  const update=await prepareClientDocumentPublication({...current,document},{source:identity.source,metadata,whole:true},async context=>{
   const response=await prepareDocumentAuthoringContext(writerFor(current),current.id,{source:context});
   if(!response.ok)throw response;
   return response.json();
  });
  return {source:identity.source,meta:metaOverride,ids:identity.ids,update};
 }catch(error){return error instanceof Response?error:json({error:'invalid_jsx',details:[`${error}`]},400);}
}
