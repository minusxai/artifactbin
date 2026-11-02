import { transform } from 'esbuild';
import { randomUUID } from 'node:crypto';
import { DATASET_ROLES, RESOLVER_LIMITS, type DatasetRole, type HtmlJson, type PageResolverFieldCall, type ResolverApi, type ResolverSecretHosts, type RunnerService, type RunStart, type RunnerJson, type RunSnapshot } from '@artifactbin/contracts';
import { services } from '@/lib/platform';
import { boundedBackendSchema, resolverTestField } from './execution-policy';
import {readPinnedBackendSecret,secretBindingNames,secretHostMap} from '@/lib/html-backend-secrets';
import {resolverFailureDetail} from './redaction';
import { FieldFailed, FieldNotExecuted } from './contracts';
import type { ResolverFetcher } from './public-fetch';
import type { ResolverQuery } from './query';
/** `secretBindings` lists every declared secret name; `secretHosts` binds api 2 names to hosts. */
export interface CompiledPageBackend {typeDefs:string;compiled:string;secretBindings?:string[];secretHosts?:ResolverSecretHosts;api?:ResolverApi;test?:boolean}
export interface PageBackendRecord extends CompiledPageBackend {backendId:string;version:string;source:string;ownerId:string;pageId:string}
export interface PageBackendFetchResult {status:number;url:string;contentType:string;body:string}
export type PageBackendFetcher=(url:string)=>Promise<PageBackendFetchResult>;
export interface PageBackendStore {get(backendId:string):Promise<{value:HtmlJson;version:number}>;set(backendId:string,value:HtmlJson,expected:number,scope?:{pageId:string;version:string;ownerId:string}):Promise<{ok:boolean;version:number}>}
const limits={timeoutMs:RESOLVER_LIMITS.wallMs,cpuMs:200,memoryMiB:64,maxRequests:RESOLVER_LIMITS.maxRequests,maxOutputBytes:RESOLVER_LIMITS.outputBytes};
/** api 1 keeps its legacy capabilities; api 2 gets `fetch` (with host-filled `{{NAME}}` placeholders) and `query` (the page's datasets as the caller), nothing else. */
const API1_CAPS=`Object.freeze({secrets:Object.freeze({get:(name)=>host.artifactbin.call('pageBackend.secrets.get',{name})}),fetch:async(url)=>{const r=await host.artifactbin.call('pageBackend.fetch',{url});return Object.freeze({ok:r.status>=200&&r.status<300,status:r.status,url:r.url,headers:Object.freeze({'content-type':r.contentType}),text:async()=>r.body,json:async()=>JSON.parse(r.body)});},store:Object.freeze({get:()=>host.artifactbin.call('pageBackend.store.get',{}),set:async(value,options)=>{const result=await host.artifactbin.call('pageBackend.store.set',{value,expected:options.expected});if(!result.ok){const e=Error('conflict');e.code='conflict';throw e;}return result.version;}})})`;
const API2_CAPS=`Object.freeze({fetch:async(url,init)=>{const o=init??{};const r=await host.artifactbin.call('pageBackend.fetch',{url,method:o.method,headers:o.headers,body:o.body,auth:o.auth});return Object.freeze({ok:r.status>=200&&r.status<300,status:r.status,url:r.url,headers:Object.freeze({...r.headers}),text:async()=>r.body,json:async()=>JSON.parse(r.body)});},query:async(query,variables)=>{try{return await host.artifactbin.call('pageBackend.query',{query,variables:variables??null});}catch(e){const m=String(e&&e.message||e),i=m.indexOf(': ');const error=Error(i>0?m.slice(i+2):m);error.code=i>0?m.slice(0,i):m;throw error;}}})`;
/** The runner compiler's fixed import allowlist is authoritative. No host evaluation. */
async function backendProgram(source:string,api:ResolverApi):Promise<string>{
 if(Buffer.byteLength(source)>262144)throw new FieldNotExecuted('Source exceeds budget','source_limit');
 const transformed=await transform(source,{loader:'ts',format:'cjs',target:'es2022'});
 return `const Backend=(()=>{const module={exports:{}};const exports=module.exports;${transformed.code};return module.exports})();
export default async function(input,host){
 if(input.kind==='schema'){if(typeof Backend.typeDefs!=='string'||!Backend.default||typeof Backend.default!=='object')throw Error('invalid_backend_exports');return {typeDefs:Backend.typeDefs,secretBindings:Backend.secretBindings,secrets:Backend.secrets};}
 const fn=Backend.default[input.field];if(typeof fn!=='function')throw Error('missing_resolver');
 const principal=Object.freeze(input.principal);
 const caps=${api===1?API1_CAPS:API2_CAPS};
 return await fn(input.args,principal,caps);
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
  if(signal?.aborted||Date.now()>deadline){await runner.cancel(lookup).catch(()=>{});throw new FieldFailed('deadline');}
  let snapshot;try{snapshot=await runner.getRun(lookup);}catch{throw new FieldFailed('backend_unavailable');}
  if(snapshot.status==='completed')return snapshot.output;
  // The reason stays raw here: the invoker redacts it against the pinned secrets before it becomes a detail.
  if(!['queued','running'].includes(snapshot.status))throw new RunFailed(snapshot.receipt);
  await new Promise(resolve=>setTimeout(resolve,10));
 }
}
/** Source that reaches for a legacy capability or declaration is api 1; everything else is the resolver contract, api 2. */
const LEGACY_API=/\bsecretBindings\b|\bsecrets\s*\.\s*get\b|\bstore\s*\.\s*(?:get|set)\b|\bcaps\s*\.\s*store\b/;
export function createBackendCompiler(runner:RunnerService){return async(source:string,signal?:AbortSignal):Promise<CompiledPageBackend>=>{
 const api:ResolverApi=LEGACY_API.test(source)?1:2;
 const compiled=await backendProgram(source,api);
 const result=await run(runner,{requestId:randomUUID(),userId:'page-backend-compiler',artifactId:'page-backend-compiler',artifactVersion:'compile',document:{source:compiled,editId:'compile'},program:{source:compiled,language:'javascript'},input:{kind:'schema'},limits},signal);
 if(!result||typeof result!=='object'||Array.isArray(result)||typeof result.typeDefs!=='string')throw Error('invalid_backend_exports');
 const test=resolverTestField(boundedBackendSchema(result.typeDefs));
 if(result.secretBindings!==undefined&&result.secrets!==undefined)throw Error('invalid_secrets: export a secrets map or legacy secretBindings, not both');
 const secretHosts=secretHostMap(result.secrets),secretBindings=result.secrets===undefined?secretBindingNames(result.secretBindings):Object.keys(secretHosts);
 return {compiled,typeDefs:result.typeDefs,secretBindings,secretHosts,api,test};
};}
export function compilePageBackend(source:string,signal?:AbortSignal):Promise<CompiledPageBackend>{return createBackendCompiler(services().runner)(source,signal);}
/** Every pinned secret value that can still be read; a missing or transferred one cannot be in the reason. */
async function pinnedValues(backend:PageBackendRecord,read:(backend:PageBackendRecord,name:string)=>Promise<string>):Promise<string[]>{
 const values=await Promise.all((backend.secretBindings??[]).map(name=>read(backend,name).catch(()=>'')));
 return values.filter(Boolean);
}
/**
 * A failed run surfaces as `backend_failed`; its `detail` (shown to the page owner only, by the executor) is the
 * runner's reason made safe by `resolverFailureDetail`, redacted of the pinned secret values.
 */
export function createBackendInvoker(runner:RunnerService,load:(fileId:string,version:string)=>Promise<PageBackendRecord|null>,options:{startRetryDelaysMs?:readonly number[];readSecret?:(backend:PageBackendRecord,name:string)=>Promise<string>}={}){return async(call:PageResolverFieldCall):Promise<HtmlJson>=>{
 const backend=await load(call.fileId,call.version);
 if(!backend||backend.backendId!==call.fileId||backend.version!==call.version||backend.pageId!==call.principal.tenant)throw new FieldNotExecuted('Backend link mismatch','forbidden');
 try{return await runBackend(backend);}catch(error){
  if(!(error instanceof RunFailed))throw error;
  const reason=error.receipt?.reason;
  throw new FieldFailed('backend_failed',reason?resolverFailureDetail(error.receipt,await pinnedValues(backend,options.readSecret??readPinnedBackendSecret)):undefined);
 }
 function runBackend(backend:PageBackendRecord){return run(runner,{requestId:randomUUID(),userId:backend.ownerId,pageBackendOperation:call.operation,artifactId:backend.backendId,artifactVersion:backend.version,document:{source:backend.compiled,editId:backend.version},program:{source:backend.compiled,language:'javascript'},input:{kind:'invoke',field:call.field,args:call.args,principal:{...call.principal}},limits},call.signal,options.startRetryDelaysMs);}
};}
/** Called only by trusted runner composition using its admitted request snapshot. */
export async function pageBackendCapability(store:PageBackendStore,request:RunStart,operation:string,args:RunnerJson,load:(fileId:string,version:string)=>Promise<PageBackendRecord|null>,fetcher?:PageBackendFetcher,secretReader?:(backend:PageBackendRecord,name:string)=>Promise<string>,resolverFetch?:ResolverFetcher,resolverQuery?:ResolverQuery,signal?:AbortSignal):Promise<RunnerJson>{
 if(!request.artifactId||!(request.input&&typeof request.input==='object'&&!Array.isArray(request.input)&&request.input.kind==='invoke'))throw Error('backend_capability_forbidden');
 const backend=request.artifactVersion?await load(request.artifactId,request.artifactVersion):null;
 const principal=request.input.principal;
 if(!backend||backend.backendId!==request.artifactId||backend.version!==request.artifactVersion||backend.ownerId!==request.userId||backend.compiled!==request.program.source||!principal||typeof principal!=='object'||Array.isArray(principal)||principal.tenant!==backend.pageId)throw Error('backend_capability_forbidden');
 // api 2 code may reach any host operation by name; only fetch and query are offered, and values stay on the host.
 if(backend.api===2){
  if(operation==='artifactbin.pageBackend.query'){
   if(!resolverQuery)throw Error('backend_capability_forbidden');
   // The caller is the admitted principal (the app's, or the signed pin's); resolver arguments never name one.
   const role=(principal as {role?:unknown}).role,subject=principal.subject;
   const caller=typeof role==='string'&&(DATASET_ROLES as readonly string[]).includes(role)&&(subject===null||typeof subject==='string')?{subject,role:role as DatasetRole}:null;
   return resolverQuery({pageId:backend.pageId,caller,operation:request.pageBackendOperation,args,...(signal?{signal}:{})});
  }
  if(operation!=='artifactbin.pageBackend.fetch'||!resolverFetch||!secretReader)throw Error('backend_capability_forbidden');
  return {...await resolverFetch(args,{owner:backend.ownerId,resolver:backend.backendId,hosts:backend.secretHosts??{},read:name=>secretReader(backend,name)})} as unknown as RunnerJson;
 }
 if(operation==='artifactbin.pageBackend.secrets.get'){
  if(!secretReader||!args||typeof args!=='object'||Array.isArray(args)||typeof args.name!=='string'||!backend.secretBindings?.includes(args.name))throw Error('backend_secret_forbidden');
  return secretReader(backend,args.name);
 }
 if(operation==='artifactbin.pageBackend.fetch'){
  if(!fetcher||!args||typeof args!=='object'||Array.isArray(args)||typeof args.url!=='string'||args.url.length>8192)throw Error('backend_capability_forbidden');
  return {...await fetcher(args.url)};
 }
 if(operation==='artifactbin.pageBackend.store.get')return store.get(request.artifactId);
 if(request.pageBackendOperation!=='mutation'||operation!=='artifactbin.pageBackend.store.set'||!args||typeof args!=='object'||Array.isArray(args)||!Number.isSafeInteger(args.expected)||Number(args.expected)<0||!('value'in args))throw Error('backend_capability_forbidden');
 if(Buffer.byteLength(JSON.stringify(args.value))>60*1024)throw Error('store_limit');
 return store.set(request.artifactId,args.value,Number(args.expected),{pageId:backend.pageId,version:backend.version,ownerId:backend.ownerId});
}
