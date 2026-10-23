import { transform } from 'esbuild';
import { randomUUID } from 'node:crypto';
import type { HtmlJson, PageResolverFieldCall, RunnerService, RunStart, RunnerJson } from '@artifactbin/contracts';
import { services } from '@/lib/platform';
import { boundedBackendSchema } from './execution-policy';
import {secretBindingNames} from '@/lib/html-backend-secrets/contracts';
import { FieldFailed, FieldNotExecuted } from './contracts';
export interface CompiledPageBackend {typeDefs:string;compiled:string;secretBindings?:string[]}
export interface PageBackendRecord extends CompiledPageBackend {backendId:string;version:string;source:string;ownerId:string;pageId:string}
export interface PageBackendFetchResult {status:number;url:string;contentType:string;body:string}
export type PageBackendFetcher=(url:string)=>Promise<PageBackendFetchResult>;
export interface PageBackendStore {get(backendId:string):Promise<{value:HtmlJson;version:number}>;set(backendId:string,value:HtmlJson,expected:number):Promise<{ok:boolean;version:number}>}
const limits={timeoutMs:5000,cpuMs:200,memoryMiB:64,maxRequests:32,maxOutputBytes:1048576};
/** The runner compiler's fixed import allowlist is authoritative. No host evaluation. */
async function backendProgram(source:string):Promise<string>{
 if(Buffer.byteLength(source)>262144)throw new FieldNotExecuted('Source exceeds budget','source_limit');
 const transformed=await transform(source,{loader:'ts',format:'cjs',target:'es2022'});
 return `const Backend=(()=>{const module={exports:{}};const exports=module.exports;${transformed.code};return module.exports})();
export default async function(input,host){
 if(input.kind==='schema'){if(typeof Backend.typeDefs!=='string'||!Backend.default||typeof Backend.default!=='object')throw Error('invalid_backend_exports');return {typeDefs:Backend.typeDefs,secretBindings:Backend.secretBindings??[]};}
 const fn=Backend.default[input.field];if(typeof fn!=='function')throw Error('missing_resolver');
 const principal=Object.freeze(input.principal);
 const caps=Object.freeze({secrets:Object.freeze({get:(name)=>host.artifactbin.call('pageBackend.secrets.get',{name})}),fetch:async(url)=>{const r=await host.artifactbin.call('pageBackend.fetch',{url});return Object.freeze({ok:r.status>=200&&r.status<300,status:r.status,url:r.url,headers:Object.freeze({'content-type':r.contentType}),text:async()=>r.body,json:async()=>JSON.parse(r.body)});},store:Object.freeze({get:()=>host.artifactbin.call('pageBackend.store.get',{}),set:async(value,options)=>{const result=await host.artifactbin.call('pageBackend.store.set',{value,expected:options.expected});if(!result.ok){const e=Error('conflict');e.code='conflict';throw e;}return result.version;}})});
 return await fn(input.args,principal,caps);
 }`;
}
async function run(runner:RunnerService,request:RunStart,signal?:AbortSignal):Promise<RunnerJson>{
 if(signal?.aborted)throw new FieldNotExecuted('Cancelled','cancelled');
 let runId:string;
 try{({runId}=await runner.start(request));}catch{throw new FieldNotExecuted('Runner refused admission','backend_busy');}
 const lookup={runId,userId:request.userId};
 const deadline=Date.now()+6000;
 while(true){
  if(signal?.aborted||Date.now()>deadline){await runner.cancel(lookup).catch(()=>{});throw new FieldFailed('deadline');}
  let snapshot;try{snapshot=await runner.getRun(lookup);}catch{throw new FieldFailed('backend_unavailable');}
  if(snapshot.status==='completed')return snapshot.output;
  if(!['queued','running'].includes(snapshot.status))throw new FieldFailed('backend_failed');
  await new Promise(resolve=>setTimeout(resolve,10));
 }
}
export function createBackendCompiler(runner:RunnerService){return async(source:string,signal?:AbortSignal):Promise<CompiledPageBackend>=>{
 const compiled=await backendProgram(source);
 const result=await run(runner,{requestId:randomUUID(),userId:'page-backend-compiler',artifactId:'page-backend-compiler',artifactVersion:'compile',document:{source:compiled,editId:'compile'},program:{source:compiled,language:'javascript'},input:{kind:'schema'},limits},signal);
 if(!result||typeof result!=='object'||Array.isArray(result)||typeof result.typeDefs!=='string')throw Error('invalid_backend_exports');
 boundedBackendSchema(result.typeDefs);return {compiled,typeDefs:result.typeDefs,secretBindings:secretBindingNames(result.secretBindings)};
};}
export function compilePageBackend(source:string,signal?:AbortSignal):Promise<CompiledPageBackend>{return createBackendCompiler(services().runner)(source,signal);}
export function createBackendInvoker(runner:RunnerService,load:(fileId:string,version:string)=>Promise<PageBackendRecord|null>){return async(call:PageResolverFieldCall):Promise<HtmlJson>=>{
 const backend=await load(call.fileId,call.version);
 if(!backend||backend.backendId!==call.fileId||backend.version!==call.version||backend.pageId!==call.principal.tenant)throw new FieldNotExecuted('Backend link mismatch','forbidden');
 return run(runner,{requestId:randomUUID(),userId:backend.ownerId,pageBackendOperation:call.operation,artifactId:backend.backendId,artifactVersion:backend.version,document:{source:backend.compiled,editId:backend.version},program:{source:backend.compiled,language:'javascript'},input:{kind:'invoke',field:call.field,args:call.args,principal:{...call.principal}},limits},call.signal);
};}
/** Called only by trusted runner composition using its admitted request snapshot. */
export async function pageBackendCapability(store:PageBackendStore,request:RunStart,operation:string,args:RunnerJson,load:(fileId:string,version:string)=>Promise<PageBackendRecord|null>,fetcher?:PageBackendFetcher,secretReader?:(backend:PageBackendRecord,name:string)=>Promise<string>):Promise<RunnerJson>{
 if(!request.artifactId||!(request.input&&typeof request.input==='object'&&!Array.isArray(request.input)&&request.input.kind==='invoke'))throw Error('backend_capability_forbidden');
 const backend=request.artifactVersion?await load(request.artifactId,request.artifactVersion):null;
 const principal=request.input.principal;
 if(!backend||backend.backendId!==request.artifactId||backend.version!==request.artifactVersion||backend.ownerId!==request.userId||backend.compiled!==request.program.source||!principal||typeof principal!=='object'||Array.isArray(principal)||principal.tenant!==backend.pageId)throw Error('backend_capability_forbidden');
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
 return store.set(request.artifactId,args.value,Number(args.expected));
}
