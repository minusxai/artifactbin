/**
 * THE FUNCTION SCHEDULER, ticking every 15 s (`startFunctionSchedules`). Each tick: derive the scheduled functions
 * from the live page heads, claim the due ones under a lease, run each as the page's publisher (its current role, decided at run time) through the call path
 * that account's own POST takes, and record the outcome.
 * Every statement stands alone (no transaction of its own, so nothing here is ever queued inside another's
 * callback). Due times come from the `now` port (tests drive it); leases are database time (./claims).
 */
import {randomUUID} from 'node:crypto';
import {type HtmlBackendLink,type HtmlJson,type HtmlPageLink,type PageResolverFieldCall} from '@artifactbin/contracts';
import {identityForUser} from '@/lib/accounts';
import {getArtifactById} from '@/lib/artifacts';
import {pageRole} from '@/lib/dataset-permissions';
import {getHtmlBackendVersion} from '@/lib/html-backends';
import {callPageFunction,createBackendInvoker,describeScheduleInterval,pageHeadDigest} from '@/lib/page-operations';
import {getDb,services,type Db} from '@/lib/platform';
import {LEASE_MS} from './claims';

/** How often the process looks for due runs. A run starts at most this late. */
const SCHEDULER_TICK_MS=15_000;
/** Runs one process holds open at once; a due run beyond them waits for a later tick. */
const MAX_RUNNING=4;
/** Backoff: the n-th failure in a row waits interval × 2^(n-1), at most 32 intervals, and never more than a day unless the interval itself is longer. */
const BACKOFF_MAX_DOUBLINGS=5,BACKOFF_CAP_MS=24*60*60_000;
const TEXT_LIMIT=1000;

interface SchedulerPorts {
 db?:()=>Promise<Db>;
 /** The clock: every stored time and every due decision reads it (tests drive it). */
 now?:()=>number;
 /** The resolver invoker an owner's call uses (lib/page-operations `createBackendInvoker`). */
 invoke?:(call:PageResolverFieldCall)=>Promise<HtmlJson>;
 /** A pass or a record that failed (the database restarting): the next tick retries it. */
 onError?:(error:unknown)=>void;
}
interface Claim {page_id:string;link:string;function:string;every_ms:string|number;failures:number;claim_token:string;claim_epoch:string|number}
type Outcome={status:'ok'}|{status:'failed';error:string;message?:string|undefined;detail?:string|undefined}|{status:'released'};

/** Every schedule a live page head declares: `(page, link, function, every_ms)`. Trashed and deleted pages have none. */
const HEAD_SCHEDULES=`SELECT a.id AS page_id, e.el->>'name' AS link, s.key AS function, s.value::bigint AS every_ms
 FROM artifacts a
 CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(a.meta->'htmlLinks')='array' THEN a.meta->'htmlLinks' ELSE '[]'::jsonb END) AS e(el)
 JOIN html_backend_versions v ON v.backend_id=e.el->>'backendId' AND v.version=e.el->>'version' AND v.page_id=a.id
 CROSS JOIN LATERAL jsonb_each_text(v.function_schedules) AS s(key,value)
 WHERE a.deleted_at IS NULL AND a.format='html' AND e.el->>'kind'='backend' AND v.function_schedules IS NOT NULL
  AND a.id IN (SELECT h.page_id FROM html_backend_versions h WHERE h.function_schedules IS NOT NULL)`;

const bounded=(value:unknown)=>typeof value==='string'&&value?value.slice(0,TEXT_LIMIT):null;
function backoffMs(everyMs:number,failures:number):number{
 if(failures<=0)return everyMs;
 return Math.min(everyMs*2**Math.min(failures-1,BACKOFF_MAX_DOUBLINGS),Math.max(everyMs,BACKOFF_CAP_MS));
}

export function createFunctionScheduler(ports:SchedulerPorts={}){
 const db=ports.db??getDb,now=ports.now??Date.now;
 const invoke=ports.invoke??((call:PageResolverFieldCall)=>createBackendInvoker(services().runner,getHtmlBackendVersion)(call));
 const running=new Set<string>(),aborts=new Set<AbortController>();
 let stopped=false;

 /** The state rows follow the heads: new schedules are due at once, a changed interval counts from the last run, gone ones go (unless a run holds them; the next tick removes those). */
 async function sync(at:Date){
  const d=await db();
  await d.query(`INSERT INTO page_function_schedules(page_id,link,function,every_ms,next_run_at)
   SELECT page_id,link,function,every_ms,$1 FROM (${HEAD_SCHEDULES}) heads
   ON CONFLICT (page_id,link,function) DO UPDATE SET every_ms=EXCLUDED.every_ms,
    next_run_at=COALESCE(page_function_schedules.last_started_at+EXCLUDED.every_ms*interval '1 millisecond',$1)
   WHERE page_function_schedules.every_ms<>EXCLUDED.every_ms`,[at]);
  await d.query(`DELETE FROM page_function_schedules p WHERE (p.lease_until IS NULL OR p.lease_until<=now())
   AND NOT EXISTS (SELECT 1 FROM (${HEAD_SCHEDULES}) heads WHERE heads.page_id=p.page_id AND heads.link=p.link AND heads.function=p.function)`);
 }
 /**
  * Due rows no run holds, leased in one statement: a row another tick or process holds is skipped, never queued. The
  * lease is DATABASE time (now()), so no process clock decides who holds a run; each claim moves `claim_epoch`, the
  * fencing token every effect of the run checks (./claims). FAIR: due rows are taken round-robin by publisher (each
  * publisher's earliest first, then each one's second…), so one publisher's many schedules never starve another's.
  */
 async function claim(at:Date,limit:number):Promise<Claim[]>{
  if(limit<=0)return [];
  return (await (await db()).query<Claim>(`WITH due AS (
    SELECT p.page_id,p.link,p.function FROM page_function_schedules p JOIN artifacts a ON a.id=p.page_id
    WHERE p.next_run_at<=$1 AND (p.lease_until IS NULL OR p.lease_until<=now())
    ORDER BY row_number() OVER (PARTITION BY COALESCE(a.content_publisher_user_id,'') ORDER BY p.next_run_at,p.page_id,p.link,p.function),p.next_run_at,p.page_id
    LIMIT $3)
   UPDATE page_function_schedules p SET lease_until=now()+$2*interval '1 millisecond',claim_token=$4,claim_epoch=p.claim_epoch+1,last_started_at=$1
   FROM due WHERE p.page_id=due.page_id AND p.link=due.link AND p.function=due.function AND (p.lease_until IS NULL OR p.lease_until<=now())
   RETURNING p.page_id,p.link,p.function,p.every_ms,p.failures,p.claim_token,p.claim_epoch`,[at,LEASE_MS,limit,randomUUID()])).rows;
 }
 /** One run, decided again at run time: the head still schedules it, and its publisher is who runs it. */
 async function run(claim:Claim,signal:AbortSignal):Promise<Outcome>{
  const row=await getArtifactById(claim.page_id);
  if(!row||row.format!=='html')return {status:'released'};
  const link=((row.meta as {htmlLinks?:HtmlPageLink[]}).htmlLinks??[]).find((l):l is HtmlBackendLink=>l.kind==='backend'&&l.name===claim.link);
  const backend=link?await getHtmlBackendVersion(link.backendId,link.version):null;
  if(!link||!backend||backend.pageId!==row.id||!backend.schedule||!Object.hasOwn(backend.schedule,claim.function))return {status:'released'};
  // THE PUBLISHER: the account that published the head's content (`content_publisher_user_id`: creation, fork,
  // publication and revert stamp it; metadata, sharing and transfer edits keep it),
  // with the role it holds on the page NOW (personal owner, or owner/editor through a group or a named share). One rule
  // for personal and group pages: a personal owner's publish runs as that owner; a group page as its publishing
  // member; an editor's as that editor. One who no longer holds owner or editor (left the group, unshared, or the
  // page was transferred away from them) runs nothing until someone who does publishes the page again.
  // No other source names it: `actor_user_id` is the last writer of anything, metadata included, never the author.
  // Every scheduled function was published after this column existed, so an empty one fails closed until a
  // content publication stamps it.
  const publisher=row.content_publisher_user_id;
  const role=publisher?await pageRole(row,identityForUser(publisher)):null;
  if(!publisher||(role!=='owner'&&role!=='editor'))return {status:'failed',error:'publisher_unavailable',message:'A scheduled function runs as the account that published the page, and that account no longer owns or edits it: publish the page again'};
  // Only the declaring file's function: the schedule names it there, so another linked file's same name is not it.
  const answer=await callPageFunction({
   sources:[{namespace:link.name,fileId:link.backendId,version:link.version,typeDefs:backend.typeDefs,functions:backend.functions??null}],
   name:claim.function,method:'POST',input:{},caller:{pageId:row.id,subject:publisher,role},archived:false,readOnly:false,invoke,signal,
   // What every capability of the run re-decides (lib/page-operations admission): this head, this caller, this claim.
   admission:{page:row.id,head:pageHeadDigest(row),claim:{link:claim.link,token:claim.claim_token,epoch:Number(claim.claim_epoch)}},
  });
  if(answer.status===200)return {status:'ok'};
  const body=(answer.body??{}) as {error?:unknown;message?:unknown;detail?:unknown};
  return {status:'failed',error:bounded(body.error)??'function_failed',message:bounded(body.message)??undefined,detail:bounded(body.detail)??undefined};
 }
 async function record(claim:Claim,outcome:Outcome){
  const at=new Date(now()),every=Number(claim.every_ms),key=[claim.page_id,claim.link,claim.function,claim.claim_token,Number(claim.claim_epoch)];
  const d=await db();
  // Fenced: only the claim that is still current records (another process may have reclaimed an expired lease).
  const owned='page_id=$1 AND link=$2 AND function=$3 AND claim_token=$4 AND claim_epoch=$5';
  if(outcome.status==='released'){await d.query(`UPDATE page_function_schedules SET lease_until=NULL,claim_token=NULL WHERE ${owned}`,key);return;}
  if(outcome.status==='ok'){
   await d.query(`UPDATE page_function_schedules SET lease_until=NULL,claim_token=NULL,failures=0,last_finished_at=$6,last_status='ok',last_error=NULL,last_message=NULL,last_detail=NULL,next_run_at=$7 WHERE ${owned}`,[...key,at,new Date(at.getTime()+every)]);
   return;
  }
  const failures=claim.failures+1;
  await d.query(`UPDATE page_function_schedules SET lease_until=NULL,claim_token=NULL,failures=$6,last_finished_at=$7,last_status='failed',last_error=$8,last_message=$9,last_detail=$10,next_run_at=$11 WHERE ${owned}`,
   [...key,failures,at,outcome.error,outcome.message??null,outcome.detail??null,new Date(at.getTime()+backoffMs(every,failures))]);
 }
 async function runClaimed(claim:Claim){
  const id=`${claim.page_id}\u0000${claim.link}\u0000${claim.function}`;
  running.add(id);
  const abort=new AbortController();aborts.add(abort);
  let outcome:Outcome;
  try{outcome=await run(claim,abort.signal);}
  catch(error){outcome={status:'failed',error:'function_failed',message:bounded(error instanceof Error?error.message:String(error))??undefined};}
  finally{aborts.delete(abort);running.delete(id);}
  // Stopping (a shutdown) aborted it: not the function's failure. The schedule is released as it was, due again.
  if(abort.signal.aborted)outcome={status:'released'};
  // A record that fails leaves the lease to expire; the next claim runs it again.
  await record(claim,outcome).catch(error=>ports.onError?.(error));
 }
 /** One pass: sync, claim, run every claimed function and record it. Resolves when those runs are recorded; never throws. */
 async function tick():Promise<void>{
  if(stopped)return;
  try{
   const at=new Date(now());
   await sync(at);
   const claims=await claim(at,MAX_RUNNING-running.size);
   await Promise.all(claims.map(runClaimed));
  }catch(error){ports.onError?.(error);}
 }
 return {
  tick,
  /** Stop starting runs, abort the open ones and wait for them to be recorded. */
  async stop(pending?:Promise<void>|null){stopped=true;for(const abort of aborts)abort.abort();await pending;},
 };
}

/** The background worker: a tick every SCHEDULER_TICK_MS (unref'd), each pass skipped while the last one still runs. */
export function startFunctionSchedules(ports:SchedulerPorts={}):()=>Promise<void>{
 const scheduler=createFunctionScheduler(ports);
 let pending:Promise<void>|null=null;
 const beat=()=>{pending??=scheduler.tick().finally(()=>{pending=null;});};
 const timer=setInterval(beat,SCHEDULER_TICK_MS);timer.unref();
 return async()=>{clearInterval(timer);await scheduler.stop(pending);};
}

interface FunctionScheduleState {
 link:string;name:string;everyMs:number;every:string;nextRunAt:string;running:boolean;failures:number;
 lastRunAt:string|null;lastFinishedAt:string|null;lastStatus:'ok'|'failed'|null;lastError:string|null;lastMessage:string|null;lastDetail:string|null;
}
/**
 * A page's scheduled functions and their last outcomes, for its OWNER (the caller checks): `lastDetail` is the
 * owner-only failure detail an owner's call answers with.
 */
export async function functionSchedulesOf(pageId:string):Promise<FunctionScheduleState[]>{
 const rows=(await (await getDb()).query<{link:string;function:string;every_ms:string;next_run_at:Date;lease_until:Date|null;failures:number;last_started_at:Date|null;last_finished_at:Date|null;last_status:'ok'|'failed'|null;last_error:string|null;last_message:string|null;last_detail:string|null;running:boolean}>(
  'SELECT *,COALESCE(lease_until>now(),false) AS running FROM page_function_schedules WHERE page_id=$1 ORDER BY link,function',[pageId])).rows;
 const iso=(d:Date|null)=>d?new Date(d).toISOString():null;
 return rows.map(row=>({link:row.link,name:row.function,everyMs:Number(row.every_ms),every:describeScheduleInterval(Number(row.every_ms)),nextRunAt:iso(row.next_run_at)!,
  running:row.running,failures:row.failures,lastRunAt:iso(row.last_started_at),lastFinishedAt:iso(row.last_finished_at),
  lastStatus:row.last_status,lastError:row.last_error,lastMessage:row.last_message,lastDetail:row.last_detail}));
}
