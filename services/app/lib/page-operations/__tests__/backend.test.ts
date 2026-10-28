import {describe,it,expect} from 'vitest';
import type {RunStart,RunnerService} from '@artifactbin/contracts';
import {pageBackendCapability,createBackendInvoker} from '../backend';
import {FieldFailed,FieldNotExecuted} from '../contracts';
import {composePageSchema,executePageOperation} from '../namespaces';
const record={backendId:'backend1',pageId:'page1',version:'v1',source:'source',compiled:'immutable bundle',typeDefs:'type Query { x:Int }',ownerId:'owner1'};
const request:RunStart={requestId:'r1',pageBackendOperation:'mutation',userId:'owner1',artifactId:'backend1',artifactVersion:'v1',program:{source:'immutable bundle',language:'javascript'},input:{kind:'invoke',principal:{tenant:'page1',subject:null}}};
it('refuses forged admitted code before accessing a backend store',async()=>{
 let reads=0;const store={get:async()=>{reads++;return {value:null,version:0};},set:async()=>({ok:true,version:1})};
 await expect(pageBackendCapability(store,{...request,program:{source:'forged',language:'javascript'}},'artifactbin.pageBackend.store.get',{},async()=>record)).rejects.toThrow('backend_capability_forbidden');expect(reads).toBe(0);
});
it('uses the admitted immutable backend identity and preserves CAS conflicts',async()=>{
 const calls:unknown[]=[];const store={get:async()=>({value:null,version:0}),set:async(...args:unknown[])=>{calls.push(args);return {ok:false,version:4};}};
 expect(await pageBackendCapability(store,request,'artifactbin.pageBackend.store.set',{value:{n:1},expected:2,backendId:'other'},async()=>record)).toEqual({ok:false,version:4});expect(calls).toEqual([['backend1',{n:1},2,{pageId:record.pageId,version:record.version,ownerId:record.ownerId}]]);
});
it('admits only the pinned backend declaration before reading owner credentials',async()=>{
 const calls:unknown[]=[];const store={get:async()=>({value:null,version:0}),set:async()=>({ok:true,version:1})},backend={...record,secretBindings:['TOKEN']};
 const read=async(b:typeof record,name:string)=>{calls.push([b.ownerId,b.backendId,name]);return 'private-value';};
 expect(await pageBackendCapability(store,request,'artifactbin.pageBackend.secrets.get',{name:'TOKEN',ownerId:'other'},async()=>backend,undefined,read)).toBe('private-value');
 await expect(pageBackendCapability(store,request,'artifactbin.pageBackend.secrets.get',{name:'OTHER'},async()=>backend,undefined,read)).rejects.toThrow('forbidden');
 await expect(pageBackendCapability(store,{...request,userId:'other'},'artifactbin.pageBackend.secrets.get',{name:'TOKEN'},async()=>backend,undefined,read)).rejects.toThrow('forbidden');
 expect(calls).toEqual([['owner1','backend1','TOKEN']]);
});

it('denies query and missing operation authority even when arguments claim mutation',async()=>{
 let writes=0;const store={get:async()=>({value:null,version:0}),set:async()=>{writes++;return {ok:true,version:1};}};
 for(const pageBackendOperation of ['query',undefined] as const)await expect(pageBackendCapability(store,{...request,pageBackendOperation},'artifactbin.pageBackend.store.set',{value:1,expected:0,pageBackendOperation:'mutation'},async()=>record)).rejects.toThrow('backend_capability_forbidden');
 expect(writes).toBe(0);
});

describe('backend run admission retries',()=>{
 const backend={...record,compiled:'bundle'};
 const call={namespace:'budget',fileId:'backend1',version:'v1',operation:'query' as const,field:'targets',args:{},principal:{tenant:'page1',subject:'viewer1'},signal:new AbortController().signal};
 const fakeRunner=(failures:Array<()=>Error>)=>{const starts:string[]=[];const runner={start:async(input:RunStart)=>{starts.push(input.requestId);const fail=failures.shift();if(fail)throw fail();return {runId:'run1'};},getRun:async()=>({status:'completed',output:[{category:'Rent',amount:1}]}),cancel:async()=>{},events:async()=>({events:[],nextSequence:0,hasMore:false})} as unknown as RunnerService;return {runner,starts};};
 const invoker=(runner:RunnerService)=>createBackendInvoker(runner,async()=>backend,{startRetryDelaysMs:[1,1,1]});
 it('retries a full runner queue with the same request and returns the result',async()=>{
  const {runner,starts}=fakeRunner([()=>Error('queue_full'),()=>Error('runner_closed')]);
  expect(await invoker(runner)(call)).toEqual([{category:'Rent',amount:1}]);
  expect(starts).toHaveLength(3);expect(new Set(starts).size).toBe(1);
 });
 it('reports a queue that stays full as retryable and not executed, with a page message saying retrying is safe',async()=>{
  const {runner,starts}=fakeRunner(Array.from({length:9},()=>()=>Error('queue_full')));
  const error=await invoker(runner)(call).catch(e=>e);
  expect(error).toBeInstanceOf(FieldNotExecuted);expect(error.code).toBe('retryable');expect(starts).toHaveLength(4);
  const result=await executePageOperation({schema:composePageSchema([{name:'budget',fileId:'backend1',version:'v1',typeDefs:'type Query { n:Int }'}]),request:{query:'{ budget { n } }'},caller:{pageId:'page1',subject:'viewer1',role:'VIEWER'},invoke:invoker(fakeRunner(Array.from({length:9},()=>()=>Error('queue_full'))).runner)});
  expect(result.errors?.[0]?.message).toMatch(/retrying is safe/);expect(result.errors?.[0]?.extensions).toEqual({code:'retryable'});
 });
 it('never retries a permanent refusal',async()=>{
  const {runner,starts}=fakeRunner([()=>Error('invalid_start')]);
  const error=await invoker(runner)(call).catch(e=>e);
  expect(error).toBeInstanceOf(FieldNotExecuted);expect(error.code).toBe('backend_rejected');expect(starts).toHaveLength(1);
 });
 it('treats lost start replies as possibly admitted: retries, then reports an unknown outcome',async()=>{
  const {runner,starts}=fakeRunner(Array.from({length:9},()=>()=>new TypeError('fetch failed')));
  const error=await invoker(runner)(call).catch(e=>e);
  expect(error).toBeInstanceOf(FieldFailed);expect(error.code).toBe('backend_unavailable');expect(starts).toHaveLength(4);expect(new Set(starts).size).toBe(1);
 });
 it('stops retrying once the request is cancelled',async()=>{
  const controller=new AbortController();const {runner,starts}=fakeRunner([()=>{controller.abort();return Error('queue_full');}]);
  const error=await invoker(runner)({...call,signal:controller.signal}).catch(e=>e);
  expect(error).toBeInstanceOf(FieldNotExecuted);expect(error.code).toBe('cancelled');expect(starts).toHaveLength(1);
 });
});
