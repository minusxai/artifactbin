/** Real normal publication dependency staging. Never publishes the main page or opens a network connection. */
import {createHash} from 'node:crypto';
import {fileContentType} from '@artifactbin/contracts';
import {getOwnedArtifactFor} from '@/lib/artifacts';
import {objectStore} from '@/lib/object-store';
import {planPublicationBundle} from '@/lib/html-publication-bundle';
import type {PublicationBundle} from '@/lib/html-publication-bundle';
import {createArtifactFromBody,preparePublicationBundle} from '@/lib/publish/publish';
import type {NativeRuntimeAssembly,NativeRuntimeBundleDependency,NativeRuntimePreparationOptions,NativeRuntimePreparation} from './contracts';
import {importNativeRuntimePdfs,rewriteNativeRuntimePdfLinks,type NativeRuntimePdfImport} from './pdf-source';
import {verifyNativeRuntimeObjects} from './verify-objects';
export type {NativeRuntimeAssembly,NativeRuntimePreparationOptions,NativeRuntimePreparation} from './contracts';
const sha=(value:string|Uint8Array)=>createHash('sha256').update(value).digest('hex');
const validSha=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const invalid=()=>Error('native_runtime_invalid');
type PublicationBundleMapping=NonNullable<PublicationBundle['mappings']>[string];
export async function prepareNativeRuntimeBundle(assembly:NativeRuntimeAssembly,options:NativeRuntimePreparationOptions):Promise<NativeRuntimePreparation>{
 const {result,key}=assembly;
 if(result.status!=='complete'||typeof result.html!=='string'||!validSha(result.htmlSha256)||sha(result.html)!==result.htmlSha256||!Array.isArray(result.files)||!validSha(assembly.sha256)||!key.sourceNamespace||!key.sourceId||!Number.isSafeInteger(key.version)||key.version<1||!/^[A-Za-z0-9]{6,128}$/.test(options.pageId)||!options.actor.userId||!options.actor.tokenId)throw invalid();
 const fileDigests=result.files.map(file=>{if(!(file.bytes instanceof Uint8Array)||!validSha(file.sha256)||sha(file.bytes)!==file.sha256)throw invalid();return {path:file.path,sha256:file.sha256};});
 const pdfPaths=new Set(result.files.filter(file=>fileContentType(file.path)==='application/pdf').map(file=>file.path));
 const previewMappings:Record<string,PublicationBundleMapping>=Object.fromEntries(result.files.filter(file=>pdfPaths.has(file.path)).map(file=>[file.path,{kind:'asset',id:'NativePdfPreview',revision:'1',sha256:file.sha256}]));
 const files=result.files.filter(file=>!pdfPaths.has(file.path)).map(file=>({path:file.path,contentType:fileContentType(file.path)??'application/octet-stream',base64:Buffer.from(file.bytes).toString('base64')}));
 const preflightBundle={entryPath:'index.html',files,...(Object.keys(previewMappings).length?{mappings:previewMappings}:{})};
 // Validate all local paths and non-PDF closure before writing any PDF artifact.
 const preflight=planPublicationBundle(result.html,preflightBundle);
 if(preflight.backends.length||preflight.dependencies.some(dependency=>dependency.kind!=='asset'))throw Error('native_runtime_dataset_or_backend_requires_projection');
 const origin=new URL(options.origin).origin,pdfImports:NativeRuntimePdfImport[]=await importNativeRuntimePdfs(assembly,result.files,options,origin);
 const mappings:Record<string,PublicationBundleMapping>=Object.fromEntries(pdfImports.map(item=>[item.path,{kind:'asset',id:item.id,revision:item.revision,sha256:item.sha256}]));
 const bundle={entryPath:'index.html',files,...(Object.keys(mappings).length?{mappings}:{})};
 const plan=planPublicationBundle(result.html,bundle);
 if(plan.backends.length||plan.dependencies.some(dependency=>dependency.kind!=='asset'))throw Error('native_runtime_dataset_or_backend_requires_projection');
 const pdfBinding=pdfImports.map(({path,id,revision,sha256,sourceAssets})=>({path,id,revision,sha256,sourceAssets}));
 const requestIdentity={kind:'native-runtime-v1',key,assemblySha256:assembly.sha256,pageId:options.pageId,sourceHtmlSha256:result.htmlSha256,fileDigests,owner:{userId:options.actor.userId,tokenId:options.actor.tokenId},visibility:options.visibility,shares:options.shares??[]};
 // Preserve the old idempotency key exactly for existing non-PDF runtime imports.
 const requestKey=pdfImports.length?sha(JSON.stringify({...requestIdentity,pdfImports:pdfBinding})):sha(JSON.stringify(requestIdentity));
 const prepared=await preparePublicationBundle({html:result.html,publicationBundle:bundle,reserved_id:options.pageId,visibility:options.visibility,...(options.shares?{shares:options.shares}: {})},options.actor,origin,new Request(origin+'/api/artifacts',{method:'POST',headers:{'Idempotency-Key':requestKey}}),(body,request)=>createArtifactFromBody(body,options.actor,origin,request),async()=>{throw Error('native_runtime_updates_not_admitted');},{id:options.pageId,resolvedBackendNames:[],dependencies:[],creator:options.actor});
 if(prepared instanceof Response)throw Object.assign(Error('native_runtime_dependency_publication_failed'),{status:prepared.status,details:await prepared.json()});
 if(typeof prepared.body.html!=='string')throw invalid();
 const publishedHtml=rewriteNativeRuntimePdfLinks(prepared.body.html,options.pageId,pdfImports);
 const dependencies=(prepared.receipts as NativeRuntimeBundleDependency[]).map(dependency=>{const pdf=pdfImports.find(item=>item.path===dependency.path);return pdf?{...dependency,sourceAssets:pdf.sourceAssets}:dependency;});
 const addresses=new Map(dependencies.map(dependency=>[dependency.path,`/a/${options.pageId}/assets?dependency=${dependency.id}&revision=${dependency.revision}`]));
 const verification=plan.dependencies.map(dependency=>{
  const receipt=dependencies.find(item=>item.path===dependency.path);
  if(!receipt||receipt.kind!=='asset')throw invalid();
  const expected=/^(?:text\/css|(?:text|application)\/javascript)$/.test(dependency.contentType)?Buffer.from(plan.rewrite(Buffer.from(dependency.bytes).toString('utf8'),dependency.path,addresses)):Buffer.from(dependency.bytes);
  return {path:dependency.path,id:receipt.id,revision:receipt.revision,expected,contentType:dependency.contentType};
 });
 const objects=[...await verifyNativeRuntimeObjects(verification,{readOwned:id=>getOwnedArtifactFor(options.actor,id),readObject:key=>objectStore().get(key)})];
 for(const imported of pdfImports){const receipt=dependencies.find(dependency=>dependency.path===imported.path);if(!receipt||receipt.id!==imported.id||receipt.revision!==imported.revision||receipt.kind!=='asset'||receipt.sha256!==imported.sha256)throw Error('native_runtime_pdf_receipt_binding');objects.push({path:imported.path,id:imported.id,revision:imported.revision,objectKey:imported.objectKey,sha256:imported.sha256,bytes:imported.bytes,contentType:'application/pdf'});}
 const receipt={pageId:options.pageId,key:{...key},assemblySha256:assembly.sha256,sourceHtmlSha256:result.htmlSha256,html:publishedHtml,htmlSha256:sha(publishedHtml),fileDigests,dependencies,objects};
 return {...receipt,assetsSha256:sha(JSON.stringify(receipt))};
}
