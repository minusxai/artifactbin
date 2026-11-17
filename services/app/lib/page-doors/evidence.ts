/** Saved-page evidence is current-page, pinned-stored only. No live/default/connection dispatch,
 * no retries. A prepared result retains canonical dataset and page fences through caller buffering.
 */
import {createHash} from 'node:crypto';
import {ARTIFACT_WORKLOAD_LIMIT,type PageEvidenceSql,type HtmlDatasetLink,type PageEvidenceOperation,type PageDatasetSelect} from '@artifactbin/contracts';
import type {AccessActor} from '@/lib/accounts';
import {getArtifactHeaderById,getArtifactById} from '@/lib/artifacts';
import {SQL_READ_WALL_TIMEOUT_MS,getDb} from '@/lib/platform';
import {readHtmlPage} from '@/lib/html-publication';
import {executePageSql,pageEvidenceSchema} from '@/lib/dataset-access';
import {withPageEvidenceSelect} from '@/lib/dataset-permissions';
import {requestOrSessionActor} from '@/lib/authentication';
import {pageEvidenceStep} from './deadline';
import {pageVerifier} from './verify';
export async function preparePageEvidence(request:Request,actor:AccessActor,operation:PageEvidenceOperation,grant?:PageDatasetSelect){
 const signal=request.signal;
 signal.throwIfAborted();
 const admitted=await getArtifactHeaderById(operation.pageId);
 if(!admitted?.group_id)throw Error('page_unavailable');
 const page=await readHtmlPage(actor,operation.pageId);
 if(page.revision!==operation.revision)throw Error('page_changed');
 const pinned=page.links.filter((l):l is HtmlDatasetLink=>l.kind==='dataset'&&l.mode==='pinned');
 const links=grant?grant.links.map(tuple=>{
  const link=pinned.find(l=>l.name===tuple.name&&l.datasetId===tuple.datasetId&&l.mode==='pinned'&&l.revision===tuple.revision);
  if(!link)throw Error('page_unavailable');return link;
 }):pinned;
 if(!links.length||grant&&(grant.pageId!==page.pageId||grant.revision!==page.revision||actor.workload?.principal.groupId!==admitted.group_id))throw Error('page_unavailable');
 const groupId=admitted.group_id;
 const groupHolds=async()=>{
  signal.throwIfAborted();
  if(!(await (await getDb()).query('SELECT 1 FROM groups WHERE id=$1 AND deleted_at IS NULL',[groupId])).rows.length)throw Error('page_unavailable');
  for(const link of links){const row=await getArtifactById(link.datasetId);if(!row||row.deleted_at||row.group_id!==groupId||row.format!=='dataset')throw Error('dataset_not_found');}
 };
 await groupHolds();
 const run=<T>(fn:()=>Promise<T>)=>grant?withPageEvidenceSelect({actor,pageId:page.pageId,groupId,datasetIds:links.map(l=>l.datasetId)},fn):fn();
 const fences:Array<()=>Promise<void>>=[];
 const retain=(f:()=>Promise<void>)=>fences.push(f);
 let mounted:ReadonlySet<string>=new Set(links.map(l=>l.name));
 const bindingTuples=links.map(l=>({name:l.name,datasetId:l.datasetId,revision:l.mode==='pinned'?l.revision:''}));
 const verifyPage=pageVerifier(request,page.pageId,actor,actor,admitted);
 const verify=()=>run(async()=>{
  await groupHolds();for(const fence of fences)await fence();
  // Resolve pinned archives afresh too: an unavailable exact revision never becomes a head read.
  const fresh=await pageEvidenceSchema(actor,links,page.pageId,()=>{},signal);
  if(JSON.stringify(fresh)!==JSON.stringify(described))throw Error('dataset_changed');
  await verifyPage(page.revision);signal.throwIfAborted();
 });
 const described=await run(()=>pageEvidenceSchema(actor,links,page.pageId,retain,signal));
 // Fresh metadata-only identity for the auth owner's second decision, never a second row execution.
 const schema=described.tables;
 const fingerprint=createHash('sha256').update(JSON.stringify([admitted,described,await Promise.all(links.map(l=>getArtifactById(l.datasetId)))])).digest('hex');
 const answer=operation.kind==='page-evidence-schema'?{status:200,body:{tables:schema}}:await run(()=>executePageSql(actor,links,operation,{pageId:page.pageId,readOnly:true,retainReadFence:retain,retainMountedLinks:selected=>{mounted=selected;}},signal));
 const bindings=bindingTuples.filter(l=>mounted.has(l.name));
 const identity:Pick<PageEvidenceSql,'pageId'|'revision'|'bindings'>={pageId:page.pageId,revision:page.revision,bindings};
 const body=answer.status===200?{...identity,...answer.body}:answer.body;
 const encoded=JSON.stringify(body);
 if(Buffer.byteLength(encoded)>ARTIFACT_WORKLOAD_LIMIT)return {status:413,encoded:JSON.stringify({error:'too_large'}),verify,fingerprint};
 await verify();
 return {status:answer.status,encoded,verify,fingerprint};
}
/** Explicit revision human schema door; ordinary current human ACL and policy, never a workload grant. */
export async function pageEvidenceSchemaDoor(request:Request,pageId:string){
 const revision=new URL(request.url).searchParams.get('revision');
 if(!revision||!/^[1-9]\d*$/.test(revision)||!Number.isSafeInteger(Number(revision)))return Response.json({error:'bad_request'},{status:400});
 const bounded=new Request(request,{signal:AbortSignal.any([request.signal,AbortSignal.timeout(SQL_READ_WALL_TIMEOUT_MS)])});
 try{
  const actor=await pageEvidenceStep(bounded.signal,requestOrSessionActor(request));
  if(actor.workload)return Response.json({error:'forbidden'},{status:403});
  const result=await pageEvidenceStep(bounded.signal,preparePageEvidence(bounded,actor,{kind:'page-evidence-schema',pageId,revision}));
  if(JSON.stringify(await pageEvidenceStep(bounded.signal,requestOrSessionActor(request,{revalidate:true})))!==JSON.stringify(actor))throw Error('page_unavailable');
  await pageEvidenceStep(bounded.signal,result.verify());return new Response(result.encoded,{status:result.status,headers:{'content-type':'application/json','cache-control':'no-store'}});
 }catch{return Response.json({error:'not_found'},{status:404});}
}
