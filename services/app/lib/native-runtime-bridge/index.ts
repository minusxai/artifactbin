/** Real normal publication dependency staging. Never publishes the main page or opens a network connection. */
import {createHash} from 'node:crypto';
import {fileContentType} from '@artifactbin/contracts';
import {getOwnedArtifactFor} from '@/lib/artifacts';
import {objectStore} from '@/lib/object-store';
import {planPublicationBundle} from '@/lib/html-publication-bundle';
import {createArtifactFromBody,preparePublicationBundle} from '@/lib/publish/publish';
import type {NativeRuntimeAssembly,NativeRuntimePreparationOptions,NativeRuntimePreparation} from './contracts';
export type {NativeRuntimeAssembly,NativeRuntimePreparationOptions,NativeRuntimePreparation} from './contracts';
const sha=(value:string|Uint8Array)=>createHash('sha256').update(value).digest('hex');
const validSha=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const invalid=()=>Error('native_runtime_invalid');
export async function prepareNativeRuntimeBundle(assembly:NativeRuntimeAssembly,options:NativeRuntimePreparationOptions):Promise<NativeRuntimePreparation>{
 const {result,key}=assembly;
 if(result.status!=='complete'||typeof result.html!=='string'||!validSha(result.htmlSha256)||sha(result.html)!==result.htmlSha256||!Array.isArray(result.files)||!validSha(assembly.sha256)||!key.sourceNamespace||!key.sourceId||!Number.isSafeInteger(key.version)||key.version<1||!/^[A-Za-z0-9]{6,128}$/.test(options.pageId)||!options.actor.userId||!options.actor.tokenId)throw invalid();
 const fileDigests=result.files.map(file=>{
  if(!(file.bytes instanceof Uint8Array)||!validSha(file.sha256)||sha(file.bytes)!==file.sha256)throw invalid();
  return {path:file.path,sha256:file.sha256};
 });
 const bundle={entryPath:'index.html',files:result.files.map(file=>({path:file.path,contentType:fileContentType(file.path)??'application/octet-stream',base64:Buffer.from(file.bytes).toString('base64')}))};
 // The actual parser validates paths, closure, module grammar, cycles and supported limits BEFORE any write.
 const plan=planPublicationBundle(result.html,bundle);
 if(plan.backends.length||plan.dependencies.some(dependency=>dependency.kind!=='asset'))throw Error('native_runtime_dataset_or_backend_requires_projection');
 const requestKey=sha(JSON.stringify({kind:'native-runtime-v1',key,assemblySha256:assembly.sha256,pageId:options.pageId,sourceHtmlSha256:result.htmlSha256,fileDigests,owner:{userId:options.actor.userId,tokenId:options.actor.tokenId},visibility:options.visibility,shares:options.shares??[]}));
 const origin=new URL(options.origin).origin;
 const prepared=await preparePublicationBundle({html:result.html,publicationBundle:bundle,reserved_id:options.pageId,visibility:options.visibility,...(options.shares?{shares:options.shares}: {})},options.actor,origin,new Request(origin+'/api/artifacts',{method:'POST',headers:{'Idempotency-Key':requestKey}}),(body,request)=>createArtifactFromBody(body,options.actor,origin,request),async()=>{throw Error('native_runtime_updates_not_admitted');},options.pageId);
 if(prepared instanceof Response)throw Object.assign(Error('native_runtime_dependency_publication_failed'),{status:prepared.status,details:await prepared.json()});
 if(typeof prepared.body.html!=='string')throw invalid();
 const dependencies=prepared.receipts as NativeRuntimePreparation['dependencies'];
 const addresses=new Map(dependencies.map(dependency=>[dependency.path,`/a/${options.pageId}/assets?dependency=${dependency.id}&revision=${dependency.revision}`]));
 const objects:NativeRuntimePreparation['objects'][number][]=[];
 for(const dependency of plan.dependencies){
  const receipt=dependencies.find(item=>item.path===dependency.path);
  if(!receipt||receipt.kind!=='asset')throw invalid();
  const row=await getOwnedArtifactFor(options.actor,receipt.id);
  if(!row||row.format!=='file'||String(row.version)!==receipt.revision)throw invalid();
  const meta=row.meta as {objectKey?:unknown;sha256?:unknown;bytes?:unknown;contentType?:unknown};
  const expected=/^(?:text\/css|(?:text|application)\/javascript)$/.test(dependency.contentType)?Buffer.from(plan.rewrite(Buffer.from(dependency.bytes).toString('utf8'),dependency.path,addresses)):Buffer.from(dependency.bytes);
  if(typeof meta.objectKey!=='string'||meta.sha256!==sha(expected)||meta.bytes!==expected.byteLength||meta.contentType!==dependency.contentType)throw invalid();
  const actual=await objectStore().get(meta.objectKey);
  if(!actual.equals(expected))throw invalid();
  objects.push({path:dependency.path,id:receipt.id,revision:receipt.revision,objectKey:meta.objectKey,sha256:sha(actual),bytes:actual.byteLength,contentType:dependency.contentType});
 }
 const receipt={pageId:options.pageId,key:{...key},assemblySha256:assembly.sha256,sourceHtmlSha256:result.htmlSha256,html:prepared.body.html,htmlSha256:sha(prepared.body.html),fileDigests,dependencies,objects};
 return {...receipt,assetsSha256:sha(JSON.stringify(receipt))};
}
