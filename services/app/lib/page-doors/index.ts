/**
 * THE PAGE'S SQL DOOR (`POST /api/artifacts/<page>/sql`, `sql` in the page runtime), with what every page door
 * shares: the request's reader, the after-read page verification and the write's commit guard.
 */
import {pageEvidenceStep} from './deadline';
import {pageVerifier} from './verify';
import {ACTOR_HEADER,REVALIDATE_ACTOR_HEADER,SQL_READ_LIMITS,type HtmlDatasetLink,type HtmlPageVersion} from '@artifactbin/contracts';
import {sqlReadFailure,type SqlFailureCode} from '@artifactbin/contracts';
import { ANONYMOUS_ACTOR, type AccessActor } from '@/lib/accounts';
import { canReadArtifact, getArtifactHeaderById, accessMoved, type ArtifactRow } from '@/lib/artifacts';
import {readHtmlPage} from '@/lib/html-publication';
import {executePageSql,type PageCommitGuard} from '@/lib/dataset-access';
import {pageConnectionSql} from '@/lib/connections';
import {pageLiveDatasetSql} from '@/lib/live-datasets';
import {namingOwner,pageDeclaredConnectionSql} from './approved-queries';
import {transactionAccessFacts} from '@/lib/artifact-access';
import {DatasetError} from '@/lib/datasets';
import {runWithRequest,SQL_READ_WALL_TIMEOUT_MS} from '@/lib/platform';
import {readLifetime} from '@/lib/datasets';
import {exportKeyReader} from '@/lib/export';
import {json,readBody,readJson,PayloadTooLarge} from '@/lib/http';
import { requestOrSessionActor, refusesCrossSite } from '@/lib/authentication';
/** The page's dataset links. */
const datasetLinks=(page:HtmlPageVersion)=>page.links.filter((link):link is HtmlDatasetLink=>link.kind==='dataset');
/** How many times a read raced by a linked dataset's write runs before the request is refused. */
const RACED_READ_ATTEMPTS=3;
/** Today's receipt key shape (lib/artifacts `durableMutation`): a client Idempotency-Key is held to it. */
const IDEMPOTENCY_KEY=/^[A-Za-z0-9_-]{16,128}$/;
/** Every header a credential arrives in (the proxy's attached actor included); an opaque origin's read carries none. */
const CREDENTIAL_HEADERS=['cookie','authorization','proxy-authorization',ACTOR_HEADER];
type ArtifactHeader=NonNullable<Awaited<ReturnType<typeof getArtifactHeaderById>>>;
/**
 * A page write's commit guard (lib/dataset-access PageCommitGuard): inside the dataset write's transaction, the page
 * row is locked and read on `tx`, and the write commits only if the page is the head the request was admitted on
 * (same edit, version and sharing), it links exactly the datasets it linked then, and the reader may still read it,
 * decided from facts read on `tx` alone. Otherwise nothing commits: removing a link, republishing the page or
 * revoking the reader's access while the write runs refuses it.
 */
function pageCommitGuard(pageId:string,actor:AccessActor,admitted:ArtifactHeader):PageCommitGuard{
 return async tx=>{
  // LOCK ORDER (lib/artifact-access locks.ts): this guard runs inside the dataset write's commit,
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
 * reader, read or write. The same reader, cross-site guard and page audience for every page door: a page the reader
 * cannot read is the uniform 404. Only the head revision writes (an archived one, or `readOnly`, reads); a read
 * whose dataset moved while it ran re-runs, a bounded number of times, and leaves only if the page still holds.
 * An opaque origin reads here only as an export capture's requester (opaqueSqlRead); otherwise it has no SQL door.
 */
/** Admission is raced step by step, never across a dispatched mutation. */
function admission(request:Request){
 const started=performance.now(),life=readLifetime(request.signal,20000);
 let reading:ReturnType<typeof readLifetime>|undefined,dispatched=false;
 return {
  started,
  step:<T>(pending:Promise<T>)=>reading?reading.step(pending):dispatched?pending:life.step(pending),
  dispatch:(read:boolean)=>{if(!dispatched){life.check();life.close();dispatched=true;if(read)reading=readLifetime(request.signal,Math.max(1,Math.floor(started+SQL_READ_WALL_TIMEOUT_MS-performance.now())));}return reading?.signal??request.signal;},
  check:()=>reading?.check(),close:()=>{life.close();reading?.close();},
  /** Dispatched as a read: past admission, the statement's read itself is running. */
  reads:()=>!!reading,
 };
}
type Admission=ReturnType<typeof admission>;
export async function pageSqlDoor(request:Request,pageId:string):Promise<Response>{
 const admitted=admission(request);
 try{return await (request.headers.get('origin')==='null'?opaqueSqlRead(request,pageId,admitted):answerSql(request,pageId,admitted));}
 catch{return unreadable();}
 finally{admitted.close();}
}
const SQL_HEADERS={'Cache-Control':'no-store',[REVALIDATE_ACTOR_HEADER]:'1'};
/** A refusal the door itself answers (contracts sql-failures), with the reader's sentence. */
const refusal=(code:SqlFailureCode,message:string,headers:Record<string,string>=SQL_HEADERS)=>{const r=sqlReadFailure(code,message);return json(r.body,r.status,headers);};
/** The uniform answer for a page this reader cannot read (or a door that failed): exactly this body, nothing more. */
const unreadable=(headers:Record<string,string>=SQL_HEADERS)=>json({error:'not_found'},404,headers);
/**
 * AN EXPORT CAPTURE'S SQL READ: the exporter photographs the page as a top-level opaque-origin document with no app
 * frame (document-serving/raw), so its `sql` comes here directly (html-runtime/domain-reads), carrying the capture's
 * export key in the body. Every credential header is
 * dropped: the read runs as the requester the key was minted for (lib/export read-key), or as nobody for an anonymous
 * key, re-checked at read time like any reader's, and reads only. No key that verifies for this page: no SQL door.
 * The `*` CORS exposes the answer to that capture page alone: the key is seconds-long, scoped to this page and never
 * shown to a reader.
 */
async function opaqueSqlRead(request:Request,pageId:string,admission:Admission):Promise<Response>{
 const cors={'access-control-allow-origin':'*'};
 let body:string;
 try{body=await admission.step(readBody(request,{as:'text'}));}catch(error){if(error instanceof PayloadTooLarge)return error.response();throw error;}
 let key:unknown;try{key=(JSON.parse(body) as {key?:unknown}|null)?.key;}catch{/* refused below */}
 const reader=typeof key==='string'?exportKeyReader(pageId,key):null;
 if(!reader)return json({error:'permission_denied',message:'This page request is not permitted'},403,{...SQL_HEADERS,...cors});
 const headers=new Headers(request.headers);
 for(const name of [...CREDENTIAL_HEADERS,'idempotency-key'])headers.delete(name);
 const guest=new Request(request.url,{method:'POST',headers,body,signal:request.signal});
 const answered=await runWithRequest(guest,()=>answerSql(guest,pageId,admission,reader));
 const out=new Headers(answered.headers);
 out.set('access-control-allow-origin','*');out.delete('access-control-allow-credentials');
 return new Response(answered.body,{status:answered.status,statusText:answered.statusText,headers:out});
}
/**
 * Verified publishing-host entry only. The host supplies a current ownership/eligibility check, run before
 * admission and again after the canonical verifier. No body field or credential chooses the actor or write mode.
 * This is separate from pageSqlDoor: canonical opaque requests still require an export capture key.
 */
export async function ownerHostSqlRead(request:Request,pageId:string,hostHolds:()=>Promise<boolean>):Promise<Response>{
 const admitted=admission(request);
 try{
 if(!await admitted.step(hostHolds()))return unreadable();
 const headers=new Headers(request.headers);
 for(const name of [...CREDENTIAL_HEADERS,'idempotency-key'])headers.delete(name);
 const guest=new Request(request.url,{method:'POST',headers,body:await admitted.step(readBody(request)),signal:request.signal});
 const answered=await runWithRequest(guest,()=>answerSql(guest,pageId,admitted,ANONYMOUS_ACTOR,hostHolds));
 const out=new Headers(answered.headers);
 out.set('access-control-allow-origin','*');out.delete('access-control-allow-credentials');
 return new Response(answered.body,{status:answered.status,statusText:answered.statusText,headers:out});
 }catch{return unreadable();}finally{admitted.close();}
}
/** `reader`: a host-selected anonymous reader or capture requester, always read-only; otherwise the request's own. */
async function answerSql(request:Request,pageId:string,admission:Admission,reader?:AccessActor,hostHolds?:()=>Promise<boolean>):Promise<Response>{
 const readStartedAt=admission.started;
 // A dispatched read of a page this reader may read that ran out of time, or kept racing a write, says so. Anything
 // else (admission, a write, the page's or host's own checks after the read) keeps the uniform answer.
 let readable=false,executing=false;
 let readDeadline:number|undefined;
 let readSignal:AbortSignal|undefined;
 const checkRead=()=>{if(readDeadline!==undefined){request.signal.throwIfAborted();if(performance.now()>=readDeadline)throw Error('sql_deadline');}};
 const headers=SQL_HEADERS;
 const requested=reader?null:await admission.step(requestOrSessionActor(request));
 // An export reader carries no cookie, so no same-site guard applies; it never writes (readOnly below).
 if(requested&&refusesCrossSite(request,requested))return json({error:'forbidden'},403);
 const actor:AccessActor=reader??requested!;
 try{
  if(hostHolds&&!await admission.step(hostHolds()))throw Error('page_unavailable');
  const admitted=await admission.step(getArtifactHeaderById(pageId));if(!admitted)throw Error('page_unavailable');
  // Readership first: a page this reader cannot read answers exactly as a missing one (the uniform 404), whatever
  // the body or Idempotency-Key; only then is the request itself judged.
  const head=await admission.step(readHtmlPage(actor,pageId));
  readable=true;
  const body=await admission.step(readJson(request));
  if(!body||typeof body.revision!=='string'||(body.readOnly!==undefined&&typeof body.readOnly!=='boolean'))return json({error:'validation_failed',message:'send {sql, params?, revision}'},400,headers);
  const idempotencyKey=request.headers.get('idempotency-key')??undefined;
  if(idempotencyKey!==undefined&&!IDEMPOTENCY_KEY.test(idempotencyKey))return json({error:'invalid_idempotency_key'},400,headers);
  const page=body.revision===head.revision?head:await admission.step(readHtmlPage(actor,pageId,body.revision));
  const scope={admission,pageId,readStartedAt,retainReadDeadline:(deadline:number)=>{readDeadline=deadline;readSignal=AbortSignal.any([request.signal,AbortSignal.timeout(Math.max(0,Math.floor(deadline-performance.now())))]);},...(idempotencyKey?{idempotencyKey}:{}),readOnly:!!reader||body.readOnly===true||page.revision!==head.revision,commitGuard:pageCommitGuard(pageId,actor,admitted)};
  const verifyPage=pageVerifier(request,pageId,actor,reader,admitted);
  for(let attempt=1;;attempt++){
   try{
    // A declared query, or a statement naming a live dataset link, runs on that dataset's connection (lib/live-datasets);
    // one naming a default-connection link wholly on the install's connection (lib/connections).
    executing=true;
    // A declared query on a default-connection link runs as the reader, or as the page's group where an approval holds
    // (./approved-queries); a refusal of this reader on the default connection names whom to ask.
    const live=await pageLiveDatasetSql(actor,page,{sql:body.sql,params:body.params,query:body.query},request.signal,admission);
    const connection=live?null:await pageDeclaredConnectionSql(actor,page,head,{query:body.query,params:body.params},request.signal,admission)??await pageConnectionSql(actor,page.links,{sql:body.sql,params:body.params},request.signal,admission);
    const reply=live??(connection?await admission.step(namingOwner(connection,admitted)):await executePageSql(actor,datasetLinks(page),{sql:body.sql,params:body.params},scope,request.signal));
    // Every reply (rows, a write's reply, a replayed receipt, a refusal) leaves only while the page still holds.
    admission.check();checkRead();executing=false;
    await admission.step(readSignal?pageEvidenceStep(readSignal,verifyPage(page.revision)):verifyPage(page.revision));
    if(hostHolds&&!await admission.step(readSignal?pageEvidenceStep(readSignal,hostHolds()):hostHolds()))throw Error('page_unavailable');
    // The last guard: nothing past the SQL output budget leaves, however it was produced.
    const text=JSON.stringify(reply.body);
    if(new TextEncoder().encode(text).length>SQL_READ_LIMITS.outputBytes)return json({error:'result_too_large',message:`an answer is at most ${SQL_READ_LIMITS.outputBytes} bytes; select fewer rows or columns`},413,headers);
    admission.check();checkRead();
    return new Response(text,{status:reply.status,headers:{'content-type':'application/json',...headers}});
   }catch(error){
    if(attempt<RACED_READ_ATTEMPTS&&error instanceof Error&&error.message==='dataset_changed'&&!request.signal.aborted)continue;
    throw error;
   }
  }
 }catch(error){
  const reason=error instanceof Error?error.message:'';
  const read=readable&&executing&&admission.reads()&&!request.signal.aborted;
  if(read&&reason==='sql_deadline')return refusal('timeout',`a read runs at most ${SQL_READ_WALL_TIMEOUT_MS} ms`,headers);
  if(read&&reason==='dataset_changed')return refusal('dataset_changed','the linked data kept changing while it was read; read it again',headers);
  return unreadable(headers);
 }
}

export {preparePageEvidence,pageEvidenceSchemaDoor} from './evidence';

export {pageEvidenceStep} from './deadline';
