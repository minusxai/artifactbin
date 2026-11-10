import {getHtmlBackendVersion} from '@/lib/html-backends';
import type {HtmlDatasetLink,HtmlPageLink} from '@artifactbin/contracts';
import type { AccessActor } from '@/lib/accounts';
import {REVALIDATE_ACTOR_HEADER,SQL_READ_LIMITS} from '@artifactbin/contracts';
import type {HtmlPageVersion,PageNamespaceSource,PageOperationRequest,HtmlJsonObject} from '@artifactbin/contracts';
import { canReadArtifact, getArtifactById, getArtifactHeaderById, accessMoved, editablePage, readableArtifactHeader, type ArtifactRow } from '@/lib/artifacts';
import { pageRole } from '@/lib/dataset-permissions';
import {readHtmlPage} from '@/lib/html-publication';
import {createPageOperations,createBackendInvoker,createResolverQuery,createResolverSql,pageOperationKind,callPageFunction,FUNCTION_INPUT_BYTES,type PageFunctionSource,type ResolverDatasets} from '@/lib/page-operations';
import {executeLinkedDatasetGraphql, executePageSql, loadPageDatasets, planLinkedDatasetTables, type PageCommitGuard, type PageDatasets} from '@/lib/dataset-graphql';
import {transactionAccessFacts} from '@/lib/artifact-access';
import {DatasetError} from '@/lib/datasets';
import {getDb,runWithRequest,services} from '@/lib/platform';
import {people} from '@/lib/datasets';
import {json,readBody,readJson,PayloadTooLarge} from '@/lib/http';
import { requestOrSessionActor, refusesCrossSite } from '@/lib/authentication';
import {ACTOR_HEADER} from '@artifactbin/contracts';
import {DOMAIN_READ_ONLY_MESSAGE} from '@artifactbin/contracts/domain-footer';
import {exportKeyReader} from '@/lib/export';
/** The page's dataset links: each mounts its dataset's generated roots flat at the top of the page schema. */
const datasetLinks=(page:HtmlPageVersion)=>page.links.filter((link):link is HtmlDatasetLink=>link.kind==='dataset');
async function backendSources(page:HtmlPageVersion):Promise<PageNamespaceSource[]>{
 return Promise.all(page.links.filter(link=>link.kind==='backend').map(async link=>{
  const backend=await getHtmlBackendVersion(link.backendId,link.version);
  if(!backend||backend.pageId!==page.pageId)throw Error('backend_link_mismatch');
  return {name:link.name,fileId:link.backendId,version:link.version,typeDefs:backend.typeDefs};
 }));
}
/** How many times a read raced by a linked dataset's write runs before the request is refused. */
const RACED_READ_ATTEMPTS=3;
interface OperationScope{retainReadFence?:(verify:()=>Promise<void>)=>void;idempotencyKey?:string;signal?:AbortSignal;commitGuard?:PageCommitGuard}
function operations(actor:AccessActor,page:HtmlPageVersion,scope:OperationScope){
 const {retainReadFence}=scope;
 const backend=createBackendInvoker(services().runner,getHtmlBackendVersion);
 const linked=datasetLinks(page);
 // The dataset links load once per request, for this reader's role through this page: the composed SDL and the execution share it.
 let loaded:Promise<PageDatasets>|undefined;
 const datasets=()=>loaded??=loadPageDatasets(actor,linked,{pageId:page.pageId,...(retainReadFence?{retainReadFence}:{}),...(scope.idempotencyKey?{idempotencyKey:scope.idempotencyKey}:{}),...(scope.commitGuard?{commitGuard:scope.commitGuard}:{})},scope.signal??new AbortController().signal);
 const sources=async(_actor:AccessActor,current:HtmlPageVersion):Promise<readonly PageNamespaceSource[]>=>[
  ...await backendSources(current),
  ...(linked.length?(await datasets()).sources.map(source=>({...source,kind:'dataset-hasura' as const})):[]),
 ];
 // The page this request already read for this reader and revision is not read again (its source is the costly part).
 const readPage:typeof readHtmlPage=(reader,id,revision)=>reader===actor&&id===page.pageId&&revision===page.revision?Promise.resolve(page):readHtmlPage(reader,id,revision);
 // The built-in viewer's name is the reader's own person card (never another person's, never an email).
 const viewerName=async(subject:string)=>(await people(await getDb(),[subject]))[subject]?.name??null;
 return createPageOperations({readPage,role:async(a,id)=>{const row=await getArtifactHeaderById(id);return row?pageRole(row,a):null;},sources,datasets:async()=>linked.length?datasets():undefined,viewerName,
  // The live-region editor's own check (lib/region-sessions opens a region only on an `editablePage`).
  canEdit:async(reader,id)=>!!await editablePage(await getDb(),reader,id),
  invoke:async call=>{
  const link=page.links.find(link=>link.name===call.namespace);
  // Dataset roots never reach invoke: page operations run them through `datasets`.
  if(link?.kind!=='backend')throw Error('namespace_not_linked');
  return backend(call);
 }});
}
/** The datasets the page head links now, live and pinned. */
const headDatasetLinks=async(pageId:string)=>{const row=await getArtifactById(pageId);return !row||row.format!=='html'?[]:((row.meta as {htmlLinks?:HtmlPageLink[]}).htmlLinks??[]).filter((link):link is HtmlDatasetLink=>link.kind==='dataset');};
/**
 * A resolver's caps.query and caps.sql, composed here so page operations stay below datasets and artifacts: the
 * datasets the page head links, run as the caller the run was admitted for, as one Hasura-style API (query) or as
 * read-only SQL tables on the SQL service's read door (sql).
 */
export const resolverDatasets:ResolverDatasets={
 query:createResolverQuery({links:headDatasetLinks,execute:executeLinkedDatasetGraphql,
  // A resolver's write goes through the page head it read the links from: the same guard as every page write.
  page:async(pageId,actor)=>{
   const row=await getArtifactById(pageId);
   const links=!row||row.format!=='html'?[]:((row.meta as {htmlLinks?:HtmlPageLink[]}).htmlLinks??[]).filter((link):link is HtmlDatasetLink=>link.kind==='dataset');
   return {links,commitGuard:row?pageCommitGuard(pageId,actor,row):async()=>{throw new DatasetError('The page is unavailable; nothing was written.',404);}};
  }}),
 sql:createResolverSql({links:headDatasetLinks,plan:planLinkedDatasetTables,run:input=>services().sql.run(input)}),
};
const IDEMPOTENCY_KEY=/^[A-Za-z0-9_-]{16,128}$/;
/** Original request identity and ACLs guard both SDL and executions. */
export async function pageGraphql(request:Request,pageId:string):Promise<Response>{
 if(request.method==='POST'&&request.headers.get('origin')==='null')return opaqueOriginRead(request,pageId);
 return answer(request,pageId);
}
/** Every header a credential arrives in (the proxy's attached actor included); an opaque origin's read carries none. */
const CREDENTIAL_HEADERS=['cookie','authorization','proxy-authorization',ACTOR_HEADER];
/** An opaque origin's read is never credentialed by the browser: no cookie-borne answer is exposed. */
const READ_CORS={'Access-Control-Allow-Origin':'*','Cache-Control':'no-store'};
/**
 * AN OPAQUE ORIGIN'S READ: a sandboxed document no app frame relays for (the exporter's capture, document-serving/raw;
 * an anonymous owner host's page) reads its own page's data here directly (html-runtime/domain-reads). Every
 * credential header is dropped, so no cookie or bearer the browser attaches ever reads here; only queries run.
 *
 * It reads as NOBODY, or as the requester an EXPORT KEY was minted for (lib/export read-key, carried in the body from
 * the capture's own address): the export door admitted that requester and the capture shows what they may read, so
 * the read runs under their access, re-checked at read time like any reader's, and never anyone else's. A key that
 * does not verify for this page reads as nobody. The `*` CORS exposes the answer to that capture page alone: the key
 * is seconds-long, scoped to this page and never shown to a reader.
 */
async function opaqueOriginRead(request:Request,pageId:string):Promise<Response>{
 const headers=new Headers(request.headers);
 for(const name of CREDENTIAL_HEADERS)headers.delete(name);
 const body=await request.text();
 let parsed:unknown=null;try{parsed=JSON.parse(body);}catch{/* refused below */}
 const {query,operationName}=(parsed&&typeof parsed==='object'?parsed:{}) as {query?:unknown;operationName?:unknown};
 const kind=typeof query==='string'?pageOperationKind(query,typeof operationName==='string'?operationName:undefined):null;
 if(kind==='mutation')return json({data:null,errors:[{message:DOMAIN_READ_ONLY_MESSAGE}]},403,READ_CORS);
 if(kind!=='query')return json({error:'invalid_graphql_operation'},400,READ_CORS);
 const key=(parsed as {key?:unknown}|null)?.key;
 const reader=typeof key==='string'?exportKeyReader(pageId,key):null;
 const guest=new Request(request.url,{method:'POST',headers,body,signal:request.signal});
 const answered=await runWithRequest(guest,()=>answer(guest,pageId,reader??undefined));
 const cors=new Headers(answered.headers);
 cors.set('access-control-allow-origin','*');cors.delete('access-control-allow-credentials');
 return new Response(answered.body,{status:answered.status,statusText:answered.statusText,headers:cors});
}
type ArtifactHeader=NonNullable<Awaited<ReturnType<typeof getArtifactHeaderById>>>;
/**
 * After a read: the reader is still who they were, may still read the page, and its head (access, edit, version,
 * links) did not move since `admitted`; otherwise the answer is withheld (`page_unavailable`).
 */
function pageVerifier(request:Request,pageId:string,actor:AccessActor,reader:AccessActor|undefined,admitted:ArtifactHeader){
 return async(revision:string)=>{
  const currentActor:AccessActor=reader??await requestOrSessionActor(request,{revalidate:true});
  if(JSON.stringify(currentActor)!==JSON.stringify(actor))throw Error('page_unavailable');
  // One header read decides both: the head did not move, and this reader may still read it.
  const readable=await readableArtifactHeader(currentActor,pageId),current=readable?.row;
  if(!current||current.format!=='html'||accessMoved(admitted,current)||current.edit_id!==admitted.edit_id||current.version!==admitted.version||JSON.stringify(current.meta.htmlLinks)!==JSON.stringify(admitted.meta.htmlLinks))throw Error('page_unavailable');
  // An archived revision is immutable; its own row is checked only when it is not the head just read.
  if(revision!==String(current.version))await readHtmlPage(currentActor,pageId,revision);
 };
}
/**
 * A page write's commit guard (lib/dataset-graphql PageCommitGuard): inside the dataset write's transaction, the page
 * row is locked and read on `tx`, and the write commits only if the page is the head the request was admitted on
 * (same edit, version and sharing), it links exactly the datasets it linked then, and the reader may still read it,
 * decided from facts read on `tx` alone. Otherwise nothing commits: removing a link, republishing the page or
 * revoking the reader's access while the write runs refuses it.
 */
function pageCommitGuard(pageId:string,actor:AccessActor,admitted:ArtifactHeader):PageCommitGuard{
 return async tx=>{
  // LOCK ORDER (lib/artifact-access locks.ts, README "Lock order"): this guard runs inside the dataset write's commit,
  // after assertWriteCommit locked the page and the datasets in the one global order; the page row below is already
  // held FOR SHARE, and each fact the decision reads locks exactly its own rows as it reads them (read-only:
  // transactionAccessFacts never stamps an invitation). A deadlock with another writer aborts this attempt and the
  // whole commit is retried (lib/platform retryOnConflict).
  const current=(await tx.query<ArtifactRow>('SELECT * FROM artifacts WHERE id=$1 AND deleted_at IS NULL FOR SHARE',[pageId])).rows[0];
  const holds=!!current&&current.format==='html'&&!accessMoved(admitted,current)&&current.edit_id===admitted.edit_id&&current.version===admitted.version&&
   JSON.stringify(current.meta.htmlLinks)===JSON.stringify(admitted.meta.htmlLinks)&&await canReadArtifact(current,actor,transactionAccessFacts(actor,tx));
  if(!holds)throw new DatasetError('The page or your access to it changed while the write ran; nothing was written. Reload the page and try again.',409);
 };
}
/**
 * THE PAGE SQL DOOR (POST /api/artifacts/<page>/sql, lib/dataset-graphql `executePageSql`): `{sql, params?, revision,
 * readOnly?}` and an optional Idempotency-Key, one statement over the revision's dataset links as the request's
 * reader, read or write. The same reader, cross-site guard and page audience as the page GraphQL: a page the reader
 * cannot read is the uniform 404. Only the head revision writes (an archived one, or `readOnly`, reads); a read
 * whose dataset moved while it ran re-runs, a bounded number of times, and leaves only if the page still holds.
 * An opaque origin (a capture, document-serving/raw) has no SQL door.
 */
export async function pageSqlDoor(request:Request,pageId:string):Promise<Response>{
 const headers={'Cache-Control':'no-store',[REVALIDATE_ACTOR_HEADER]:'1'};
 if(request.headers.get('origin')==='null')return json({error:'permission_denied',message:'This page request is not permitted'},403,headers);
 const actor=await requestOrSessionActor(request);
 if(refusesCrossSite(request,actor))return json({error:'forbidden'},403);
 try{
  const admitted=await getArtifactHeaderById(pageId);if(!admitted)throw Error('page_unavailable');
  // Readership first: a page this reader cannot read answers exactly as a missing one (the uniform 404), whatever
  // the body or Idempotency-Key; only then is the request itself judged.
  const head=await readHtmlPage(actor,pageId);
  const body=await readJson(request);
  if(!body||typeof body.revision!=='string'||(body.readOnly!==undefined&&typeof body.readOnly!=='boolean'))return json({error:'validation_failed',message:'send {sql, params?, revision}'},400,headers);
  const idempotencyKey=request.headers.get('idempotency-key')??undefined;
  if(idempotencyKey!==undefined&&!IDEMPOTENCY_KEY.test(idempotencyKey))return json({error:'invalid_idempotency_key'},400,headers);
  const page=body.revision===head.revision?head:await readHtmlPage(actor,pageId,body.revision);
  const scope={pageId,...(idempotencyKey?{idempotencyKey}:{}),readOnly:body.readOnly===true||page.revision!==head.revision,commitGuard:pageCommitGuard(pageId,actor,admitted)};
  const verifyPage=pageVerifier(request,pageId,actor,undefined,admitted);
  for(let attempt=1;;attempt++){
   try{
    const reply=await executePageSql(actor,datasetLinks(page),{sql:body.sql,params:body.params},scope,request.signal);
    // Every reply (rows, a write's reply, a replayed receipt, a refusal) leaves only while the page still holds.
    await verifyPage(page.revision);
    // The last guard: nothing past the SQL output budget leaves, however it was produced.
    const text=JSON.stringify(reply.body);
    if(new TextEncoder().encode(text).length>SQL_READ_LIMITS.outputBytes)return json({error:'result_too_large',message:`an answer is at most ${SQL_READ_LIMITS.outputBytes} bytes; select fewer rows or columns`},413,headers);
    return new Response(text,{status:reply.status,headers:{'content-type':'application/json',...headers}});
   }catch(error){
    if(attempt<RACED_READ_ATTEMPTS&&error instanceof Error&&error.message==='dataset_changed'&&!request.signal.aborted)continue;
    throw error;
   }
  }
 }catch{return json({error:'not_found'},404,headers);}
}
/** `reader`: an export capture's requester (opaqueOriginRead), read as given; otherwise the request's own credential. */
async function answer(request:Request,pageId:string,reader?:AccessActor):Promise<Response>{
 const requested=reader?null:await requestOrSessionActor(request);
 // An export reader carries no cookie, so no same-site guard applies; its writes were refused before it got here.
 if(requested&&refusesCrossSite(request,requested))return json({error:'forbidden'},403);
 const actor:AccessActor=reader??requested!;
 try{
  const admitted=await getArtifactHeaderById(pageId);if(!admitted)throw Error('page_unavailable');
  const verifyPage=pageVerifier(request,pageId,actor,reader,admitted);
  const readHeaders={'Cache-Control':'no-store',[REVALIDATE_ACTOR_HEADER]:'1'};
  if(request.method==='GET'){
   const revision=new URL(request.url).searchParams.get('revision')??undefined;
   const page=await readHtmlPage(actor,pageId,revision);
   const sdl=await operations(actor,page,{signal:request.signal}).schema(actor,pageId,page.revision);
   await verifyPage(page.revision);
   return json({sdl,revision:page.revision},200,readHeaders);
  }
  // Readership first: a page this reader cannot read answers exactly as a missing one (the uniform 404), whatever
  // the body or Idempotency-Key; only then is the request itself judged.
  const head=await readHtmlPage(actor,pageId);
  const body=await readJson(request);
  if(!body||typeof body.query!=='string'||typeof body.revision!=='string'||(body.operationName!==undefined&&typeof body.operationName!=='string')||(body.variables!==undefined&&(!body.variables||typeof body.variables!=='object'||Array.isArray(body.variables))))return json({error:'invalid_graphql_request'},400);
  // One Idempotency-Key per client mutation (@afbin/apollo): a generated-API write replays its receipt under it.
  const idempotencyKey=request.headers.get('idempotency-key')??undefined;
  if(idempotencyKey!==undefined&&!IDEMPOTENCY_KEY.test(idempotencyKey))return json({error:'invalid_idempotency_key'},400);
  const operationKind=pageOperationKind(body.query,typeof body.operationName==='string'?body.operationName:undefined);
  if(!operationKind||(body.operation!==undefined&&body.operation!==operationKind))return json({error:'invalid_graphql_operation'},400);
  // An export reader reads; never more (opaqueOriginRead refused its writes already).
  if(reader&&operationKind!=='query')return json({data:null,errors:[{message:DOMAIN_READ_ONLY_MESSAGE}]},403);
  if(operationKind==='mutation'&&head.revision!==body.revision)return json({error:'archived_page_readonly'},403);
  // The head just read is this revision when the request names it: one read of the page's source, not two.
  const page=body.revision===head.revision?head:await readHtmlPage(actor,pageId,body.revision);
  const operation:PageOperationRequest={pageId,revision:body.revision,query:body.query,...(body.variables?{variables:body.variables as HtmlJsonObject}:{}),...(typeof body.operationName==='string'?{operationName:body.operationName}:{})};
  const scope={signal:request.signal};
  if(operationKind==='mutation'){
   const written=await operations(actor,page,{...scope,...(idempotencyKey?{idempotencyKey}:{}),commitGuard:pageCommitGuard(pageId,actor,admitted)}).execute(actor,operation,request.signal);
   // A write's reply (fresh, replayed or refused) leaves only while the reader may still read the page.
   await verifyPage(page.revision);
   return json(written);
  }
  // A read's fences withhold its result when a linked dataset moved while it ran (another reader's write, say).
  // Reads have no effects, so a moved dataset re-runs the whole read on the new head, a bounded number of times.
  for(let attempt=1;;attempt++){
   const readFences:Array<()=>Promise<void>>=[];
   try{
    const result=await operations(actor,page,{...scope,retainReadFence:verify=>{readFences.push(verify);}}).execute(actor,operation,request.signal);
    for(const verify of readFences)await verify();
    await verifyPage(page.revision);
    return json(result,200,readHeaders);
   }catch(error){
    if(attempt<RACED_READ_ATTEMPTS&&error instanceof Error&&error.message==='dataset_changed'&&!request.signal.aborted)continue;
    throw error;
   }
  }
 }catch{return json({error:'page_operation_unavailable'},404);}
}

/**
 * A function call's revision: the header the reader's frame bridge pins it with (html-reader/frame-bridge/parent), or
 * the `revision` query parameter an unframed page sends (html-runtime/domain-reads: a header would need a preflight
 * an opaque origin cannot pass). Both absent: the head. Both present and different: refused. Never part of the input.
 */
const FUNCTION_REVISION_HEADER='x-page-revision',FUNCTION_REVISION_PARAM='revision';
function functionRevision(request:Request):string|null|Response{
 const header=request.headers.get(FUNCTION_REVISION_HEADER),param=new URL(request.url).searchParams.get(FUNCTION_REVISION_PARAM);
 if(header!==null&&param!==null&&header!==param)return json({error:'revision_conflict',message:'The revision header and revision differ'},400);
 return header??param;
}
/** A call's input: GET's query parameters (strings; a repeated name a list), or POST's JSON object body (empty: {}). */
async function functionInput(request:Request):Promise<HtmlJsonObject|Response>{
 if(request.method==='GET'){
  const input:Record<string,string|string[]>={};
  for(const [name,value] of new URL(request.url).searchParams){if(name===FUNCTION_REVISION_PARAM)continue;const had=input[name];input[name]=had===undefined?value:Array.isArray(had)?[...had,value]:[had,value];}
  return input;
 }
 let text:string;
 try{text=await readBody(request,{limit:FUNCTION_INPUT_BYTES,as:'text'});}catch(error){if(error instanceof PayloadTooLarge)return error.response();throw error;}
 if(!text.trim())return {};
 let input:unknown;try{input=JSON.parse(text);}catch{return json({error:'invalid_json',message:'The body is not JSON'},400);}
 return input&&typeof input==='object'&&!Array.isArray(input)?input as HtmlJsonObject:json({error:'input_not_object',message:'The body must be a JSON object'},400);
}
/** The page's backend links as functions: each pinned version's typeDefs and manifest. */
async function functionSources(page:HtmlPageVersion):Promise<PageFunctionSource[]>{
 return Promise.all(page.links.filter(link=>link.kind==='backend').map(async link=>{
  const backend=await getHtmlBackendVersion(link.backendId,link.version);
  if(!backend||backend.pageId!==page.pageId)throw Error('backend_link_mismatch');
  return {namespace:link.name,fileId:link.backendId,version:link.version,typeDefs:backend.typeDefs,functions:backend.functions??null};
 }));
}
/**
 * A PAGE FUNCTION CALL (`/api/artifacts/:id/fn/:name`, lib/page-operations `callPageFunction`): the caller is exactly
 * the GraphQL door's — the request's own credential, the same cross-site guard, `pageRole` for the role, the same
 * after-read verification — so a function sees the principal a resolver field sees. A reader who cannot read the
 * page gets the GraphQL door's uniform 404. An opaque origin (an unframed sandboxed copy) is read as nobody, every
 * credential dropped, reads only, with open CORS, as `opaqueOriginRead`.
 */
export async function pageFunction(request:Request,pageId:string,name:string):Promise<Response>{
 if(request.method!=='GET'&&request.method!=='POST')return json({error:'method_not_allowed'},405,{Allow:'GET, POST'});
 if(request.headers.get('origin')!=='null')return functionAnswer(request,pageId,name,false);
 const headers=new Headers(request.headers);
 for(const header of CREDENTIAL_HEADERS)headers.delete(header);
 const guest=new Request(request.url,{method:request.method,headers,...(request.method==='POST'?{body:await request.arrayBuffer()}:{}),signal:request.signal});
 const answered=await runWithRequest(guest,()=>functionAnswer(guest,pageId,name,true));
 const cors=new Headers(answered.headers);
 cors.set('access-control-allow-origin','*');cors.delete('access-control-allow-credentials');
 return new Response(answered.body,{status:answered.status,statusText:answered.statusText,headers:cors});
}
async function functionAnswer(request:Request,pageId:string,name:string,opaque:boolean):Promise<Response>{
 const actor=await requestOrSessionActor(request);
 if(refusesCrossSite(request,actor))return json({error:'forbidden'},403);
 const asked=functionRevision(request);
 if(asked instanceof Response)return asked;
 const input=await functionInput(request);
 if(input instanceof Response)return input;
 const headers={'Cache-Control':'no-store'};
 try{
  const admitted=await getArtifactHeaderById(pageId);if(!admitted)throw Error('page_unavailable');
  const head=await readHtmlPage(actor,pageId);
  const page=!asked||asked===head.revision?head:await readHtmlPage(actor,pageId,asked);
  const role=await pageRole(admitted,actor);
  if(!role)throw Error('forbidden');
  const answer=await callPageFunction({
   sources:await functionSources(page),name,method:request.method as 'GET'|'POST',input,
   caller:{pageId,subject:actor.userId,role},archived:page.revision!==head.revision,readOnly:opaque,
   invoke:createBackendInvoker(services().runner,getHtmlBackendVersion),signal:request.signal,
  });
  // A read's answer is withheld when the reader or the page moved while it ran, as a GraphQL read's is.
  if(answer.kind==='query')await pageVerifier(request,pageId,actor,undefined,admitted)(page.revision);
  return json(answer.body,answer.status,{...headers,...answer.headers});
 }catch{return json({error:'not_found'},404,headers);}
}
