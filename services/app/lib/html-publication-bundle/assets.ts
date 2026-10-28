import {pinPublicationAssetUrls} from './plan';
import type {AccessActor} from '@/lib/accounts';
import {archivedVersionFor,canReadArtifact,getArtifactById,writerFor} from '@/lib/artifacts';
import {getDb} from '@/lib/platform/db';
import {serveStoredFile} from '@/lib/datasets/file-store';
import type {BundleReceipt} from './execute';
interface Admission {delegator:AccessActor;version:number;receipts:BundleReceipt[]}
async function admission(request:Request,actor:AccessActor,pageId:string):Promise<Admission|null>{
 const page=await getArtifactById(pageId);if(!page||page.format!=='html'||!await canReadArtifact(page,actor))return null;
 // Naming the current version grants no history access beyond the already-readable head.
 const version=new URL(request.url).searchParams.get('version')===String(page.version)?null:await archivedVersionFor(request,page);
 if(version==='not_found')return null;
 return {delegator:writerFor(page),version:version?.version??page.version,receipts:((version?.meta??page.meta) as {htmlPublicationDependencies?:BundleReceipt[]}).htmlPublicationDependencies??[]};
}
async function assetVersion(actor:AccessActor,receipt:BundleReceipt):Promise<{id:string;meta:Record<string,unknown>}|null>{
 if(!/^\d+$/.test(receipt.revision))return null;
 const asset=await getArtifactById(receipt.id);if(!asset||!['file','image','pdf'].includes(asset.format)||!await canReadArtifact(asset,actor))return null;
 if(String(asset.version)===receipt.revision)return {id:asset.id,meta:asset.meta};
 const archived=(await (await getDb()).query<{meta:Record<string,unknown>;format:string}>('SELECT meta,format FROM artifact_versions WHERE artifact_id=$1 AND version=$2',[receipt.id,Number(receipt.revision)])).rows[0];
 return archived&&['file','image','pdf'].includes(archived.format)?{id:asset.id,meta:archived.meta}:null;
}
/** Page admission selects immutable bytes; the current page ACL and the current owner’s child-read grant are checked on every request. */
export async function serveBundleAsset(request:Request,actor:AccessActor,pageId:string,dependencyId:string):Promise<Response|null>{
 const admitted=await admission(request,actor,pageId);if(!admitted)return null;
 const askedRevision=new URL(request.url).searchParams.get('revision');
 const receipt=admitted.receipts.find(item=>item.kind==='asset'&&item.id===dependencyId&&(!askedRevision||item.revision===askedRevision));if(!receipt)return null;
 const asset=await assetVersion(admitted.delegator,receipt);if(!asset)return null;
 // Opaque /raw runners need CORS for admitted modules and fonts; admission
 // above remains the authority, and no credentialed wildcard is granted.
 const response=await serveStoredFile(request,asset,true),contentType=response.headers.get('content-type')??'';
 if(response.ok&&request.method!=='HEAD'&&['text/css','text/javascript','application/javascript'].includes(contentType)&&new URL(request.url).searchParams.has('version'))return new Response(pinPublicationAssetUrls(await response.text(),pageId,admitted.version,contentType,admitted.receipts.filter(item=>item.kind==='asset')),{status:response.status,headers:response.headers});
 return response;
}
async function parallel<T,R>(items:readonly T[],work:(item:T)=>Promise<R>):Promise<R[]>{
 const results:R[]=[];let position=0;await Promise.all(Array.from({length:Math.min(4,items.length)},async()=>{while(position<items.length){const index=position++;results[index]=await work(items[index]!);}}));return results;
}
/** One page admission snapshot and bounded parallel current-ACL checks; no credential URLs. */
export async function loadBundleAssetResources(request:Request,actor:AccessActor,pageId:string):Promise<Array<{url:string;contentType:string;bytes:Uint8Array}>>{
 const admitted=await admission(request,actor,pageId);if(!admitted)throw Error('Bundle page unavailable');
 const receipts=[...new Map(admitted.receipts.filter(receipt=>receipt.kind==='asset').map(receipt=>[receipt.id+':'+receipt.revision,receipt])).values()];
 const assets=await parallel(receipts,async receipt=>{const asset=await assetVersion(admitted.delegator,receipt);if(!asset)throw Error('Bundle dependency unavailable');return {receipt,asset};});
 let total=0;for(const {asset}of assets){const size=asset.meta.bytes;if(typeof size!=='number'||!Number.isSafeInteger(size)||size<0||(total+=size)>16_000_000)throw Error('Bundle export limit exceeded');}
 return parallel(assets,async({receipt,asset})=>{
  const response=await serveStoredFile(new Request(request.url,{method:'GET'}),asset);if(!response.ok||!response.body)throw Error('Bundle dependency unavailable');
  const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
  try{while(true){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.byteLength;if(size>(asset.meta.bytes as number)){await reader.cancel();throw Error('Bundle export limit exceeded');}chunks.push(chunk.value);}}finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  return {url:`/a/${pageId}/assets?dependency=${receipt.id}&revision=${receipt.revision}`,contentType:response.headers.get('content-type')??'application/octet-stream',bytes};
 });
}
