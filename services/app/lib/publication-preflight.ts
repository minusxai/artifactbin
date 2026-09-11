/** Authoritative read-only publication planning, including unpublished dependency bytes. */
import {updateMetadataFromBody} from './metadata-wire';
import {ARTIFACT_ID_PATTERN} from '@artifactbin/contracts';
import {createArtifactFromBody,replaceArtifactWithBody,respondToEdit} from './artifact-wire';
import {applyEditFor,getArtifactFor,getOwnedArtifactFor,findDependentsFor,refLoaderForActor,writerFor,byteQuotaFor,type TokenActor} from './artifacts';
import {prepareContentInput} from './story/prepare-content';
import type {ResolvedRef} from './story/refs';
import {catalogOf,prepareCatalog} from './datasets/catalog';
import {executeCatalog} from './datasets/execute';
import type {DatasetColumn} from './story/dataset-shape';
import {objectStore} from './object-store';
import {json,baseUrl} from './http';
export async function preflightPublication(request:Request,actor:TokenActor,body:Record<string,unknown>):Promise<Response>{
 const input=body.input;
 if(!input||typeof input!=='object'||Array.isArray(input))return json({error:'invalid_preflight',hint:'Send {input:{...publication fields},id?:artifact id,dependencies?:[{id,input}]}.'},400);
 if(body.id!==undefined&&(typeof body.id!=='string'||!ARTIFACT_ID_PATTERN.test(body.id)))return json({error:'invalid_reference'},400);
 const current=typeof body.id==='string'?await getArtifactFor(actor,body.id):null;
 if(body.id&&!current)return json({error:'not_found'},404);
 if(body.mode==='delete'){
  if(!current||!await getOwnedArtifactFor(actor,current.id))return json({error:'not_found'},404);
  const force=(input as Record<string,unknown>).force;
  if(force!==undefined&&typeof force!=='boolean')return json({error:'invalid_force'},400);
  const dependents=await findDependentsFor(actor,current.id);
  if(dependents.length&&!force)return json({error:'has_dependents',dependents:dependents.map(row=>({id:row.id,title:row.title}))},409);
  return json({valid:true,would_delete:current.id,includes_subtree:current.format==='folder',dependents:dependents.map(row=>({id:row.id,title:row.title})),commit_checks:['ownership','dependents']});
 }
 const owner=current?writerFor(current):actor;
 const base=refLoaderForActor(owner);
 const proposed=new Map<string,ResolvedRef>();
 const dependencies=body.dependencies??[];
 if(!Array.isArray(dependencies)||dependencies.length>100)return json({error:'invalid_dependencies'},400);
 for(const item of dependencies){
  if(!item||typeof item.id!=='string'||!ARTIFACT_ID_PATTERN.test(item.id)||proposed.has(item.id)||!item.input||typeof item.input!=='object'||Array.isArray(item.input))return json({error:'invalid_dependencies'},400);
  const prepared=await prepareContentInput(item.input,{creating:true,prepareDataset:(value,objects)=>prepareCatalog(value,actor,undefined,objects),overByteQuota:byteQuotaFor(actor.tokenId)});
  if(prepared instanceof Response)return prepared;
  if(!['dataset','image','pdf','file'].includes(prepared.content.format))return json({error:'unsupported_dependency'},400);
  const catalog=catalogOf(prepared.content);
  if(catalog?.kind==='postgres')return json({error:'unsupported_dependency',hint:'Composed local dependencies must contain local bytes or stored rows.'},400);
  const objects=new Map(prepared.objects.map(object=>[object.key,object.bytes]));
  proposed.set(item.id,{id:item.id,format:prepared.content.format,owned:true,
   ...(catalog?{catalog,columns:prepared.content.meta.columns as DatasetColumn[],access:item.input.access==='readwrite'?'readwrite':'read',
     query:(sql,params,paramTypes)=>executeCatalog(catalog,sql,params,{limit:1,paramTypes,objects:{get:async key=>objects.get(key)??objectStore().get(key)}})}:{})});
 }
 const loadRef=async(id:string)=>proposed.get(id)??base(id);
 if(body.mode==='metadata'){
  if(!current)return json({error:'invalid_preflight'},400);
  return updateMetadataFromBody(actor,current.id,input as Record<string,unknown>,baseUrl(request),true);
 }
 if(body.mode==='edit'){
  if(!current||'meta' in input)return json({error:'invalid_preflight',hint:'Body edits require id and source/edit_id; use conditional metadata for metadata changes.'},400);
  return respondToEdit(baseUrl(request),input as Record<string,unknown>,edit=>applyEditFor(actor,current.id,edit,{dryRun:true,loadRef}));
 }
 if(body.mode!==undefined&&body.mode!=='replace')return json({error:'invalid_preflight_mode'},400);
 return current?replaceArtifactWithBody(input as Record<string,unknown>,actor,current.id,baseUrl(request),{dryRun:true,loadRef})
  :createArtifactFromBody(input as Record<string,unknown>,actor,baseUrl(request),undefined,{dryRun:true,loadRef});
}
