import {pinPublicationAssetUrls} from './plan';
import type { AccessActor } from '@/lib/accounts';
import { archivedVersionFor, canReadArtifact, getArtifactById, readableArtifact, type ArtifactRow } from '@/lib/artifacts';
import { writerFor } from '@/lib/artifact-access';
import { getDb } from '@/lib/platform';
import {serveStoredFile} from '@/lib/datasets';
import {REVALIDATE,etagOf,matchingTag,notModified} from '@/lib/http';
import type {BundleReceipt} from './execute';
interface Admission {delegator:AccessActor;version:number;receipts:BundleReceipt[]}
/** `page`: the page row this request read (once, at its door). `actor`: the request's actor, which also decides a
 * version asked. `capture`: the door verified an export key for this page (lib/export read-key), which admits the page and
 * the version the capture shows, on exactly the terms the capture's own page is admitted (document-serving/raw). */
async function admission(request:Request,actor:AccessActor,page:ArtifactRow|null,capture=false):Promise<Admission|null>{
 if(!page||page.format!=='html'||!(capture||await canReadArtifact(page,actor)))return null;
 // Naming the current version grants no history access beyond the already-readable head.
 const version=new URL(request.url).searchParams.get('version')===String(page.version)?null:await archivedVersionFor(request,page,async()=>actor,{capture});
 if(version==='not_found')return null;
 return {delegator:writerFor(page),version:version?.version??page.version,receipts:((version?.meta??page.meta) as {htmlPublicationDependencies?:BundleReceipt[]}).htmlPublicationDependencies??[]};
}
async function assetVersion(actor:AccessActor,receipt:BundleReceipt):Promise<{id:string;meta:Record<string,unknown>}|null>{
 if(!/^\d+$/.test(receipt.revision))return null;
 const asset = (await readableArtifact(actor, receipt.id, { admission: 'account', formats: ['file', 'image', 'pdf'] }))?.row;
 if (!asset) return null;
 if(String(asset.version)===receipt.revision)return {id:asset.id,meta:asset.meta};
 const archived=(await (await getDb()).query<{meta:Record<string,unknown>;format:string}>('SELECT meta,format FROM artifact_versions WHERE artifact_id=$1 AND version=$2',[receipt.id,Number(receipt.revision)])).rows[0];
 return archived&&['file','image','pdf'].includes(archived.format)?{id:asset.id,meta:archived.meta}:null;
}
/** The types pinned text is rewritten in (`pinPublicationAssetUrls`): its bytes depend on the page, not the file alone. */
const REWRITTEN_TYPES=['text/css','text/javascript','application/javascript'];
/** Pinned bytes the reader's browser keeps: the address names the page version and the file revision. */
const IMMUTABLE='private, max-age=31536000, immutable';
/**
 * Page admission selects immutable bytes; the current page ACL and the current owner’s child-read grant are checked on every request.
 * `page`: the row the door read for this request (app/a/[id]/assets), never re-read here.
 * `captureKey`: an export key the door already verified for this page (app/a/[id]/assets). The capture holds no session, so
 * pinned text it is served names its own-door addresses with that key, and nothing keyed is cached or revalidated.
 */
export async function serveBundleAsset(request:Request,actor:AccessActor,page:ArtifactRow,dependencyId:string,captureKey:string|null=null):Promise<Response|null>{
 const admitted=await admission(request,actor,page,captureKey!==null);if(!admitted)return null;
 const asked=new URL(request.url).searchParams,askedRevision=asked.get('revision');
 const receipt=admitted.receipts.find(item=>item.kind==='asset'&&item.id===dependencyId&&(!askedRevision||item.revision===askedRevision));if(!receipt)return null;
 const asset=await assetVersion(admitted.delegator,receipt);if(!asset)return null;
 // THE CACHE RULE. Access is checked above, against current state, before any byte or 304 leaves. An address that names
 // both the page version and the file revision, answered whole with bytes that are not rewritten text, names immutable
 // bytes: the reader's own browser keeps them a year without asking again (`private`, never a shared cache). A reader
 // who already holds them keeps them after losing access; nobody new can fetch them. Rewritten text and an address
 // without both pins are cached privately and revalidated on every use; a capture key's answer is never cached.
 // The tag names every input of the bytes: the stored object, and for pinned text the page version and sibling
 // receipts it is rewritten against, plus the rewrite itself.
 const pinned=asked.has('version'),rewritten=pinned&&REWRITTEN_TYPES.includes(asset.meta.contentType as string);
 const immutable=captureKey===null&&pinned&&!!askedRevision&&!rewritten;
 const etag=etagOf({page:page.id,dependency:dependencyId,revision:receipt.revision,pdfDisposition:1,object:asset.meta.objectKey??null,sha256:asset.meta.sha256??null,
  pin:pinned?{version:admitted.version,receipts:admitted.receipts.filter(item=>item.kind==='asset'),rewrite:PIN_REWRITE}:null});
 const held=captureKey===null&&matchingTag(request.headers.get('if-none-match'),etag);
 // A 304 replaces the stored rule, so it carries the one its 200 would: a browser holding these bytes under the
 // revalidating rule stops asking.
 if(held){const answer=notModified(held);answer.headers.set('Access-Control-Allow-Origin','*');if(immutable)answer.headers.set('Cache-Control',IMMUTABLE);return answer;}
 // Opaque /raw runners need CORS for admitted modules and fonts; admission
 // above remains the authority, and no credentialed wildcard is granted.
 const response=await serveStoredFile(request,asset,true,{etag}),contentType=response.headers.get('content-type')??'';
 const headers=new Headers(response.headers);
 if(captureKey!==null){headers.set('Cache-Control','no-store');headers.delete('ETag');}else if(response.ok){headers.set('Cache-Control',immutable&&response.status===200?IMMUTABLE:REVALIDATE);headers.set('ETag',etag);}
 if(response.ok&&request.method!=='HEAD'&&REWRITTEN_TYPES.includes(contentType)&&pinned)return new Response(pinPublicationAssetUrls(await response.text(),page.id,admitted.version,contentType,admitted.receipts.filter(item=>item.kind==='asset'),captureKey),{status:response.status,headers});
 return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
}
/** The pinning rewrite's own identity: a change to how pinned text is rewritten is a change to its bytes. */
const PIN_REWRITE=etagOf(pinPublicationAssetUrls.toString());
async function parallel<T,R>(items:readonly T[],work:(item:T)=>Promise<R>):Promise<R[]>{
 const results:R[]=[];let position=0;await Promise.all(Array.from({length:Math.min(4,items.length)},async()=>{while(position<items.length){const index=position++;results[index]=await work(items[index]!);}}));return results;
}
/** One page admission snapshot and bounded parallel current-ACL checks; no credential URLs. */
export async function loadBundleAssetResources(request:Request,actor:AccessActor,pageId:string):Promise<Array<{url:string;contentType:string;bytes:Uint8Array;name:string}>>{
 const admitted=await admission(request,actor,await getArtifactById(pageId));if(!admitted)throw Error('Bundle page unavailable');
 const receipts=[...new Map(admitted.receipts.filter(receipt=>receipt.kind==='asset').map(receipt=>[receipt.id+':'+receipt.revision,receipt])).values()];
 const assets=await parallel(receipts,async receipt=>{const asset=await assetVersion(admitted.delegator,receipt);if(!asset)throw Error('Bundle dependency unavailable');return {receipt,asset};});
 let total=0;for(const {asset}of assets){const size=asset.meta.bytes;if(typeof size!=='number'||!Number.isSafeInteger(size)||size<0||(total+=size)>16_000_000)throw Error('Bundle export limit exceeded');}
 return parallel(assets,async({receipt,asset})=>{
  const response=await serveStoredFile(new Request(request.url,{method:'GET'}),asset);if(!response.ok||!response.body)throw Error('Bundle dependency unavailable');
  const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
  try{while(true){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.byteLength;if(size>(asset.meta.bytes as number)){await reader.cancel();throw Error('Bundle export limit exceeded');}chunks.push(chunk.value);}}finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  return {url:`/a/${pageId}/assets?dependency=${receipt.id}&revision=${receipt.revision}`,contentType:response.headers.get('content-type')??'application/octet-stream',bytes,name:receipt.path.split('/').pop()!};
 });
}
