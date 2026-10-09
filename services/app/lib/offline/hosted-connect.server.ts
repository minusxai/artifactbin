/** Hosted handoff: authenticated baseline proof, existing atomic graph edits, then recoverable existing annotation operations. The offered HTML never executes. */
import {createHash} from 'node:crypto';
import {browserActor,actorForArtifacts,ownerUsername} from '../accounts';
import {applyEditFor,createArtifactFromBody,durableMutation,getEditableArtifactFor,getVersionFor,respondToEdit,capabilityGuard,type TokenActor} from '../artifacts';
import {UnservableDocument} from '../artifacts/servable';
import {actOnAnnotationFor,createAnnotationFor,listAnnotationsFor,type AnnotationWire} from '../annotations';
import {baseUrl,json} from '../http';
import {prepareDocumentAuthoringContext} from '../story/document/document-authoring-context';
import {readFileOffer} from './offer';
import {prepareHostedFileUpdate,prepareHostedFilePublication} from './hosted-connect';
import {validateFileComments} from './comment-validation';
import {nodeIndex} from '../story/document/node-ids';
import {verifyHostedComments,offlineCommentBody} from './hosted-comments';
import type {ArtifactFile} from './file-format';

const identity=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function actorOf(request:Request):Promise<TokenActor|Response>{
 const actor=await browserActor(request);if(actor instanceof Response)return actor;
 const scoped=actorForArtifacts(actor);return scoped?.userId?scoped:json({error:'authentication_required',hint:'Log in with email to apply this file.'},401);
}
/** The file's server base, or null when it is unavailable here — a retired stored shape (lib/artifacts/servable) included. */
async function baseline(actor:TokenActor,file:ArtifactFile){
 try{return await servedBaseline(actor,file);}catch(error){if(error instanceof UnservableDocument)return null;throw error;}
}
async function servedBaseline(actor:TokenActor,file:ArtifactFile){
 if(!(/^[A-Za-z0-9]{6,12}$/).test(file.artifactId))return null;
 const head=await getEditableArtifactFor(actor,file.artifactId);if(!head||head.format!=='markup'||head.document?.kind!=='graph')return null;
 if(head.version===file.base.version)return {document:head.document,version:head.version,markup:head.source??'',meta:head.meta,title:head.title,description:head.description};
 const old=await getVersionFor(actor,file.artifactId,file.base.version);
 if(!old||old.format!=='markup'||old.document?.kind!=='graph')return null;
 return {document:old.document,version:old.version,markup:old.source??'',meta:old.meta,title:old.title,description:old.description};
}
export async function inspectHostedOffer(request:Request,value:unknown):Promise<Response>{
 const {file}=readFileOffer(value);validateFileComments(file);const actor=await actorOf(request);
 if(actor instanceof Response){if(actor.status===401)return json({title:file.metadata.title,comments:file.threads.length,target:'',kind:'copy',requiresAuth:true});return actor;}
 const base=await baseline(actor,file);
 let reason='The original is unavailable here or you do not have edit access. An independent copy is an explicit choice.';
 if(base){
  try{prepareHostedFileUpdate(file,base);verifyHostedComments(file,await listAnnotationsFor(actor,file.artifactId,{status:'all'})??[]);return json({title:file.metadata.title,comments:file.threads.length,target:file.artifactId,kind:'update'});}
  catch(error){reason=error instanceof Error?error.message:String(error);}
 }
 return json({title:file.metadata.title,comments:file.threads.length,target:'',kind:'copy',reason});
}
async function publishComments(actor:TokenActor,request:Request,id:string,file:ArtifactFile,copy:boolean):Promise<void>{
 const refusal=await capabilityGuard(actor,'comment',id);if(refusal&&file.threads.length)throw Error('Your account cannot publish comments on this document.');
 const author={kind:'human' as const,label:await ownerUsername(actor.userId),transport:'browser' as const};
 const current=await listAnnotationsFor(actor,id,{status:'all'});if(!current)throw Error('The document is no longer accessible.');
 if(!copy)verifyHostedComments(file,current);
 const local=new Set(file.localIds);
 for(const thread of file.threads){
  let remote=copy||local.has(thread.id)?undefined:current.find(entry=>entry.id===thread.id);
  for(const comment of thread.thread){
   if(!copy&&!local.has(comment.id))continue;
   const key=identity(['offline-comment',id,thread.id,comment.id]);
   const body=offlineCommentBody(comment);
   // Author/permission checks precede receipt replay; supplied labels never grant attribution.
   const guard=await capabilityGuard(actor,'comment',id);if(guard)throw Error('Comment access changed. Your file has been retained.');
   const result=await durableMutation(actor,request.url,key,{id,thread:thread.id,comment:comment.id,body},async receipt=>{
    const made=remote?await actOnAnnotationFor(actor,id,remote.id,{reply:body},author,receipt):await createAnnotationFor(actor,id,{nodeId:thread.anchor?.nodeId??thread.anchor?.key,body,...(thread.quote?{quote:thread.quote}:{}),...(thread.range?{range:thread.range}:{}),...(thread.view_state?{viewState:thread.view_state}:{})},author,receipt);
    if(made instanceof Response)return {status:made.status,body:await made.json()};
    if(!made||'refused' in made)return {status:409,body:{error:made&&'refused' in made?made.refused:'comment_unavailable'}};
    return {status:200,body:made as unknown as Record<string,unknown>};
   });
   if(result.status>=400)throw Error(`Comment publication failed: ${String(result.body.error)}. Retry this same file to retrieve its receipt.`);
   remote=result.body as unknown as AnnotationWire;
  }
  if(remote&&(copy||local.has(thread.id))&&thread.status==='resolved'){
   const result=await durableMutation(actor,request.url,identity(['offline-comment-state',id,thread.id,'resolved']),{id,thread:thread.id,status:'resolved'},async receipt=>{
    const made=await actOnAnnotationFor(actor,id,remote!.id,{resolve:true},author,receipt);
    return made?{status:200,body:made as unknown as Record<string,unknown>}:{status:409,body:{error:'comment_unavailable'}};
   });
   if(result.status>=400)throw Error('The offline comment state could not be applied. Retry this same file.');
  }
 }
}
export async function applyHostedOffer(request:Request,value:unknown):Promise<Response>{
 const {file}=readFileOffer(value);validateFileComments(file);const input=value as {mode?:unknown;operationId?:unknown},actor=await actorOf(request);if(actor instanceof Response)return actor;
 if(input.mode!=='update'&&input.mode!=='copy')return json({error:'Choose explicitly between applying to the original and creating an independent copy.'},400);
 const copy=input.mode==='copy';
 if(copy&&file.threads.some(thread=>thread.image))return json({error:'This discussion contains attached screenshots. Keep the original file; hosted independent copies cannot transfer those attachments automatically.'},409);
 const base=copy?null:await baseline(actor,file);
 if(!copy&&!base)return json({error:'The original baseline is unavailable or edit access changed. Nothing was applied.'},409);
 if(!copy)verifyHostedComments(file,await listAnnotationsFor(actor,file.artifactId,{status:'all'})??[]);
 if(file.threads.length){
  if(!copy){const refused=await capabilityGuard(actor,'comment',file.artifactId);if(refused)return refused;}
  const nodes=nodeIndex(file.source),local=new Set(file.localIds);
  if(file.threads.some(thread=>(copy||local.has(thread.id))&&!nodes.has(thread.anchor?.nodeId??thread.anchor?.key??'')))return json({error:'An offline comment target is missing from the proposed document. Restore or re-anchor it before applying; nothing was saved.'},409);
 }
 if(copy&&(typeof input.operationId!=='string'||!/^[a-f0-9-]{36}$/.test(input.operationId)))return json({error:'invalid_operation_identity'},400);
 const key=identity(copy?['offline-copy',input.operationId]:['offline-update',file.artifactId,file.base,file.source,file.metadata]);
 const result=await durableMutation(actor,request.url,key,{copy,artifact:file.artifactId,base:file.base,source:file.source,metadata:file.metadata},async()=>{
  let response:Response;
  if(copy)response=await createArtifactFromBody({markup:file.source,...file.metadata,visibility:'unlisted'},actor,baseUrl(request),request);
  else{
   const update=await prepareHostedFilePublication(file,base!,async source=>{
    const context=await prepareDocumentAuthoringContext(actor,file.artifactId,{source});
    if(!context.ok)throw Error(`Referenced authoring context is unavailable on this server: ${JSON.stringify(await context.json())}`);
    return context.json();
   });
   const sourceChanged=update.patch.removed.length||Object.keys(update.patch.updated).length||Object.keys(update.patch.inserted).length||Object.keys(update.metadata??{}).length;
   response=sourceChanged?await respondToEdit(baseUrl(request),{edit_id:file.base.editId,document_update:update},edit=>applyEditFor(actor,file.artifactId,edit)):json({id:file.artifactId,version:base!.version});
  }
  return {status:response.status,body:await response.json()};
 });
 if(result.status===409&&result.body.error==='doc_changed')return json({...result.body,code:'doc_changed',error:'Your offline changes overlap with newer server edits.',hint:'Your changes were not applied. Keep this file and reconcile the edited blocks, or create an independent copy.'},409);
 if(result.status>=400)return json(result.body,result.status);
 const id=copy?String(result.body.id):file.artifactId;
 if(!/^[A-Za-z0-9]{6,12}$/.test(id))return json({error:'The server did not confirm a document identity. Preserve this file and inspect your account.'},502);
 try{await publishComments(actor,request,id,file,copy);}catch(error){return json({error:error instanceof Error?error.message:String(error),sourceApplied:true,artifactId:id,hint:'The document was saved; some comments may still be pending. Keep this file and retry the same action. Confirmed comments will not be duplicated.'},409);}
 // Released HTML accepts only /workspace/* opened paths. This is a real hosted redirect, scoped again on arrival.
 return json({path:`/workspace/${id}`,artifactId:id,sourceApplied:true});
}
