/** HTTP source authoring is an opt-in adapter over the shared browser/CLI
 * compiler. It observes an authorized head but never commits or certifies it:
 * /edits independently checks ownership and graph dependencies at commit. */
import {MAX_DOCUMENT_BYTES,type DocumentUpdate} from '@artifactbin/contracts';
import {editorScope,type ArtifactRow,type TokenActor} from '../access';
import {loadArtifactDocument} from '../document';
import {getDb} from '../../platform/db';
import {json} from '../../http/http';
import {prepareClientDocumentPublication} from '../../document/document-update-client';
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
