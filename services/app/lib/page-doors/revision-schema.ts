/** A saved page revision's schema (GET /api/artifacts/<page>/sql/schema?revision=N): the exact current revision of a
 * group's page, its pinned stored links only, under the reader's own current access and policies. No live, default or
 * connection link mounts, nothing retries; the page and dataset fences are checked again before the answer leaves.
 */
import {SERVICE_PAYLOAD_LIMIT} from '@artifactbin/contracts/payload-limit';
import type {HtmlDatasetLink} from '@artifactbin/contracts/html-page';
import type {AccessActor} from '@/lib/accounts';
import {getArtifactById} from '@/lib/artifacts';
import {SQL_READ_WALL_TIMEOUT_MS,getDb} from '@/lib/platform';
import {readHtmlPageHeader} from '@/lib/html-publication';
import {pageRevisionSchema} from '@/lib/dataset-access';
import {requestOrSessionActor} from '@/lib/authentication';
import {deadlineStep} from './deadline';
import {pageVerifier} from './verify';
async function preparePageRevisionSchema(request:Request,actor:AccessActor,pageId:string,revision:string){
 const signal=request.signal;
 signal.throwIfAborted();
 const {page,head:admitted}=await readHtmlPageHeader(actor,pageId);
 if(!admitted.group_id)throw Error('page_unavailable');
 if(page.revision!==revision)throw Error('page_changed');
 const links=page.links.filter((l):l is HtmlDatasetLink=>l.kind==='dataset'&&l.mode==='pinned');
 if(!links.length)throw Error('page_unavailable');
 const groupId=admitted.group_id;
 const groupHolds=async()=>{
  signal.throwIfAborted();
  if(!(await (await getDb()).query('SELECT 1 FROM groups WHERE id=$1 AND deleted_at IS NULL',[groupId])).rows.length)throw Error('page_unavailable');
  for(const link of links){const row=await getArtifactById(link.datasetId);if(!row||row.deleted_at||row.group_id!==groupId||row.format!=='dataset')throw Error('dataset_not_found');}
 };
 await groupHolds();
 const fences:Array<()=>Promise<void>>=[];
 const bindings=links.map(l=>({name:l.name,datasetId:l.datasetId,revision:l.mode==='pinned'?l.revision:''}));
 const verifyPage=pageVerifier(request,page.pageId,actor,actor,admitted);
 const described=await pageRevisionSchema(actor,links,page.pageId,f=>fences.push(f),signal);
 const verify=async()=>{
  await groupHolds();for(const fence of fences)await fence();
  // Resolve pinned archives afresh too: an unavailable exact revision never becomes a head read.
  const fresh=await pageRevisionSchema(actor,links,page.pageId,()=>{},signal);
  if(JSON.stringify(fresh)!==JSON.stringify(described))throw Error('dataset_changed');
  await verifyPage(page.revision);signal.throwIfAborted();
 };
 const encoded=JSON.stringify({pageId:page.pageId,revision:page.revision,bindings,tables:described.tables});
 if(Buffer.byteLength(encoded)>SERVICE_PAYLOAD_LIMIT)return {status:413,encoded:JSON.stringify({error:'too_large',max:SERVICE_PAYLOAD_LIMIT}),verify};
 await verify();
 return {status:200,encoded,verify};
}
/** The door: the request's own reader, admitted again after the read and identical, then the fences; else 404. */
export async function pageRevisionSchemaDoor(request:Request,pageId:string){
 const revision=new URL(request.url).searchParams.get('revision');
 if(!revision||!/^[1-9]\d*$/.test(revision)||!Number.isSafeInteger(Number(revision)))return Response.json({error:'bad_request'},{status:400});
 const bounded=new Request(request,{signal:AbortSignal.any([request.signal,AbortSignal.timeout(SQL_READ_WALL_TIMEOUT_MS)])});
 try{
  const actor=await deadlineStep(bounded.signal,requestOrSessionActor(request));
  const result=await deadlineStep(bounded.signal,preparePageRevisionSchema(bounded,actor,pageId,revision));
  if(JSON.stringify(await deadlineStep(bounded.signal,requestOrSessionActor(request,{revalidate:true})))!==JSON.stringify(actor))throw Error('page_unavailable');
  await deadlineStep(bounded.signal,result.verify());return new Response(result.encoded,{status:result.status,headers:{'content-type':'application/json','cache-control':'no-store'}});
 }catch{return Response.json({error:'not_found'},{status:404});}
}
