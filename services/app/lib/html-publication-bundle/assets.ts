import type {AccessActor} from '@/lib/accounts';
import {archivedVersionFor,canReadArtifact,getArtifactById} from '@/lib/artifacts';
import {getDb} from '@/lib/platform/db';
import {serveStoredFile} from '@/lib/datasets/file-store';
import type {BundleReceipt} from './execute';
/** Page admission selects immutable bytes; both current ACLs are checked on every request. */
export async function serveBundleAsset(request:Request,actor:AccessActor,pageId:string,dependencyId:string):Promise<Response|null>{
 const page=await getArtifactById(pageId);if(!page||page.format!=='html'||!await canReadArtifact(page,actor))return null;
 const version=await archivedVersionFor(request,page);if(version==='not_found')return null;
 const meta=version?.meta??page.meta;
 const receipts=(meta as {htmlPublicationDependencies?:BundleReceipt[]}).htmlPublicationDependencies??[];
 const askedRevision=new URL(request.url).searchParams.get('revision');
 const receipt=receipts.find(item=>item.kind==='asset'&&item.id===dependencyId&&(!askedRevision||item.revision===askedRevision));if(!receipt||!/^\d+$/.test(receipt.revision))return null;
 const asset=await getArtifactById(dependencyId);if(!asset||asset.format!=='file'||!await canReadArtifact(asset,actor))return null;
 let assetMeta=asset.meta;
 if(String(asset.version)!==receipt.revision){
  // This is the exact revision admitted by a readable page, not a general history-read door.
  const archived=(await (await getDb()).query<{meta:Record<string,unknown>;format:string}>('SELECT meta,format FROM artifact_versions WHERE artifact_id=$1 AND version=$2',[dependencyId,Number(receipt.revision)])).rows[0];
  if(!archived||archived.format!=='file')return null;assetMeta=archived.meta;
 }
 return serveStoredFile(request,{id:asset.id,meta:assetMeta});
}
/** Authorized bytes for the offline packer. URLs carry identifiers only, never credentials. */
export async function loadBundleAssetResources(request:Request,actor:AccessActor,pageId:string):Promise<Array<{url:string;contentType:string;bytes:Uint8Array}>>{
 const page=await getArtifactById(pageId);if(!page||page.format!=='html'||!await canReadArtifact(page,actor))throw Error('Bundle page unavailable');
 const version=await archivedVersionFor(request,page);if(version==='not_found')throw Error('Bundle version unavailable');
 const receipts=((version?.meta??page.meta) as {htmlPublicationDependencies?:BundleReceipt[]}).htmlPublicationDependencies??[];
 const resources:Array<{url:string;contentType:string;bytes:Uint8Array}>=[];let total=0;const seen=new Set<string>();
 for(const receipt of receipts){
  if(receipt.kind!=='asset'||seen.has(receipt.id))continue;seen.add(receipt.id);
  const url=`/a/${pageId}/assets?dependency=${receipt.id}&revision=${receipt.revision}`;
  const address=new URL(url,request.url),requestedVersion=new URL(request.url).searchParams.get('version');
  if(requestedVersion)address.searchParams.set('version',requestedVersion);
  const resolved=await serveBundleAsset(new Request(address,request),actor,pageId,receipt.id);
  if(!resolved||!resolved.ok)throw Error('Bundle dependency unavailable');
  const bytes=new Uint8Array(await resolved.arrayBuffer());
  if((total+=bytes.byteLength)>16_000_000)throw Error('Bundle export limit exceeded');
  resources.push({url,contentType:resolved.headers.get('content-type')??'application/octet-stream',bytes});
 }
 return resources;
}
