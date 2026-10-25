/** Real normal publication dependency staging. Never publishes the main page or opens a network connection. */
import {createHash} from 'node:crypto';
import {fileContentType} from '@artifactbin/contracts';
import {getOwnedArtifactFor} from '@/lib/artifacts';
import {objectStore} from '@/lib/object-store';
import {planPublicationBundle} from '@/lib/html-publication-bundle';
import type {PublicationBundleMapping} from '@/lib/html-publication-bundle/contracts';
import {MAX_PDF_BYTES} from '@/lib/platform/config';
import {pdfPageCount} from '@/lib/object-store/pdf-store';
import {sniffAssetType} from '@/lib/web-ingest/sniff';
import {createArtifactFromBody,preparePublicationBundle} from '@/lib/publish/publish';
import type {NativeRuntimeAssembly,NativeRuntimeBundleDependency,NativeRuntimePreparationOptions,NativeRuntimePreparation,NativeRuntimeSourceAssetProvenance,NativeRuntimeSourceFileReceipt} from './contracts';
export type {NativeRuntimeAssembly,NativeRuntimePreparationOptions,NativeRuntimePreparation} from './contracts';
const sha=(value:string|Uint8Array)=>createHash('sha256').update(value).digest('hex');
const validSha=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const canonical=(value:unknown):unknown=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([key,item])=>[key,canonical(item)])):value;
const digest=(value:unknown)=>sha(JSON.stringify(canonical(value)));
const invalid=()=>Error('native_runtime_invalid');
interface PdfSource {sourceId:string;sourceVersion:number;sourceRowSha256:string;sourceReceiptSha256:string;name:string;bytes:number;pages?:number}
interface PdfImport {path:string;id:string;revision:string;objectKey:string;sha256:string;bytes:number;sourceAssets:readonly NativeRuntimeSourceAssetProvenance[]}
function sourcePdfAssets(assembly:NativeRuntimeAssembly,files:readonly {path:string;bytes:Uint8Array;sha256:string}[]):{file:{path:string;bytes:Uint8Array;sha256:string};sources:readonly PdfSource[]}[]{
 const pdfFiles=files.filter(file=>fileContentType(file.path)==='application/pdf'),receipts=assembly.input?.fileReceipts??[];
 return pdfFiles.map(file=>{
  if(file.bytes.byteLength>MAX_PDF_BYTES||sniffAssetType(Buffer.from(file.bytes))!=='application/pdf')throw Error('native_runtime_pdf_invalid');
  const matching=receipts.filter(receipt=>receipt.kind==='pdf'&&receipt.target==='./'+file.path);
  if(!matching.length)throw Error('native_runtime_pdf_receipt_missing');
  const sources:PdfSource[]=matching.map(receipt=>{
   const {sha256:receiptSha,...body}=receipt as NativeRuntimeSourceFileReceipt;
   if(!/^[_A-Za-z0-9-]{6,128}$/.test(receipt.sourceId)||receipt.source!=='ref:'+receipt.sourceId||!Number.isSafeInteger(receipt.version)||receipt.version<1||!validSha(receipt.sourceRowSha256)||!validSha(receiptSha)||digest(body)!==receiptSha||receipt.bytes!==file.bytes.byteLength||typeof receipt.name!=='string'||!receipt.name||receipt.pages!==undefined&&(!Number.isSafeInteger(receipt.pages)||receipt.pages<1))throw Error('native_runtime_pdf_receipt_invalid');
   const pages=pdfPageCount(Buffer.from(file.bytes));if(receipt.pages!==undefined&&receipt.pages!==pages)throw Error('native_runtime_pdf_pages');
   return {sourceId:receipt.sourceId,sourceVersion:receipt.version,sourceRowSha256:receipt.sourceRowSha256,sourceReceiptSha256:receiptSha,name:receipt.name,bytes:receipt.bytes,...(receipt.pages===undefined?{}:{pages:receipt.pages})};
  });
  if(new Set(sources.map(source=>`${source.sourceId}@${source.sourceVersion}`)).size!==sources.length||new Set(sources.map(source=>JSON.stringify([source.name,source.bytes,source.pages]))).size!==1)throw Error('native_runtime_pdf_receipt_conflict');
  return {file,sources};
 });
}
async function importPdfSourceAsset(input:{assembly:NativeRuntimeAssembly;file:{path:string;bytes:Uint8Array;sha256:string};sources:readonly PdfSource[];options:NativeRuntimePreparationOptions;origin:string}):Promise<PdfImport>{
 const {assembly,file,sources,options,origin}=input,requestKey=digest({kind:'native-runtime-pdf-v1',key:assembly.key,assemblySha256:assembly.sha256,pageId:options.pageId,path:file.path,fileSha256:file.sha256,sources,owner:{userId:options.actor.userId,tokenId:options.actor.tokenId},visibility:options.visibility,shares:options.shares??[]});
 const pdf=`data:application/pdf;base64,${Buffer.from(file.bytes).toString('base64')}`;
 const response=await createArtifactFromBody({pdf,title:sources[0]!.name,visibility:options.visibility,...(options.shares?{shares:options.shares}:{})},options.actor,origin,new Request(origin+'/api/artifacts',{method:'POST',headers:{'Idempotency-Key':requestKey}}));
 const saved=await response.json().catch(()=>({})) as {id?:unknown;version?:unknown};
 if(!response.ok||typeof saved.id!=='string'||!/^[_A-Za-z0-9-]{6,128}$/.test(saved.id)||!/^\d+$/.test(String(saved.version)))throw Object.assign(Error('native_runtime_pdf_publication_failed'),{status:response.status});
 const revision=String(saved.version),row=await getOwnedArtifactFor(options.actor,saved.id) as (Awaited<ReturnType<typeof getOwnedArtifactFor>>&{format?:string;user_id?:string|null;token_id?:string|null;visibility?:string;title?:string;meta?:Record<string,unknown>})|null;
 if(!row||row.format!=='pdf'||String((row as {version?:unknown}).version)!==revision||row.user_id!==options.actor.userId||row.token_id!==options.actor.tokenId||row.visibility!==options.visibility||row.title!==sources[0]!.name)throw Error('native_runtime_pdf_owner');
 const meta=row.meta??{};
 if(meta.contentType!=='application/pdf'||meta.bytes!==file.bytes.byteLength||meta.sha256!==file.sha256||sources[0]!.pages!==undefined&&meta.pages!==sources[0]!.pages||typeof meta.objectKey!=='string')throw Error('native_runtime_pdf_metadata');
 const actual=await objectStore().get(meta.objectKey);if(!actual.equals(Buffer.from(file.bytes))||sha(actual)!==file.sha256)throw Error('native_runtime_pdf_bytes');
 const sourceAssets=sources.map(source=>({...source}));return {path:file.path,id:row.id,revision,objectKey:meta.objectKey,sha256:file.sha256,bytes:file.bytes.byteLength,sourceAssets};
}
export async function prepareNativeRuntimeBundle(assembly:NativeRuntimeAssembly,options:NativeRuntimePreparationOptions):Promise<NativeRuntimePreparation>{
 const {result,key}=assembly;
 if(result.status!=='complete'||typeof result.html!=='string'||!validSha(result.htmlSha256)||sha(result.html)!==result.htmlSha256||!Array.isArray(result.files)||!validSha(assembly.sha256)||!key.sourceNamespace||!key.sourceId||!Number.isSafeInteger(key.version)||key.version<1||!/^[A-Za-z0-9]{6,128}$/.test(options.pageId)||!options.actor.userId||!options.actor.tokenId)throw invalid();
 const fileDigests=result.files.map(file=>{if(!(file.bytes instanceof Uint8Array)||!validSha(file.sha256)||sha(file.bytes)!==file.sha256)throw invalid();return {path:file.path,sha256:file.sha256};});
 const pdfSources=sourcePdfAssets(assembly,result.files),pdfPaths=new Set(pdfSources.map(item=>item.file.path));
 const previewMappings:Record<string,PublicationBundleMapping>=Object.fromEntries(pdfSources.map(item=>[item.file.path,{kind:'asset',id:'NativePdfPreview',revision:'1',sha256:item.file.sha256}]));
 const files=result.files.filter(file=>!pdfPaths.has(file.path)).map(file=>({path:file.path,contentType:fileContentType(file.path)??'application/octet-stream',base64:Buffer.from(file.bytes).toString('base64')}));
 const preflightBundle={entryPath:'index.html',files,...(Object.keys(previewMappings).length?{mappings:previewMappings}:{})};
 // Validate all local paths and non-PDF closure before writing any PDF artifact.
 const preflight=planPublicationBundle(result.html,preflightBundle);
 if(preflight.backends.length||preflight.dependencies.some(dependency=>dependency.kind!=='asset'))throw Error('native_runtime_dataset_or_backend_requires_projection');
 const origin=new URL(options.origin).origin,pdfImports:PdfImport[]=[];
 for(const item of pdfSources)pdfImports.push(await importPdfSourceAsset({assembly,file:item.file,sources:item.sources,options,origin}));
 const mappings:Record<string,PublicationBundleMapping>=Object.fromEntries(pdfImports.map(item=>[item.path,{kind:'asset',id:item.id,revision:item.revision,sha256:item.sha256}]));
 const bundle={entryPath:'index.html',files,...(Object.keys(mappings).length?{mappings}:{})};
 const plan=planPublicationBundle(result.html,bundle);
 if(plan.backends.length||plan.dependencies.some(dependency=>dependency.kind!=='asset'))throw Error('native_runtime_dataset_or_backend_requires_projection');
 const pdfBinding=pdfImports.map(({path,id,revision,sha256,sourceAssets})=>({path,id,revision,sha256,sourceAssets}));
 const requestKey=digest({kind:'native-runtime-v1',key,assemblySha256:assembly.sha256,pageId:options.pageId,sourceHtmlSha256:result.htmlSha256,fileDigests,pdfImports:pdfBinding,owner:{userId:options.actor.userId,tokenId:options.actor.tokenId},visibility:options.visibility,shares:options.shares??[]});
 const prepared=await preparePublicationBundle({html:result.html,publicationBundle:bundle,reserved_id:options.pageId,visibility:options.visibility,...(options.shares?{shares:options.shares}: {})},options.actor,origin,new Request(origin+'/api/artifacts',{method:'POST',headers:{'Idempotency-Key':requestKey}}),(body,request)=>createArtifactFromBody(body,options.actor,origin,request),async()=>{throw Error('native_runtime_updates_not_admitted');},options.pageId);
 if(prepared instanceof Response)throw Object.assign(Error('native_runtime_dependency_publication_failed'),{status:prepared.status,details:await prepared.json()});
 if(typeof prepared.body.html!=='string')throw invalid();
 const dependencies=(prepared.receipts as NativeRuntimeBundleDependency[]).map(dependency=>{const pdf=pdfImports.find(item=>item.path===dependency.path);return pdf?{...dependency,sourceAssets:pdf.sourceAssets}:dependency;});
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
  const actual=await objectStore().get(meta.objectKey);if(!actual.equals(expected))throw invalid();
  objects.push({path:dependency.path,id:receipt.id,revision:receipt.revision,objectKey:meta.objectKey,sha256:sha(actual),bytes:actual.byteLength,contentType:dependency.contentType});
 }
 for(const imported of pdfImports){const receipt=dependencies.find(dependency=>dependency.path===imported.path);if(!receipt||receipt.id!==imported.id||receipt.revision!==imported.revision||receipt.kind!=='asset'||receipt.sha256!==imported.sha256)throw Error('native_runtime_pdf_receipt_binding');objects.push({path:imported.path,id:imported.id,revision:imported.revision,objectKey:imported.objectKey,sha256:imported.sha256,bytes:imported.bytes,contentType:'application/pdf'});}
 const receipt={pageId:options.pageId,key:{...key},assemblySha256:assembly.sha256,sourceHtmlSha256:result.htmlSha256,html:prepared.body.html,htmlSha256:sha(prepared.body.html),fileDigests,dependencies,objects};
 return {...receipt,assetsSha256:digest(receipt)};
}
