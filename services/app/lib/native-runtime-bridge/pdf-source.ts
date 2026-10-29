/** Verified source-PDF import through the product's ordinary owned artifact path. */
import {createHash} from 'node:crypto';
import path from 'node:path';
import {parse,type DefaultTreeAdapterMap} from 'parse5';
import {fileContentType} from '@artifactbin/contracts';
import {getOwnedArtifactFor} from '@/lib/artifacts';
import {objectStore} from '@/lib/object-store';
import { MAX_PDF_BYTES } from '@/lib/platform';
import {pdfPageCount} from '@/lib/object-store/pdf-store';
import {sniffAssetType} from '@/lib/web-ingest/sniff';
import {createArtifactFromBody} from '@/lib/publish/publish';
import type {NativeRuntimeAssembly,NativeRuntimePreparationOptions,NativeRuntimeSourceAssetProvenance,NativeRuntimeSourceFileReceipt} from './contracts';

const sha=(value:string|Uint8Array)=>createHash('sha256').update(value).digest('hex');
const validSha=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const canonical=(value:unknown):unknown=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([key,item])=>[key,canonical(item)])):value;
const digest=(value:unknown)=>sha(JSON.stringify(canonical(value)));

export interface NativeRuntimePdfImport {
 path:string;
 id:string;
 revision:string;
 objectKey:string;
 sha256:string;
 bytes:number;
 sourceAssets:readonly NativeRuntimeSourceAssetProvenance[];
}
interface SourcePdfFile {path:string;bytes:Uint8Array;sha256:string}

function sourcePdfAssets(assembly:NativeRuntimeAssembly,files:readonly SourcePdfFile[]):{file:SourcePdfFile;sources:readonly NativeRuntimeSourceAssetProvenance[]}[]{
 const pdfFiles=files.filter(file=>fileContentType(file.path)==='application/pdf'),receipts=assembly.input?.fileReceipts??[];
 return pdfFiles.map(file=>{
  if(file.bytes.byteLength>MAX_PDF_BYTES||sniffAssetType(Buffer.from(file.bytes))!=='application/pdf')throw Error('native_runtime_pdf_invalid');
  const matching=receipts.filter(receipt=>receipt.kind==='pdf'&&receipt.target==='./'+file.path);
  if(!matching.length)throw Error('native_runtime_pdf_receipt_missing');
  const sources:NativeRuntimeSourceAssetProvenance[]=matching.map(receipt=>{
   const {sha256:receiptSha,...body}=receipt as NativeRuntimeSourceFileReceipt;
   if(!/^[_A-Za-z0-9-]{6,128}$/.test(receipt.sourceId)||receipt.source!=='ref:'+receipt.sourceId||!Number.isSafeInteger(receipt.version)||receipt.version<1||!validSha(receipt.sourceRowSha256)||!validSha(receiptSha)||digest(body)!==receiptSha||receipt.bytes!==file.bytes.byteLength||typeof receipt.name!=='string'||!receipt.name||receipt.pages!==undefined&&(!Number.isSafeInteger(receipt.pages)||receipt.pages<1))throw Error('native_runtime_pdf_receipt_invalid');
   const pages=pdfPageCount(Buffer.from(file.bytes));if(receipt.pages!==undefined&&receipt.pages!==pages)throw Error('native_runtime_pdf_pages');
   return {sourceId:receipt.sourceId,sourceVersion:receipt.version,sourceRowSha256:receipt.sourceRowSha256,sourceReceiptSha256:receiptSha,name:receipt.name,bytes:receipt.bytes,...(receipt.pages===undefined?{}:{pages:receipt.pages})};
  });
  if(new Set(sources.map(source=>`${source.sourceId}@${source.sourceVersion}`)).size!==sources.length||new Set(sources.map(source=>JSON.stringify([source.name,source.bytes,source.pages]))).size!==1)throw Error('native_runtime_pdf_receipt_conflict');
  return {file,sources};
 });
}

async function importPdfSourceAsset(input:{assembly:NativeRuntimeAssembly;file:SourcePdfFile;sources:readonly NativeRuntimeSourceAssetProvenance[];options:NativeRuntimePreparationOptions;origin:string}):Promise<NativeRuntimePdfImport>{
 const {assembly,file,sources,options,origin}=input,requestKey=digest({kind:'native-runtime-pdf-v1',key:assembly.key,assemblySha256:assembly.sha256,pageId:options.pageId,path:file.path,fileSha256:file.sha256,sources,owner:{userId:options.actor.userId,tokenId:options.actor.tokenId},visibility:options.visibility,shares:options.shares??[]});
 const pdf=`data:application/pdf;base64,${Buffer.from(file.bytes).toString('base64')}`;
 const response=await createArtifactFromBody({pdf,title:sources[0]!.name,visibility:options.visibility,...(options.shares?{shares:options.shares}:{})},options.actor,origin,new Request(origin+'/api/artifacts',{method:'POST',headers:{'Idempotency-Key':requestKey}}));
 const saved=await response.json().catch(()=>({})) as {id?:unknown;version?:unknown};
 if(!response.ok||typeof saved.id!=='string'||!/^[_A-Za-z0-9-]{6,128}$/.test(saved.id)||!/^[0-9]+$/.test(String(saved.version)))throw Object.assign(Error('native_runtime_pdf_publication_failed'),{status:response.status});
 const revision=String(saved.version),row=await getOwnedArtifactFor(options.actor,saved.id) as (Awaited<ReturnType<typeof getOwnedArtifactFor>>&{format?:string;user_id?:string|null;token_id?:string|null;visibility?:string;title?:string;meta?:Record<string,unknown>})|null;
 if(!row||row.format!=='pdf'||String((row as {version?:unknown}).version)!==revision||row.user_id!==options.actor.userId||row.token_id!==options.actor.tokenId||row.visibility!==options.visibility||row.title!==sources[0]!.name)throw Error('native_runtime_pdf_owner');
 const meta=row.meta??{};
 if(meta.contentType!=='application/pdf'||meta.bytes!==file.bytes.byteLength||meta.sha256!==file.sha256||sources[0]!.pages!==undefined&&meta.pages!==sources[0]!.pages||typeof meta.objectKey!=='string')throw Error('native_runtime_pdf_metadata');
 const actual=await objectStore().get(meta.objectKey);if(!actual.equals(Buffer.from(file.bytes))||sha(actual)!==file.sha256)throw Error('native_runtime_pdf_bytes');
 return {path:file.path,id:row.id,revision,objectKey:meta.objectKey,sha256:file.sha256,bytes:file.bytes.byteLength,sourceAssets:sources.map(source=>({...source}))};
}

/** Validate every source receipt before the first PDF upload, then import through the PDF API tier. */
export async function importNativeRuntimePdfs(assembly:NativeRuntimeAssembly,files:readonly SourcePdfFile[],options:NativeRuntimePreparationOptions,origin:string):Promise<NativeRuntimePdfImport[]>{
 const sources=sourcePdfAssets(assembly,files),imports:NativeRuntimePdfImport[]=[];
 for(const item of sources)imports.push(await importPdfSourceAsset({assembly,file:item.file,sources:item.sources,options,origin}));
 return imports;
}

/** Rewrite only authored local links whose exact path has a verified imported-PDF receipt. */
export function rewriteNativeRuntimePdfLinks(html:string,pageId:string,imports:readonly NativeRuntimePdfImport[]):string{
 const addresses=new Map(imports.map(item=>[item.path,`/a/${pageId}/assets?dependency=${item.id}&revision=${item.revision}`]));
 if(!addresses.size)return html;
 const edits:{start:number;end:number;value:string}[]=[],document=parse(html,{sourceCodeLocationInfo:true});
 const visit=(node:DefaultTreeAdapterMap['node'])=>{
  if('tagName'in node&&node.tagName==='a'){
   const href=node.attrs.find(attr=>attr.name==='href')?.value,location=node.sourceCodeLocation?.attrs?.href;
   if(href&&location&&!/^(?:[a-z][a-z\d+.-]*:|\/|#)/i.test(href)){
    const suffixAt=href.search(/[?#]/),pathPart=suffixAt<0?href:href.slice(0,suffixAt);
    let decoded:string;try{decoded=decodeURIComponent(pathPart);}catch{decoded='';}
    if(decoded){
     const resolved=path.posix.normalize(path.posix.join(path.posix.dirname('index.html'),decoded)),address=addresses.get(resolved);
     if(address){
      const target=new URL(address,'https://asset.invalid'),source=new URL(href,'https://source.invalid/');
      for(const [name,value] of source.searchParams){if(['dependency','revision','version'].includes(name))throw Error('native_runtime_pdf_link_query_conflict');target.searchParams.append(name,value);}
      target.hash=source.hash;
      const serialized=(target.pathname+target.search+target.hash).replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','%3C').replaceAll('>','%3E');
      edits.push({start:location.startOffset,end:location.endOffset,value:`href="${serialized}"`});
     }
    }
   }
  }
  if('tagName'in node&&node.tagName==='template'&&'content'in node)for(const child of node.content.childNodes)visit(child);
  if('childNodes'in node)for(const child of node.childNodes)visit(child);
 };
 visit(document);
 for(const edit of edits.sort((a,b)=>b.start-a.start))html=html.slice(0,edit.start)+edit.value+html.slice(edit.end);
 return html;
}
