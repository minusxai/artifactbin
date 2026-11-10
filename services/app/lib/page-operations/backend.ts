import { transform } from 'esbuild';
import { randomUUID } from 'node:crypto';
import { DATASET_ROLES, isResolverDatabaseKind, RESOLVER_DATABASE_CHECK_OPERATION, RESOLVER_DATABASE_OPERATION, runnerAdmissionOf, RESOLVER_LIMITS, type DatasetRole, type HtmlJson, type PageResolverFieldCall, type ResolverSecretHosts, type RunnerService, type RunStart, type RunnerJson, type RunSnapshot } from '@artifactbin/contracts';
import { functionScheduleMinimumMinutes, services } from '@/lib/platform';
import { boundedBackendSchema, resolverTestField } from './execution-policy';
import { functionManifest, type FunctionRoles } from './functions';
import { staticSurface } from './function-source';
import { FUNCTION_SCHEDULE_MIN_MINUTES, scheduleManifest } from './schedule';
import { functionRule } from './functions';
import type { AdmissionCheck, ResolverAdmit } from './admission';
import {readPinnedBackendSecret,secretHostMap} from '@/lib/html-backend-secrets';
import {redactedLine,resolverFailureDetail} from './redaction';
import { FieldFailed, FieldNotExecuted } from './contracts';
import type { ResolverFetcher } from './public-fetch';
import type { ResolverQuery } from './query';
import type { ResolverSql } from './sql';
import {connectionPassword,resolverDatabaseConnection} from './database';
/** The page's datasets for resolver code, as the caller: `caps.query` (GraphQL) and `caps.sql` (SQL; ./sql). */
export interface ResolverDatasets {query?:ResolverQuery;sql?:ResolverSql;
 /** Re-decides a page function call's admission before each capability (./admission); a call that carries one is refused without it. */
 admit?:ResolverAdmit}
/** `secretBindings` lists every declared secret name; `secretHosts` binds each to its one host. */
/**
 * `typeDefs` is '' for a typeDefs-free file, whose callable functions and their roles are `functions` (./functions);
 * null for a legacy file. `schedule` is such a file's `{name: intervalMs}` (./schedule), null or absent without one.
 */
export interface CompiledPageBackend {typeDefs:string;functions?:FunctionRoles|null;schedule?:Readonly<Record<string,number>>|null;compiled:string;secretBindings?:string[];secretHosts?:ResolverSecretHosts;test?:boolean}
export interface PageBackendRecord extends CompiledPageBackend {backendId:string;version:string;source:string;ownerId:string;pageId:string}
const limits={timeoutMs:RESOLVER_LIMITS.wallMs,cpuMs:200,memoryMiB:64,maxRequests:RESOLVER_LIMITS.maxRequests,maxOutputBytes:RESOLVER_LIMITS.outputBytes};
/**
 * How a run's reason marks a message the resolver code itself threw (an Error it made, not one a capability
 * raised or the runner reported): the invoker shows its redacted first line to every caller.
 */
export const RESOLVER_THREW='resolver_error: ';
/**
 * `caps` is `fetch` (with host-filled `{{NAME}}` placeholders), `query` (the page's datasets as the caller, GraphQL),
 * `sql` (the same as SQL: also the page runtime's tag, `` caps.sql`… ${v}` `` binding each value as `$p0`, `$p1`…;
 * it writes only in a call that may write, ./sql) and `db` (a named owner database connection, Postgres or MySQL, through the runner's
 * tunnel), nothing else.
 */
const CAPS=`Object.freeze({fetch:G(async(url,init)=>{const o=init??{};const r=await host.artifactbin.call('pageBackend.fetch',{url,method:o.method,headers:o.headers,body:o.body,auth:o.auth});return Object.freeze({ok:r.status>=200&&r.status<300,status:r.status,url:r.url,headers:Object.freeze({...r.headers}),text:G(async()=>r.body),json:G(async()=>JSON.parse(r.body))});}),query:G((query,variables)=>C('pageBackend.query',{query,variables:variables??null})),sql:G((sql,...rest)=>C('pageBackend.sql',Array.isArray(sql)&&Array.isArray(sql.raw)?T(sql,rest):typeof sql==='string'?{sql,params:rest[0]??null}:sql)),db:G(async(name)=>{const id=await D(()=>host.db.open(name));return Object.freeze({query:G((sql,params)=>D(()=>host.db.query(id,sql,params??null))),end:G(()=>D(()=>host.db.end(id)))});})})`;
/** A host call whose refusal (code: detail) reaches resolver code as an Error carrying that code. */
const CALL=`const T=(strings,values)=>{const params={};let sql=strings[0]??'';values.forEach((v,i)=>{if(v instanceof Date&&!Number.isNaN(v.getTime()))v=v.toISOString();else if(!(v===null||typeof v==='string'||typeof v==='boolean'||typeof v==='number'&&Number.isFinite(v)))throw new TypeError('sql value '+i+' must be a string, finite number, boolean, null or Date');params['p'+i]=v;sql+='$p'+i+(strings[i+1]??'');});return {sql,params};};const D=async(f)=>{try{return await f();}catch(e){const m=String(e&&e.message||e),i=m.indexOf(': ');const error=Error(i>0?m.slice(i+2):m);error.code=i>0?m.slice(0,i):m;throw error;}};const C=(operation,args)=>D(()=>host.artifactbin.call(operation,args));`;
/** The runner compiler's fixed import allowlist is authoritative. No host evaluation. */
async function backendProgram(source:string):Promise<string>{
 if(Buffer.byteLength(source)>262144)throw new FieldNotExecuted('Source exceeds budget','source_limit');
 const transformed=await transform(source,{loader:'ts',format:'cjs',target:'es2022'});
 // G marks every error a capability raises, so only the resolver's own throws carry RESOLVER_THREW.
 return `const __afPlatform=new WeakSet();const G=(f)=>async(...a)=>{try{return await f(...a);}catch(e){if(e!==null&&typeof e==='object')__afPlatform.add(e);throw e;}};
const Backend=(()=>{const module={exports:{}};const exports=module.exports;${transformed.code};return module.exports})();
export default async function(input,host){
 if(input.kind==='schema'){const t=Backend.typeDefs;if(t!==undefined&&typeof t!=='string'||typeof t==='string'&&(!Backend.default||typeof Backend.default!=='object'))throw Error('invalid_backend_exports');return {typeDefs:t??null,secrets:Backend.secrets};}
 // Only a name the host admitted from the static surface (./function-source) or the SDL arrives here; it runs only if it is a function.
 const own=(o,k)=>o!==null&&typeof o==='object'&&Object.prototype.hasOwnProperty.call(o,k);
 const fn=own(Backend.default,input.field)?Backend.default[input.field]:typeof Backend.typeDefs!=='string'&&!['default','roles','secrets','typeDefs'].includes(input.field)&&own(Backend,input.field)?Backend[input.field]:undefined;if(typeof fn!=='function')return {missing:true};
 const principal=Object.freeze(input.principal);
 ${CALL}
 const caps=${CAPS};
 // The reply is an envelope the wrapper alone builds: {missing:true} means nothing ran; a result is always {value}.
 try{return {value:await fn(input.args,principal,caps)};}catch(e){
  if(e!==null&&typeof e==='object'&&!__afPlatform.has(e)&&typeof e.message==='string'&&e.message)throw Error(${JSON.stringify(RESOLVER_THREW)}+e.message);
  // An uncaught capability refusal keeps its code (\`tls_untrusted_certificate: …\`), so the owner's failure detail names it.
  if(e!==null&&typeof e==='object'&&typeof e.code==='string'&&e.code&&typeof e.message==='string'&&e.message!==e.code&&!e.message.startsWith(e.code+': '))throw Error(e.code+': '+e.message);
  throw e;
 }
 }`;
}
/** Runner replies that prove the run was not admitted and may be on a later try (queue full, restarting, start threw before admission). */
const BUSY=new Set(['queue_full','runner_closed','runner_unavailable','runner_failed']);
/** Start errors with no runner reply (timeout, network, unreadable body): the run may or may not have been admitted. */
const transientStart=(code:string)=>!/^[a-z][a-z_]{0,63}$/.test(code);
/** How the runner client's 30 s start timeout surfaces (node:http aborts with AbortError; fetch with TimeoutError). */
const START_TIMEOUTS=new Set(['AbortError','TimeoutError','UpstreamTimeoutError']);
/** Backoff after fast start failures only (at most about 2.1 s in total); jittered so concurrent page reads do not retry in lockstep. */
const START_RETRY_DELAYS_MS=[200,500,1000];
const pause=(ms:number,signal?:AbortSignal)=>new Promise<void>(resolve=>{const timer=setTimeout(done,ms);function done(){clearTimeout(timer);signal?.removeEventListener('abort',done);resolve();}signal?.addEventListener('abort',done,{once:true});});
/** The promise's value, or undefined as soon as the signal aborts (its later outcome is dropped). */
const untilAborted=<T,>(promise:Promise<T>,signal?:AbortSignal):Promise<T|undefined>=>{
 if(!signal)return promise;
 if(signal.aborted){promise.catch(()=>{});return Promise.resolve(undefined);}
 return new Promise<T|undefined>((resolve,reject)=>{const stop=()=>resolve(undefined);signal.addEventListener('abort',stop,{once:true});promise.then(resolve,reject).finally(()=>signal.removeEventListener('abort',stop));});
};
/**
 * Starts a run, retrying transient admission failures. Every attempt reuses the same requestId, and
 * the runner admits a requestId at most once, so a retry after a lost reply resumes the admitted run.
 */
async function admit(runner:RunnerService,request:RunStart,signal:AbortSignal|undefined,delays:readonly number[]):Promise<string>{
 let code='',attempt=0;const began=Date.now();
 for(;;attempt++){
  if(signal?.aborted)throw new FieldNotExecuted('Cancelled','cancelled');
  try{return (await runner.start(request)).runId;}
  catch(error){code=error instanceof Error&&error.name!=='Error'?error.name:error instanceof Error?error.message:'';}
  // A start that waited out the client timeout already spent the call's budget, and may have been admitted: final.
  if(START_TIMEOUTS.has(code))throw new FieldFailed('backend_unavailable','runner start timed out');
  if(!(BUSY.has(code)||transientStart(code))){throw new FieldNotExecuted('Runner refused admission','backend_rejected',code);}
  // Only fast failures retry: a retry that would start after 3 s is not made.
  if(attempt>=delays.length)break;
  const delay=delays[attempt]!*(0.75+Math.random()*0.5);
  if(Date.now()-began+delay>3000)break;
  await pause(delay,signal);
 }
 if(signal?.aborted)throw new FieldNotExecuted('Cancelled','cancelled');
 const tries=attempt+1;
 // A definite refusal never ran; a lost reply may have been admitted, so its outcome is unknown.
 if(BUSY.has(code))throw new FieldNotExecuted('Runner refused admission','retryable',`${code} after ${tries} attempts`);
 throw new FieldFailed('backend_unavailable',`runner start failed after ${tries} attempts`);
}
/** A terminal non-completed run; `receipt` carries the runner's (unredacted-for-encodings) reason and requests. */
class RunFailed extends FieldFailed {readonly receipt:RunSnapshot['receipt'];constructor(receipt:RunSnapshot['receipt']|undefined){super('backend_failed');this.receipt=receipt??null;}}
async function run(runner:RunnerService,request:RunStart,signal?:AbortSignal,delays:readonly number[]=START_RETRY_DELAYS_MS):Promise<RunnerJson>{
 const runId=await admit(runner,request,signal,delays);
 const lookup={runId,userId:request.userId};
 const deadline=Date.now()+RESOLVER_LIMITS.appWaitMs;
 while(true){
  if(signal?.aborted||Date.now()>=deadline){await runner.cancel(lookup).catch(()=>{});throw new FieldFailed('deadline');}
  // One completion wait per round trip instead of polling; it never outlasts the call's deadline.
  const waitMs=Math.min(deadline-Date.now(),RESOLVER_LIMITS.runWaitMs),asked=Date.now();
  let snapshot;try{snapshot=await untilAborted(runner.getRun({...lookup,waitMs}),signal);}catch{throw new FieldFailed('backend_unavailable');}
  if(!snapshot)continue;
  if(snapshot.status==='completed')return snapshot.output;
  // The reason stays raw here: the invoker redacts it against the pinned secrets before it becomes a detail.
  if(!['queued','running'].includes(snapshot.status))throw new RunFailed(snapshot.receipt);
  // Back early and still running: a runner that does not hold the wait. Poll it gently.
  if(Date.now()-asked<waitMs)await pause(10,signal);
 }
}
export function createBackendCompiler(runner:RunnerService){return async(source:string,signal?:AbortSignal):Promise<CompiledPageBackend>=>{
 const compiled=await backendProgram(source);
 // The callable names and their roles come from the source text, read before anything runs and never from the
 // evaluated module (./function-source).
 const surface=await staticSurface(source);
 const result=await run(runner,{requestId:randomUUID(),userId:'page-backend-compiler',artifactId:'page-backend-compiler',artifactVersion:'compile',document:{source:compiled,editId:'compile'},program:{source:compiled,language:'javascript'},input:{kind:'schema'},limits},signal);
 if(!result||typeof result!=='object'||Array.isArray(result))throw Error('invalid_backend_exports');
 const secretHosts=secretHostMap(result.secrets);
 const secrets={secretBindings:Object.keys(secretHosts),secretHosts};
 if(typeof result.typeDefs==='string'){
  if(surface.roles)throw Error('A backend with typeDefs guards fields with @auth; export roles only from a backend without typeDefs');
  if(surface.schedule)throw Error('invalid_schedule: only a backend without typeDefs schedules its functions');
  return {compiled,typeDefs:result.typeDefs,functions:null,...secrets,test:resolverTestField(boundedBackendSchema(result.typeDefs))};
 }
 if(surface.typeDefs)throw Error('invalid_backend_exports: typeDefs must be a string');
 const functions=functionManifest(surface.functions,surface.roles);
 // Test connection: an owner-only `test` function, as a legacy file's `test: String! @auth(role: owner)`.
 if(Object.hasOwn(functions,'test')&&functions.test!=='owner')throw Error("invalid_test_field: give test the owner role (roles = {test: 'owner'})");
 const schedule=scheduleManifest(surface.schedule,surface.functions,(functionScheduleMinimumMinutes()??FUNCTION_SCHEDULE_MIN_MINUTES)*60_000);
 return {compiled,typeDefs:'',functions,...(schedule?{schedule}:{}),...secrets,test:Object.hasOwn(functions,'test')};
};}
export function compilePageBackend(source:string,signal?:AbortSignal):Promise<CompiledPageBackend>{return createBackendCompiler(services().runner)(source,signal);}
/** Every pinned secret value that can still be read, and each connection's password; a missing or transferred one cannot be in the reason. */
async function pinnedValues(backend:PageBackendRecord,read:(backend:PageBackendRecord,name:string)=>Promise<string>):Promise<string[]>{
 const values=await Promise.all((backend.secretBindings??[]).map(name=>read(backend,name).then(value=>isResolverDatabaseKind(backend.secretHosts?.[name])?[value,connectionPassword(value)??'']:[value],()=>[])));
 return values.flat().filter(Boolean);
}
/**
 * A failed run surfaces as `backend_failed`; its `detail` (shown to the page owner only, by the executor) is the
 * runner's reason made safe by `resolverFailureDetail`, redacted of the pinned secret values. A message the
 * resolver itself threw (RESOLVER_THREW) is also `shown`, after the same redaction, to every caller.
 */
export function createBackendInvoker(runner:RunnerService,load:(fileId:string,version:string)=>Promise<PageBackendRecord|null>,options:{startRetryDelaysMs?:readonly number[];readSecret?:(backend:PageBackendRecord,name:string)=>Promise<string>}={}){return async(call:PageResolverFieldCall):Promise<HtmlJson>=>{
 const backend=await load(call.fileId,call.version);
 if(!backend||backend.backendId!==call.fileId||backend.version!==call.version||backend.pageId!==call.principal.tenant)throw new FieldNotExecuted('Backend link mismatch','forbidden');
 try{
  const reply=await runBackend(backend);
  // Only the wrapper builds {missing:true} (no function under that name at run time: nothing ran); a resolver result arrives as {value}.
  if(reply!==null&&typeof reply==='object'&&!Array.isArray(reply)&&reply.missing===true)throw new FieldNotExecuted('No such function','unknown_function');
  return reply!==null&&typeof reply==='object'&&!Array.isArray(reply)?(reply.value??null) as HtmlJson:null;
 }catch(error){
  if(!(error instanceof RunFailed))throw error;
  const reason=error.receipt?.reason;
  if(!reason)throw new FieldFailed('backend_failed');
  const secrets=await pinnedValues(backend,options.readSecret??readPinnedBackendSecret),thrown=reason.startsWith(RESOLVER_THREW);
  const receipt=thrown?{...error.receipt!,reason:reason.slice(RESOLVER_THREW.length)}:error.receipt;
  throw new FieldFailed('backend_failed',resolverFailureDetail(receipt,secrets),thrown?redactedLine(receipt!.reason!,secrets):undefined);
 }
 function runBackend(backend:PageBackendRecord){return run(runner,{requestId:randomUUID(),userId:backend.ownerId,pageBackendOperation:call.operation,artifactId:backend.backendId,artifactVersion:backend.version,document:{source:backend.compiled,editId:backend.version},program:{source:backend.compiled,language:'javascript'},input:{kind:'invoke',field:call.field,args:call.args,principal:{...call.principal},...(call.admission?{admission:{...call.admission,...(call.admission.claim?{claim:{...call.admission.claim}}:{})}}:{})},limits},call.signal,options.startRetryDelaysMs);}
};}
/**
 * How long a PASSING admission decision is reused for one invocation's fetch and db capabilities (`caps.fetch`, a
 * `caps.db` open and the runner worker's check before each query): a loop of queries costs one decision a second,
 * not one per query. A revocation takes effect at the next decision, within this window, and ALWAYS at once at a
 * write's commit: `caps.sql` and `caps.query` decide on every call, and their writes decide again inside the commit.
 */
export const ADMISSION_MEMO_MS=1000;
const MEMOIZED=new Set(['artifactbin.pageBackend.fetch',RESOLVER_DATABASE_OPERATION,RESOLVER_DATABASE_CHECK_OPERATION]);
const MEMO_ENTRIES=4096;
const passedUntil=new Map<string,number>();
async function admitted(admit:ResolverAdmit,check:AdmissionCheck,operation:string,invocation:string,signal?:AbortSignal):Promise<void>{
 const key=MEMOIZED.has(operation)?JSON.stringify([invocation,check.admission,check.caller]):null,now=Date.now();
 if(key&&(passedUntil.get(key)??0)>now)return;
 await admit(check,signal);
 if(!key)return;
 if(passedUntil.size>=MEMO_ENTRIES)for(const [entry,until] of passedUntil)if(until<=now)passedUntil.delete(entry);
 if(passedUntil.size>=MEMO_ENTRIES)passedUntil.clear();
 passedUntil.set(key,now+ADMISSION_MEMO_MS);
}
/** Called only by trusted runner composition using its admitted request snapshot. */
export async function pageBackendCapability(request:RunStart,operation:string,args:RunnerJson,load:(fileId:string,version:string)=>Promise<PageBackendRecord|null>,secretReader?:(backend:PageBackendRecord,name:string)=>Promise<string>,resolverFetch?:ResolverFetcher,datasets?:ResolverDatasets,signal?:AbortSignal):Promise<RunnerJson>{
 if(!request.artifactId||!(request.input&&typeof request.input==='object'&&!Array.isArray(request.input)&&request.input.kind==='invoke'))throw Error('backend_capability_forbidden');
 const backend=request.artifactVersion?await load(request.artifactId,request.artifactVersion):null;
 const principal=request.input.principal;
 if(!backend||backend.backendId!==request.artifactId||backend.version!==request.artifactVersion||backend.ownerId!==request.userId||backend.compiled!==request.program.source||!principal||typeof principal!=='object'||Array.isArray(principal)||principal.tenant!==backend.pageId)throw Error('backend_capability_forbidden');
 // The caller is the admitted principal (the app's, or the signed pin's); resolver arguments never name one.
 const role=(principal as {role?:unknown}).role,subject=principal.subject;
 const caller=typeof role==='string'&&(DATASET_ROLES as readonly string[]).includes(role)&&(subject===null||typeof subject==='string')?{subject,role:role as DatasetRole}:null;
 // A PAGE FUNCTION CALL'S ADMISSION (./admission): before every capability, the head it was admitted on, the caller's
 // eligibility for the function and a scheduled run's claim are decided again; a call that has lost any of them
 // reaches nothing more. A legacy GraphQL resolver call carries none.
 let check:AdmissionCheck|undefined;
 if(request.input.admission!==undefined){
  const admission=runnerAdmissionOf(request.input.admission);
  const field=request.input.field;
  if(!admission||admission.page!==backend.pageId||(typeof field==='string'&&field!==admission.function)||!caller||!datasets?.admit)throw Error('backend_capability_forbidden');
  const rule=functionRule(backend,admission.function);
  if(!rule)throw Error('backend_capability_forbidden');
  check={admission,caller,rule};
  await admitted(datasets.admit,check,operation,request.requestId,signal);
 }
 if(operation===RESOLVER_DATABASE_CHECK_OPERATION)return null;
 // Resolver code may reach any host operation by name; only fetch, query, sql and the runner worker's db are offered.
 // Fetch secret values stay on the host; a connection's settings go to the runner worker (its driver), not to resolver code.
 const port=operation==='artifactbin.pageBackend.query'?datasets?.query:operation==='artifactbin.pageBackend.sql'?datasets?.sql:null;
 if(port!==null){
  if(!port)throw Error('backend_capability_forbidden');
  return port({pageId:backend.pageId,caller,operation:request.pageBackendOperation,args,...(signal?{signal}:{}),...(check?{admission:check}:{})});
 }
 if(operation===RESOLVER_DATABASE_OPERATION){
  if(!secretReader)throw Error('backend_capability_forbidden');
  return resolverDatabaseConnection(args,{hosts:backend.secretHosts??{},read:name=>secretReader(backend,name)});
 }
 if(operation!=='artifactbin.pageBackend.fetch'||!resolverFetch||!secretReader)throw Error('backend_capability_forbidden');
 return {...await resolverFetch(args,{owner:backend.ownerId,resolver:backend.backendId,hosts:backend.secretHosts??{},read:name=>secretReader(backend,name)})} as unknown as RunnerJson;
}
