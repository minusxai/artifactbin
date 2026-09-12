/**
 * Authoritative read-only publication planning.
 *
 * A document's local dependencies arrive as HASHES, not bytes: `{id, sha256,
 * size, filename}` per image, PDF or file. The filename decides the tier the
 * document is validated against, the hash decides whether the actor already
 * owns those bytes, and the reply says which — so the CLI uploads only the
 * misses. Datasets are the one exception and always were: a <Query> runs
 * against ROWS, so a dataset dependency still travels with them.
 */
import {updateMetadataFromBody} from './metadata-wire';
import {ARTIFACT_ID_PATTERN,MAX_PREFLIGHT_DEPENDENCIES,SHA256_HEX,type PreflightAssetFormat,type PreflightDependencyResult} from '@artifactbin/contracts';
import {createArtifactFromBody,replaceArtifactWithBody,respondToEdit} from './artifact-wire';
import {applyEditFor,getArtifactFor,getOwnedArtifactFor,findDependentsFor,findOwnedAssetsFor,refLoaderForActor,writerFor,byteQuotaFor,type DeclaredAsset,type TokenActor} from './artifacts';
import {prepareContentInput} from './story/prepare-content';
import {assetFormatOf} from './story/file-types';
import type {ResolvedRef} from './story/refs';
import {catalogOf,prepareCatalog} from './datasets/catalog';
import {executeCatalog} from './datasets/execute';
import type {DatasetColumn} from './story/dataset-shape';
import {objectStore} from './object-store';
import {MAX_FILE_BYTES,MAX_IMAGE_BYTES,MAX_PDF_BYTES} from './config';
import {json,baseUrl} from './http';

/** The cap each asset tier enforces at its own upload door, so preflight refuses what publish would. */
const MAX_ASSET_BYTES:Record<PreflightAssetFormat,number>={image:MAX_IMAGE_BYTES,pdf:MAX_PDF_BYTES,file:MAX_FILE_BYTES};

const DEPENDENCY_HINT='Describe a local image, PDF or file as {id,sha256,size,filename}, and local rows as {id,input:{dataset}}.';
const invalidDependencies=():Response=>json({error:'invalid_dependencies',hint:DEPENDENCY_HINT},400);

/** A hash-form dependency, checked field by field — null the moment any of them is not what it claims. */
function declaredAsset(item:{sha256?:unknown;size?:unknown;filename?:unknown}):DeclaredAsset|null{
 const format=typeof item.filename==='string'?assetFormatOf(item.filename):null;
 if(!format)return null;
 if(typeof item.sha256!=='string'||!SHA256_HEX.test(item.sha256))return null;
 if(typeof item.size!=='number'||!Number.isSafeInteger(item.size)||item.size<0||item.size>MAX_ASSET_BYTES[format])return null;
 return {format,sha256:item.sha256};
}

export async function preflightPublication(request:Request,actor:TokenActor,body:Record<string,unknown>):Promise<Response>{
 const input=body.input;
 if(!input||typeof input!=='object'||Array.isArray(input))return json({error:'invalid_preflight',hint:`Send {input:{...publication fields},id?:artifact id,dependencies?:[...]}. ${DEPENDENCY_HINT}`},400);
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
 if(!Array.isArray(dependencies)||dependencies.length>MAX_PREFLIGHT_DEPENDENCIES)return invalidDependencies();
 /*
  * PASS ONE — SHAPE, and nothing else. Every entry is checked before a single
  * row is read or a single dataset is parsed, so a malformed list costs one
  * refusal rather than the work every entry ahead of it would otherwise have
  * done. Keeping the passes apart is what makes "refused before any lookup"
  * structurally true rather than incidentally true.
  */
 const declared:Array<{id:string;asset:DeclaredAsset}|{id:string;dataset:Record<string,unknown>}>=[];
 const ids=new Set<string>();
 for(const value of dependencies){
  const item=value as {id?:unknown;sha256?:unknown;size?:unknown;filename?:unknown;input?:unknown}|null;
  if(!item||typeof item!=='object'||Array.isArray(item)||typeof item.id!=='string'||!ARTIFACT_ID_PATTERN.test(item.id)||ids.has(item.id))return invalidDependencies();
  ids.add(item.id);
  if('sha256' in item){
   const asset=declaredAsset(item);
   if(!asset)return invalidDependencies();
   declared.push({id:item.id,asset});
   continue;
  }
  if(!item.input||typeof item.input!=='object'||Array.isArray(item.input))return invalidDependencies();
  declared.push({id:item.id,dataset:item.input as Record<string,unknown>});
 }
 /*
  * PASS TWO — the refs the document is validated against. A hash-form asset
  * resolves to a ref with NO BYTES and no object-store write: the filename gave
  * the tier, and the tier is everything reference validation asks of an image,
  * a PDF or a file. Only a dataset is parsed, in memory, because only a dataset
  * is QUERIED here.
  */
 const results:PreflightDependencyResult[]=[];
 const assets:DeclaredAsset[]=[];
 for(const entry of declared){
  if('asset' in entry){
   proposed.set(entry.id,{id:entry.id,format:entry.asset.format,owned:true});
   assets.push(entry.asset);
   results.push({id:entry.id,format:entry.asset.format,existing:null});
   continue;
  }
  const prepared=await prepareContentInput(entry.dataset,{creating:true,prepareDataset:(value,objects)=>prepareCatalog(value,actor,undefined,objects),overByteQuota:byteQuotaFor(actor.tokenId)});
  if(prepared instanceof Response)return prepared;
  const catalog=prepared.content.format==='dataset'?catalogOf(prepared.content):null;
  if(!catalog)return json({error:'unsupported_dependency',hint:DEPENDENCY_HINT},400);
  if(catalog.kind==='postgres')return json({error:'unsupported_dependency',hint:'Composed local dependencies must contain local bytes or stored rows.'},400);
  const objects=new Map(prepared.objects.map(object=>[object.key,object.bytes]));
  proposed.set(entry.id,{id:entry.id,format:prepared.content.format,owned:true,catalog,columns:prepared.content.meta.columns as DatasetColumn[],
   access:entry.dataset.access==='readwrite'?'readwrite':'read',
   query:(sql,params,paramTypes)=>executeCatalog(catalog,sql,params,{limit:1,paramTypes,objects:{get:async key=>objects.get(key)??objectStore().get(key)}})});
  // A dataset's rows are in the request by construction, so there is nothing to
  // dedupe and nothing to report: `existing` is null for every one of them.
  results.push({id:entry.id,format:'dataset',existing:null});
 }
 /*
  * PASS THREE — ONE owner-scoped lookup for the whole list. Two placeholders
  * may name the same bytes (one logo used twice), and both then answer with the
  * one artifact, because the lookup is by hash and not by placeholder.
  */
 const owned=await findOwnedAssetsFor(actor,assets);
 let next=0;
 for(const line of results)if(line.format!=='dataset')line.existing=owned[next++]??null;
 /** Every successful reply carries one line per declared dependency, in the order they were sent. */
 const withDependencies=async(response:Response):Promise<Response>=>{
  if(!response.ok)return response;
  const replied=await response.json() as Record<string,unknown>;
  return new Response(JSON.stringify({...replied,dependencies:results}),{status:response.status,headers:response.headers});
 };
 const loadRef=async(id:string)=>proposed.get(id)??base(id);
 if(body.mode==='metadata'){
  if(!current)return json({error:'invalid_preflight'},400);
  return withDependencies(await updateMetadataFromBody(actor,current.id,input as Record<string,unknown>,baseUrl(request),true));
 }
 if(body.mode==='edit'){
  if(!current||'meta' in input)return json({error:'invalid_preflight',hint:'Body edits require id and source/edit_id; use conditional metadata for metadata changes.'},400);
  return withDependencies(await respondToEdit(baseUrl(request),input as Record<string,unknown>,edit=>applyEditFor(actor,current.id,edit,{dryRun:true,loadRef})));
 }
 if(body.mode!==undefined&&body.mode!=='replace')return json({error:'invalid_preflight_mode'},400);
 return withDependencies(await (current?replaceArtifactWithBody(input as Record<string,unknown>,actor,current.id,baseUrl(request),{dryRun:true,loadRef})
  :createArtifactFromBody(input as Record<string,unknown>,actor,baseUrl(request),undefined,{dryRun:true,loadRef})));
}
