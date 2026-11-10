/**
 * THE PAGE'S PLAIN-HTTP DOORS: its SQL door (`POST /api/artifacts/<page>/sql`, `sql` in the page runtime) and its
 * functions (`/api/artifacts/:id/fn/:name`, `fetch('/fn/<name>')`), with what every page door shares: the request's
 * reader, the after-read page verification and the write's commit guard. The GraphQL compatibility layer
 * (lib/graphql-compat) admits its requests through the same verifier and guard.
 */
import {getHtmlBackendVersion} from '@/lib/html-backends';
import {ACTOR_HEADER,REVALIDATE_ACTOR_HEADER,SQL_READ_LIMITS,type HtmlDatasetLink,type HtmlJsonObject,type HtmlPageLink,type HtmlPageVersion} from '@artifactbin/contracts';
import { identityForUser, type AccessActor } from '@/lib/accounts';
import { canReadArtifact, getArtifactById, getArtifactHeaderById, accessMoved, readableArtifactHeader, type ArtifactRow } from '@/lib/artifacts';
import { pageRole } from '@/lib/dataset-permissions';
import {readHtmlPage} from '@/lib/html-publication';
import {createBackendInvoker,createResolverSql,callPageFunction,FUNCTION_INPUT_BYTES,pageHeadDigest,resolverFieldRefusal,ResolverQueryError,type AdmissionCheck,type PageFunctionSource,type ResolverAdmit} from '@/lib/page-operations';
import {renewScheduleClaim,scheduleClaimHolds} from '@/lib/function-schedules';
import {executePageSql,planLinkedDatasetTables,type PageCommitGuard} from '@/lib/dataset-access';
import {transactionAccessFacts} from '@/lib/artifact-access';
import {DatasetError} from '@/lib/datasets';
import {runWithRequest,services} from '@/lib/platform';
import {json,readBody,readJson,PayloadTooLarge} from '@/lib/http';
import { requestOrSessionActor, refusesCrossSite } from '@/lib/authentication';
/** The page's dataset links. */
export const datasetLinks=(page:HtmlPageVersion)=>page.links.filter((link):link is HtmlDatasetLink=>link.kind==='dataset');
/** How many times a read raced by a linked dataset's write runs before the request is refused. */
export const RACED_READ_ATTEMPTS=3;
/** The datasets the page head links now, live and pinned. */
export const headDatasetLinks=async(pageId:string)=>{const row=await getArtifactById(pageId);return !row||row.format!=='html'?[]:((row.meta as {htmlLinks?:HtmlPageLink[]}).htmlLinks??[]).filter((link):link is HtmlDatasetLink=>link.kind==='dataset');};
/**
 * A resolver's caps.sql: the datasets the page head links, as the caller the run was admitted for. Reads are SQL
 * tables on the SQL service's read door; a write (a POST call's or a scheduled run's) is the page SQL door's own
 * guarded write over the head's links. A page function call's write commits only while, decided inside the commit
 * from locked rows, the head is still the one the call was admitted on, the caller may still run the function and a
 * scheduled run's claim is still current (`admittedCommitGuard`); a legacy resolver's, while the head and the
 * caller's access still hold (`pageCommitGuard`).
 */
const resolverSql=createResolverSql({links:headDatasetLinks,plan:planLinkedDatasetTables,run:input=>services().sql.run(input),
 write:async({actor,pageId,sql,params,admission},signal)=>{
  const admitted=await getArtifactHeaderById(pageId);
  if(!admitted||admitted.format!=='html')return {status:404,body:{error:'dataset_not_found',message:'The page is unavailable; nothing was written.'}};
  const links=((admitted.meta as {htmlLinks?:HtmlPageLink[]}).htmlLinks??[]).filter((link):link is HtmlDatasetLink=>link.kind==='dataset');
  return executePageSql(actor,links,{sql,params},{pageId,commitGuard:admission?admittedCommitGuard(admission,actor):pageCommitGuard(pageId,actor,admitted)},signal);
 }});
const PAGE_CHANGED='The page was published again (or removed) since this call began';
const CALLER_UNAVAILABLE='The caller may no longer run this function';
const CLAIM_LOST='Another run holds this schedule now';
const PUBLISHER_UNAVAILABLE='This scheduled run\'s account no longer publishes this page or no longer owns or edits it';
/**
 * Whether the caller may still run the function, from its role on the page NOW (never the role recorded at
 * admission). A reader's call needs only the function's `roles`. A SCHEDULED run (an admission with a claim) acts
 * with nobody asking, so it must also still be the head's content publisher and hold owner or editor: a publisher
 * unshared from the page stops even a function whose `roles` would admit anyone.
 */
function callerRefusal(row:Pick<ArtifactRow,'content_publisher_user_id'>,caller:{subject:string|null},role:string|null,admission:AdmissionCheck['admission'],rule:AdmissionCheck['rule']):'caller_unavailable'|'publisher_unavailable'|null{
 if(admission.claim&&(!caller.subject||row.content_publisher_user_id!==caller.subject||(role!=='owner'&&role!=='editor')))return 'publisher_unavailable';
 return !role||resolverFieldRefusal(role as Parameters<typeof resolverFieldRefusal>[0],rule)?'caller_unavailable':null;
}
/**
 * A PAGE FUNCTION CALL'S ADMISSION, before each capability it reaches (lib/page-operations admission): the page head
 * is still the one it was admitted on, the caller's role on the page now still satisfies the function's `roles`
 * (or `@auth`), and a scheduled run still holds its claim (renewed here). Any lost, and the call reaches nothing more.
 */
const resolverAdmit:ResolverAdmit=async({admission,caller,rule})=>{
 const row=await getArtifactById(admission.page);
 if(!row||row.format!=='html'||pageHeadDigest(row)!==admission.head)throw new ResolverQueryError('page_changed',PAGE_CHANGED);
 const role=await pageRole(row,identityForUser(caller.subject));
 const refused=callerRefusal(row,caller,role,admission,rule);
 if(refused)throw new ResolverQueryError(refused,refused==='publisher_unavailable'?PUBLISHER_UNAVAILABLE:CALLER_UNAVAILABLE);
 if(admission.claim&&!await renewScheduleClaim(admission.page,admission.function,admission.claim))throw new ResolverQueryError('claim_lost',CLAIM_LOST);
};
/**
 * The same three, decided INSIDE a write's commit (lib/dataset-access PageCommitGuard), after the commit locked the
 * page and its datasets in the one global order (lib/artifact-access README "Lock order"): the page row FOR SHARE,
 * the caller's role from facts locked as they are read (`transactionAccessFacts`), and the schedule row last, FOR
 * SHARE, so a revocation, a republish or a reclaim either committed first and refuses the write, or waits for it.
 * lib/graphql-compat guards a page function call's caps.query mutation with it too.
 */
export function admittedCommitGuard({admission,rule}:AdmissionCheck,actor:AccessActor):PageCommitGuard{
 return async tx=>{
  const current=(await tx.query<ArtifactRow>('SELECT * FROM artifacts WHERE id=$1 AND deleted_at IS NULL FOR SHARE',[admission.page])).rows[0];
  if(!current||current.format!=='html'||pageHeadDigest(current)!==admission.head)throw new DatasetError(`${PAGE_CHANGED}; nothing was written.`,409);
  const role=await pageRole(current,actor,{facts:transactionAccessFacts(actor,tx)});
  const refused=callerRefusal(current,{subject:actor.userId},role,admission,rule);
  if(refused)throw new DatasetError(`${refused==='publisher_unavailable'?PUBLISHER_UNAVAILABLE:CALLER_UNAVAILABLE}; nothing was written.`,403);
  if(admission.claim&&!await scheduleClaimHolds(tx,admission.page,admission.function,admission.claim))throw new DatasetError(`${CLAIM_LOST}; nothing was written.`,409);
 };
}
/** The page-side resolver capabilities every runner composition hands the runner (caps.sql and the admission check). */
export const resolverPorts={sql:resolverSql,admit:resolverAdmit};
/** Today's receipt key shape (lib/artifacts `durableMutation`): a client Idempotency-Key is held to it. */
export const IDEMPOTENCY_KEY=/^[A-Za-z0-9_-]{16,128}$/;
/** Every header a credential arrives in (the proxy's attached actor included); an opaque origin's read carries none. */
export const CREDENTIAL_HEADERS=['cookie','authorization','proxy-authorization',ACTOR_HEADER];
export type ArtifactHeader=NonNullable<Awaited<ReturnType<typeof getArtifactHeaderById>>>;
/**
 * After a read: the reader is still who they were, may still read the page, and its head (access, edit, version,
 * links) did not move since `admitted`; otherwise the answer is withheld (`page_unavailable`).
 */
export function pageVerifier(request:Request,pageId:string,actor:AccessActor,reader:AccessActor|undefined,admitted:ArtifactHeader){
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
 * A page write's commit guard (lib/dataset-access PageCommitGuard): inside the dataset write's transaction, the page
 * row is locked and read on `tx`, and the write commits only if the page is the head the request was admitted on
 * (same edit, version and sharing), it links exactly the datasets it linked then, and the reader may still read it,
 * decided from facts read on `tx` alone. Otherwise nothing commits: removing a link, republishing the page or
 * revoking the reader's access while the write runs refuses it.
 */
export function pageCommitGuard(pageId:string,actor:AccessActor,admitted:ArtifactHeader):PageCommitGuard{
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
 * THE PAGE SQL DOOR (POST /api/artifacts/<page>/sql, lib/dataset-access `executePageSql`): `{sql, params?, revision,
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
   // The head this call is admitted on: every capability it reaches re-decides it, and this reader's eligibility.
   admission:{page:pageId,head:pageHeadDigest(admitted)},
  });
  // A read's answer is withheld when the reader or the page moved while it ran, as a GraphQL read's is.
  if(answer.kind==='query')await pageVerifier(request,pageId,actor,undefined,admitted)(page.revision);
  return json(answer.body,answer.status,{...headers,...answer.headers});
 }catch{return json({error:'not_found'},404,headers);}
}
