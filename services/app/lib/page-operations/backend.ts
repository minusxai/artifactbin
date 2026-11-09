import { transform } from 'esbuild';
import { randomUUID } from 'node:crypto';
import { DATASET_ROLES, isResolverDatabaseKind, RESOLVER_DATABASE_OPERATION, RESOLVER_LIMITS, type DatasetRole, type HtmlJson, type PageResolverFieldCall, type ResolverSecretHosts, type RunnerService, type RunStart, type RunnerJson, type RunSnapshot } from '@artifactbin/contracts';
import { services } from '@/lib/platform';
import { boundedBackendSchema, resolverTestField } from './execution-policy';
import { functionManifest, type FunctionRoles } from './functions';
import {readPinnedBackendSecret,secretHostMap} from '@/lib/html-backend-secrets';
import {redactedLine,resolverFailureDetail} from './redaction';
import { FieldFailed, FieldNotExecuted } from './contracts';
import type { ResolverFetcher } from './public-fetch';
import type { ResolverQuery } from './query';
import type { ResolverSql } from './sql';
import {connectionPassword,resolverDatabaseConnection} from './database';
/** The page's datasets for resolver code, as the caller: `caps.query` (GraphQL) and `caps.sql` (read-only SQL). */
export interface ResolverDatasets {query?:ResolverQuery;sql?:ResolverSql}
/** `secretBindings` lists every declared secret name; `secretHosts` binds each to its one host. */
/** `typeDefs` is '' for a typeDefs-free file, whose callable functions and their roles are `functions` (./functions); null for a legacy file. */
export interface CompiledPageBackend {typeDefs:string;functions?:FunctionRoles|null;compiled:string;secretBindings?:string[];secretHosts?:ResolverSecretHosts;test?:boolean}
export interface PageBackendRecord extends CompiledPageBackend {backendId:string;version:string;source:string;ownerId:string;pageId:string}
const limits={timeoutMs:RESOLVER_LIMITS.wallMs,cpuMs:200,memoryMiB:64,maxRequests:RESOLVER_LIMITS.maxRequests,maxOutputBytes:RESOLVER_LIMITS.outputBytes};
/**
 * How a run's reason marks a message the resolver code itself threw (an Error it made, not one a capability
 * raised or the runner reported): the invoker shows its redacted first line to every caller.
 */
export const RESOLVER_THREW='resolver_error: ';
/**
 * `caps` is `fetch` (with host-filled `{{NAME}}` placeholders), `query` (the page's datasets as the caller, GraphQL),
 * `sql` (the same, read-only SQL) and `db` (a named owner database connection, Postgres or MySQL, through the runner's
 * tunnel), nothing else.
 */
const CAPS=`Object.freeze({fetch:G(async(url,init)=>{const o=init??{};const r=await host.artifactbin.call('pageBackend.fetch',{url,method:o.method,headers:o.headers,body:o.body,auth:o.auth});return Object.freeze({ok:r.status>=200&&r.status<300,status:r.status,url:r.url,headers:Object.freeze({...r.headers}),text:G(async()=>r.body),json:G(async()=>JSON.parse(r.body))});}),query:G((query,variables)=>C('pageBackend.query',{query,variables:variables??null})),sql:G((sql,params)=>C('pageBackend.sql',typeof sql==='string'?{sql,params:params??null}:sql)),db:G(async(name)=>{const id=await D(()=>host.db.open(name));return Object.freeze({query:G((sql,params)=>D(()=>host.db.query(id,sql,params??null))),end:G(()=>D(()=>host.db.end(id)))});})})`;
/** A host call whose refusal (code: detail) reaches resolver code as an Error carrying that code. */
const CALL=`const D=async(f)=>{try{return await f();}catch(e){const m=String(e&&e.message||e),i=m.indexOf(': ');const error=Error(i>0?m.slice(i+2):m);error.code=i>0?m.slice(0,i):m;throw error;}};const C=(operation,args)=>D(()=>host.artifactbin.call(operation,args));`;
/** The runner compiler's fixed import allowlist is authoritative. No host evaluation. */
async function backendProgram(source:string):Promise<string>{
 if(Buffer.byteLength(source)>262144)throw new FieldNotExecuted('Source exceeds budget','source_limit');
 const transformed=await transform(source,{loader:'ts',format:'cjs',target:'es2022'});
 // G marks every error a capability raises, so only the resolver's own throws carry RESOLVER_THREW.
 return `const __afPlatform=new WeakSet();const G=(f)=>async(...a)=>{try{return await f(...a);}catch(e){if(e!==null&&typeof e==='object')__afPlatform.add(e);throw e;}};
const Backend=(()=>{const module={exports:{}};const exports=module.exports;${transformed.code};return module.exports})();
export default async function(input,host){
 if(input.kind==='schema'){const d=Backend.default;if(Backend.typeDefs!==undefined&&typeof Backend.typeDefs!=='string'||!d||typeof d!=='object')throw Error('invalid_backend_exports');return {typeDefs:Backend.typeDefs??null,functions:Object.keys(d).filter(k=>typeof d[k]==='function'),roles:Backend.roles??null,secrets:Backend.secrets};}
 const fn=Object.prototype.hasOwnProperty.call(Backend.default,input.field)?Backend.default[input.field]:undefined;if(typeof fn!=='function')throw Error('missing_resolver');
 const principal=Object.freeze(input.principal);
 ${CALL}
 const caps=${CAPS};
 try{return await fn(input.args,principal,caps);}catch(e){
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
 const result=await run(runner,{requestId:randomUUID(),userId:'page-backend-compiler',artifactId:'page-backend-compiler',artifactVersion:'compile',document:{source:compiled,editId:'compile'},program:{source:compiled,language:'javascript'},input:{kind:'schema'},limits},signal);
 if(!result||typeof result!=='object'||Array.isArray(result))throw Error('invalid_backend_exports');
 const secretHosts=secretHostMap(result.secrets);
 const secrets={secretBindings:Object.keys(secretHosts),secretHosts};
 if(typeof result.typeDefs==='string'){
  if(result.roles!==null&&result.roles!==undefined)throw Error('A backend with typeDefs guards fields with @auth; export roles only from a backend without typeDefs');
  return {compiled,typeDefs:result.typeDefs,functions:null,...secrets,test:resolverTestField(boundedBackendSchema(result.typeDefs))};
 }
 const functions=functionManifest(result.functions,result.roles);
 // Test connection: an owner-only `test` function, as a legacy file's `test: String! @auth(role: owner)`.
 if(Object.hasOwn(functions,'test')&&functions.test!=='owner')throw Error("invalid_test_field: give test the owner role (roles = {test: 'owner'})");
 return {compiled,typeDefs:'',functions,...secrets,test:Object.hasOwn(functions,'test')};
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
 try{return await runBackend(backend);}catch(error){
  if(!(error instanceof RunFailed))throw error;
  const reason=error.receipt?.reason;
  if(!reason)throw new FieldFailed('backend_failed');
  const secrets=await pinnedValues(backend,options.readSecret??readPinnedBackendSecret),thrown=reason.startsWith(RESOLVER_THREW);
  const receipt=thrown?{...error.receipt!,reason:reason.slice(RESOLVER_THREW.length)}:error.receipt;
  throw new FieldFailed('backend_failed',resolverFailureDetail(receipt,secrets),thrown?redactedLine(receipt!.reason!,secrets):undefined);
 }
 function runBackend(backend:PageBackendRecord){return run(runner,{requestId:randomUUID(),userId:backend.ownerId,pageBackendOperation:call.operation,artifactId:backend.backendId,artifactVersion:backend.version,document:{source:backend.compiled,editId:backend.version},program:{source:backend.compiled,language:'javascript'},input:{kind:'invoke',field:call.field,args:call.args,principal:{...call.principal}},limits},call.signal,options.startRetryDelaysMs);}
};}
/** Called only by trusted runner composition using its admitted request snapshot. */
export async function pageBackendCapability(request:RunStart,operation:string,args:RunnerJson,load:(fileId:string,version:string)=>Promise<PageBackendRecord|null>,secretReader?:(backend:PageBackendRecord,name:string)=>Promise<string>,resolverFetch?:ResolverFetcher,datasets?:ResolverDatasets,signal?:AbortSignal):Promise<RunnerJson>{
 if(!request.artifactId||!(request.input&&typeof request.input==='object'&&!Array.isArray(request.input)&&request.input.kind==='invoke'))throw Error('backend_capability_forbidden');
 const backend=request.artifactVersion?await load(request.artifactId,request.artifactVersion):null;
 const principal=request.input.principal;
 if(!backend||backend.backendId!==request.artifactId||backend.version!==request.artifactVersion||backend.ownerId!==request.userId||backend.compiled!==request.program.source||!principal||typeof principal!=='object'||Array.isArray(principal)||principal.tenant!==backend.pageId)throw Error('backend_capability_forbidden');
 // Resolver code may reach any host operation by name; only fetch, query, sql and the runner worker's db are offered.
 // Fetch secret values stay on the host; a connection's settings go to the runner worker (its driver), not to resolver code.
 const port=operation==='artifactbin.pageBackend.query'?datasets?.query:operation==='artifactbin.pageBackend.sql'?datasets?.sql:null;
 if(port!==null){
  if(!port)throw Error('backend_capability_forbidden');
  // The caller is the admitted principal (the app's, or the signed pin's); resolver arguments never name one.
  const role=(principal as {role?:unknown}).role,subject=principal.subject;
  const caller=typeof role==='string'&&(DATASET_ROLES as readonly string[]).includes(role)&&(subject===null||typeof subject==='string')?{subject,role:role as DatasetRole}:null;
  return port({pageId:backend.pageId,caller,operation:request.pageBackendOperation,args,...(signal?{signal}:{})});
 }
 if(operation===RESOLVER_DATABASE_OPERATION){
  if(!secretReader)throw Error('backend_capability_forbidden');
  return resolverDatabaseConnection(args,{hosts:backend.secretHosts??{},read:name=>secretReader(backend,name)});
 }
 if(operation!=='artifactbin.pageBackend.fetch'||!resolverFetch||!secretReader)throw Error('backend_capability_forbidden');
 return {...await resolverFetch(args,{owner:backend.ownerId,resolver:backend.backendId,hosts:backend.secretHosts??{},read:name=>secretReader(backend,name)})} as unknown as RunnerJson;
}
