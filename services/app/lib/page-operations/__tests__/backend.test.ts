import {describe,it,expect,vi} from 'vitest';
import {RESOLVER_LIMITS,type RunStart,type RunnerService} from '@artifactbin/contracts';
import {pageBackendCapability,createBackendInvoker,RESOLVER_THREW} from '../backend';
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
 const call={namespace:'budget',fileId:'backend1',version:'v1',operation:'query' as const,field:'targets',args:{},principal:{tenant:'page1',subject:'viewer1',role:'viewer' as const},signal:new AbortController().signal};
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
  const result=await executePageOperation({schema:composePageSchema([{name:'budget',fileId:'backend1',version:'v1',typeDefs:'type Query { n:Int }'}]),request:{query:'{ budget { n } }'},caller:{pageId:'page1',subject:'viewer1',role:'viewer'},invoke:invoker(fakeRunner(Array.from({length:9},()=>()=>Error('queue_full'))).runner)});
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
 it('makes one attempt when a start hangs until its timeout, and reports an unknown outcome without retrying',async()=>{
  for(const name of ['AbortError','TimeoutError']){
   let starts=0;const hung={start:async()=>{starts++;await new Promise(r=>setTimeout(r,50));throw new DOMException('The operation was aborted due to timeout',name);},getRun:async()=>({status:'completed',output:null}),cancel:async()=>{}} as unknown as RunnerService;
   const began=Date.now();const error=await createBackendInvoker(hung,async()=>backend,{startRetryDelaysMs:[200,500,1000]})(call).catch(e=>e);
   expect(error).toBeInstanceOf(FieldFailed);expect(error.code).toBe('backend_unavailable');expect(starts).toBe(1);expect(Date.now()-began).toBeLessThan(150);
  }
 });
 it('keeps the default retry backoff for fast failures under 3 seconds',async()=>{
  const {runner,starts}=fakeRunner(Array.from({length:9},()=>()=>Error('queue_full')));
  const began=Date.now();const error=await createBackendInvoker(runner,async()=>backend)(call).catch(e=>e);
  expect(error.code).toBe('retryable');expect(starts).toHaveLength(4);expect(Date.now()-began).toBeLessThan(3000);
 },10000);
 it('stops retrying once the request is cancelled',async()=>{
  const controller=new AbortController();const {runner,starts}=fakeRunner([()=>{controller.abort();return Error('queue_full');}]);
  const error=await invoker(runner)({...call,signal:controller.signal}).catch(e=>e);
  expect(error).toBeInstanceOf(FieldNotExecuted);expect(error.code).toBe('cancelled');expect(starts).toHaveLength(1);
 });
});

describe('api 2 capabilities on the host',()=>{
 const store={get:async()=>({value:null,version:0}),set:async()=>({ok:true,version:1})};
 const v2={...record,api:2 as const,secretBindings:['KEY'],secretHosts:{KEY:'api.example.com'}};
 it('refuses secret values and the store to api 2 code even when it reaches for them by another name',async()=>{
  const read=async()=>'private-value';
  await expect(pageBackendCapability(store,request,'artifactbin.pageBackend.secrets.get',{name:'KEY'},async()=>v2,undefined,read)).rejects.toThrow('backend_capability_forbidden');
  await expect(pageBackendCapability(store,request,'artifactbin.pageBackend.store.get',{},async()=>v2)).rejects.toThrow('backend_capability_forbidden');
  await expect(pageBackendCapability(store,request,'artifactbin.pageBackend.store.set',{value:1,expected:0},async()=>v2)).rejects.toThrow('backend_capability_forbidden');
 });
 it('sends api 2 fetches to the host-injecting fetcher with the pinned bindings, and api 1 fetches to the URL-only fetcher',async()=>{
  const legacy=vi.fn(async(url:string)=>({status:200,url,contentType:'text/plain',body:'legacy'}));
  const resolver=vi.fn(async()=>({status:201,url:'https://api.example.com/',headers:{},contentType:'',body:'v2',receipt:{method:'GET',host:'api.example.com',path:'/',bytesIn:2,bytesOut:0,secrets:[]}}));
  const read=vi.fn(async()=>'value');const args={url:'https://api.example.com/?k={{KEY}}',method:'POST',body:'{}'};
  expect(await pageBackendCapability(store,request,'artifactbin.pageBackend.fetch',args,async()=>v2,legacy,read,resolver)).toMatchObject({status:201,body:'v2'});
  expect(legacy).not.toHaveBeenCalled();expect(resolver).toHaveBeenCalledWith(args,expect.objectContaining({hosts:{KEY:'api.example.com'}}));
  await (resolver.mock.calls[0] as unknown as [unknown,{read(name:string):Promise<string>}])[1].read('KEY');expect(read).toHaveBeenCalledWith(v2,'KEY');
  expect(await pageBackendCapability(store,request,'artifactbin.pageBackend.fetch',{url:'https://example.com/',headers:{Authorization:'never-forward'}},async()=>({...record,api:1 as const}),legacy,read,resolver)).toMatchObject({body:'legacy'});
  expect(legacy).toHaveBeenCalledWith('https://example.com/');expect(resolver).toHaveBeenCalledTimes(1);
 });
});
describe('api 2 caps.query on the host',()=>{
 const store={get:async()=>({value:null,version:0}),set:async()=>({ok:true,version:1})};
 const v2={...record,api:2 as const};
 const admitted=(principal:Record<string,import('@artifactbin/contracts').RunnerJson>,pageBackendOperation:'query'|'mutation'|undefined='query'):RunStart=>({...request,pageBackendOperation,input:{kind:'invoke',principal:{tenant:'page1',...principal}}});
 it('hands the query port the admitted caller and operation, never one the arguments name',async()=>{
  const query=vi.fn(async()=>({ok:true}));
  const args={query:'{ staff { name } }',principal:{subject:'owner1',role:'owner'},subject:'owner1',role:'owner',pageBackendOperation:'mutation'};
  expect(await pageBackendCapability(store,admitted({subject:'viewer1',role:'viewer'}),'artifactbin.pageBackend.query',args,async()=>v2,undefined,undefined,undefined,query)).toEqual({ok:true});
  expect(query).toHaveBeenCalledWith({pageId:'page1',caller:{subject:'viewer1',role:'viewer'},operation:'query',args});
  await pageBackendCapability(store,admitted({subject:null,role:'anonymous'},'mutation'),'artifactbin.pageBackend.query',{query:'{x}'},async()=>v2,undefined,undefined,undefined,query);
  expect(query).toHaveBeenLastCalledWith(expect.objectContaining({caller:{subject:null,role:'anonymous'},operation:'mutation'}));
  // An admitted principal with no (or no known) role attests no caller.
  for(const principal of [{subject:'viewer1'},{subject:'viewer1',role:'admin'}] as Record<string,import('@artifactbin/contracts').RunnerJson>[]){
   await pageBackendCapability(store,admitted(principal),'artifactbin.pageBackend.query',{query:'{x}'},async()=>v2,undefined,undefined,undefined,query);
   expect(query).toHaveBeenLastCalledWith(expect.objectContaining({caller:null}));
  }
 });
 it('is api 2 only, needs the composition\'s port, and still checks the admitted code first',async()=>{
  const query=vi.fn(async()=>null);
  const run=(backend:typeof record&{api?:1|2},start=admitted({subject:'viewer1',role:'viewer'}),port:typeof query|null=query)=>pageBackendCapability(store,start,'artifactbin.pageBackend.query',{query:'{x}'},async()=>backend,undefined,undefined,undefined,port??undefined);
  await expect(run({...record,api:1})).rejects.toThrow('backend_capability_forbidden');
  await expect(run(v2,undefined,null)).rejects.toThrow('backend_capability_forbidden');
  await expect(run(v2,{...admitted({subject:'viewer1',role:'viewer'}),program:{source:'forged',language:'javascript'}})).rejects.toThrow('backend_capability_forbidden');
  await expect(run(v2,{...admitted({subject:'viewer1',role:'viewer'}),input:{kind:'invoke',principal:{tenant:'other-page',subject:'viewer1',role:'viewer'}}})).rejects.toThrow('backend_capability_forbidden');
  expect(query).not.toHaveBeenCalled();
 });
});
describe('resolver time limits',()=>{
 const call={namespace:'budget',fileId:'backend1',version:'v1',operation:'query' as const,field:'targets',args:{},principal:{tenant:'page1',subject:'viewer1',role:'viewer' as const},signal:new AbortController().signal};
 it('gives the run 15 s of wall time and waits for it 16 s',async()=>{
  vi.useFakeTimers();
  try{
   let limits:RunStart['limits'];let cancelled=0;
   const runner={start:async(input:RunStart)=>{limits=input.limits;return {runId:'run1'};},getRun:async()=>({status:'running',output:null}),cancel:async()=>{cancelled++;}} as unknown as RunnerService;
   const outcome=createBackendInvoker(runner,async()=>({...record,compiled:'bundle'}))(call).then(()=>'completed',(e:FieldFailed)=>e.code);
   await vi.advanceTimersByTimeAsync(15_900);expect(cancelled).toBe(0);
   await vi.advanceTimersByTimeAsync(200);expect(await outcome).toBe('deadline');expect(cancelled).toBe(1);
   expect(limits).toMatchObject({timeoutMs:15_000,maxRequests:32,maxOutputBytes:1024*1024});
  }finally{vi.useRealTimers();}
 });
});
describe('resolver completion wait',()=>{
 const call=(signal=new AbortController().signal)=>({namespace:'budget',fileId:'backend1',version:'v1',operation:'query' as const,field:'targets',args:{},principal:{tenant:'page1',subject:'viewer1',role:'viewer' as const},signal});
 /** A runner that holds getRun open as the contract says: until done, or waitMs. */
 function waiting(finishAfterMs:number|null){
  const waits:number[]=[];let cancelled=0,startedAt=0;
  const runner={start:async()=>{startedAt=Date.now();return {runId:'run1'};},cancel:async()=>{cancelled++;},
   getRun:async({waitMs}:{waitMs?:number})=>{waits.push(waitMs??-1);const doneAt=finishAfterMs===null?Infinity:startedAt+finishAfterMs;const wake=Math.min(Date.now()+(waitMs??0),doneAt);await new Promise(r=>setTimeout(r,Math.max(0,wake-Date.now())));return Date.now()>=doneAt?{runId:'run1',status:'completed',output:'pong',receipt:null}:{runId:'run1',status:'running',output:null,receipt:null};}} as unknown as RunnerService;
  return {runner,waits,cancelled:()=>cancelled};
 }
 it('asks once and returns as the run completes instead of polling',async()=>{
  const r=waiting(40);const began=Date.now();
  expect(await createBackendInvoker(r.runner,async()=>({...record,compiled:'bundle'}))(call())).toBe('pong');
  expect(r.waits).toHaveLength(1);expect(r.waits[0]).toBeGreaterThan(15_000);expect(r.waits[0]).toBeLessThanOrEqual(RESOLVER_LIMITS.runWaitMs);expect(Date.now()-began).toBeLessThan(1_000);
 });
 it('never waits past the call deadline or the runner wait cap, then cancels',async()=>{
  vi.useFakeTimers();
  try{
   const r=waiting(null);const outcome=createBackendInvoker(r.runner,async()=>({...record,compiled:'bundle'}))(call()).then(()=>'completed',(e:FieldFailed)=>e.code);
   await vi.advanceTimersByTimeAsync(15_900);expect(r.cancelled()).toBe(0);
   await vi.advanceTimersByTimeAsync(200);expect(await outcome).toBe('deadline');expect(r.cancelled()).toBe(1);
   expect(r.waits.length).toBeLessThanOrEqual(2);expect(r.waits.every(w=>w>=0&&w<=RESOLVER_LIMITS.appWaitMs&&w<=RESOLVER_LIMITS.runWaitMs)).toBe(true);
  }finally{vi.useRealTimers();}
 });
 it('stops waiting and cancels the run as soon as the caller aborts',async()=>{
  const r=waiting(null);const controller=new AbortController();const began=Date.now();
  const outcome=createBackendInvoker(r.runner,async()=>({...record,compiled:'bundle'}))(call(controller.signal)).then(()=>'completed',(e:FieldFailed)=>e.code);
  setTimeout(()=>controller.abort(),30);
  expect(await outcome).toBe('deadline');expect(r.cancelled()).toBe(1);expect(Date.now()-began).toBeLessThan(1_000);
 });
});
describe('owner-only resolver failure detail',()=>{
 const call={namespace:'shop',fileId:'backend1',version:'v1',operation:'query' as const,field:'test',args:{},principal:{tenant:'page1',subject:'owner1',role:'owner' as const},signal:new AbortController().signal};
 const SECRET='s3cr3t+/value=';
 const failing=(reason:string|null,requests:{status:number|null}[]=[])=>({start:async()=>({runId:'run1'}),getRun:async()=>({runId:'run1',status:'failed',output:null,receipt:{reason,requests:requests.map(r=>({service:'fetch',operation:'artifactbin.pageBackend.fetch',durationMs:1,requestId:null,...r}))}}),cancel:async()=>{}}) as unknown as RunnerService;
 const invoke=(reason:string|null,requests?:{status:number|null}[])=>createBackendInvoker(failing(reason,requests),async()=>({...record,secretBindings:['KEY','GONE']}),{readSecret:async(_b,name)=>{if(name==='GONE')throw Error('backend_secret_unavailable');return SECRET;}})(call).then(()=>{throw Error('completed');},(e:FieldFailed)=>e);
 it('passes caps.fetch refusal codes and runner reasons through under backend_failed',async()=>{
  expect(await invoke('secret_host_forbidden: KEY')).toMatchObject({name:'FieldFailed',code:'backend_failed',detail:'secret_host_forbidden: KEY'});
  expect((await invoke('timeout')).detail).toBe('timeout');
  expect((await invoke(null)).detail).toBeUndefined();
 });
 it('names the upstream HTTP status the resolver threw on',async()=>{
  expect((await invoke('Upstream refused',[{status:200},{status:401}])).detail).toBe('HTTP 401: Upstream refused');
  expect((await invoke('bad shape',[{status:200}])).detail).toBe('bad shape');
 });
 it('redacts secret values in every encoded form, URL queries and header values, and never includes a stack',async()=>{
  const b64=Buffer.from(SECRET).toString('base64');
  const detail=(await invoke(`leaked ${SECRET} ${encodeURIComponent(SECRET)} ${b64} at https://user:pw@api.example.com/v1/items?key=abc#frag Authorization: Bearer tok123 x-api-key=k9 access_token=at7 cookie: sid=c0\n    at test (resolver.js:1:2)\n    at run (worker.mjs:9:9)`)).detail!;
  expect(detail).not.toContain(SECRET);expect(detail).not.toContain(encodeURIComponent(SECRET));expect(detail).not.toContain(b64);
  expect(detail).toContain('[redacted]');expect(detail).toContain('https://api.example.com/v1/items');
  for(const leak of ['key=abc','frag','user:pw','tok123','k9','at7','c0','resolver.js','\n'])expect(detail).not.toContain(leak);
 });
 it('redacts before truncating, so no secret prefix survives the length bound',async()=>{
  const detail=(await invoke(`${'x'.repeat(190)}${SECRET}`)).detail!;
  expect(detail).not.toContain(SECRET.slice(0,6));
  // Prose that merely mentions a token keeps its words.
  expect((await invoke('GitHub refused the token: Bad credentials')).detail).toBe('GitHub refused the token: Bad credentials');expect(detail.length).toBeLessThanOrEqual(300);
 });
 it('shows the detail to the page owner only',async()=>{
  const schema=composePageSchema([{name:'shop',fileId:'backend1',version:'v1',typeDefs:'type Query { test: String }'}]);
  const run=createBackendInvoker(failing(`401 from upstream with ${SECRET}`,[{status:401}]),async()=>({...record,secretBindings:['KEY']}),{readSecret:async()=>SECRET});
  const errorFor=async(role:'owner'|'editor'|'viewer'|'anonymous'|null)=>(await executePageOperation({schema,request:{query:'query ResolverTest { shop { test } }'},caller:{pageId:'page1',subject:role===null||role==='anonymous'?null:'u1',role},invoke:run,signal:new AbortController().signal})).errors?.[0];
  expect((await errorFor('owner'))?.extensions).toEqual({code:'backend_failed',detail:'HTTP 401: 401 from upstream with [redacted]'});
  for(const role of ['editor','viewer','anonymous'] as const)expect((await errorFor(role))?.extensions).toEqual({code:'backend_failed'});
  // No page role is refused before the resolver runs: no detail either.
  expect((await errorFor(null))?.extensions?.detail).toBeUndefined();
 });
});
describe('a message the resolver code itself throws',()=>{
 const SECRET='s3cr3t+/value=';
 const failing=(reason:string,requests:{status:number|null}[]=[])=>({start:async()=>({runId:'run1'}),getRun:async()=>({runId:'run1',status:'failed',output:null,receipt:{reason,requests:requests.map(r=>({service:'fetch',operation:'artifactbin.pageBackend.fetch',durationMs:1,requestId:null,...r}))}}),cancel:async()=>{}}) as unknown as RunnerService;
 const schema=composePageSchema([{name:'shop',fileId:'backend1',version:'v1',typeDefs:'type Query { note: String }'}]);
 const errorFor=async(reason:string,role:'owner'|'editor'|'viewer'|'anonymous',requests?:{status:number|null}[])=>{
  const invoke=createBackendInvoker(failing(reason,requests),async()=>({...record,secretBindings:['KEY']}),{readSecret:async()=>SECRET});
  return (await executePageOperation({schema,request:{query:'{ shop { note } }'},caller:{pageId:'page1',subject:role==='anonymous'?null:'u1',role},invoke,signal:new AbortController().signal})).errors![0]!;
 };
 it('becomes the error message for every caller; the owner still gets the detail',async()=>{
  for(const role of ['editor','viewer','anonymous'] as const)expect(await errorFor(`${RESOLVER_THREW}Write a note of 1 to 280 characters.`,role)).toMatchObject({message:'Write a note of 1 to 280 characters.',extensions:{code:'backend_failed'}});
  expect((await errorFor(`${RESOLVER_THREW}Upstream refused`,'viewer',[{status:401}])).extensions).toEqual({code:'backend_failed'});
  expect(await errorFor(`${RESOLVER_THREW}Upstream refused`,'owner',[{status:401}])).toMatchObject({message:'Upstream refused',extensions:{code:'backend_failed',detail:'HTTP 401: Upstream refused'}});
 });
 it('is redacted like the detail for everyone: secret values in every encoding, URL queries, credentials, first line, 200 characters',async()=>{
  const b64=Buffer.from(SECRET).toString('base64');
  for(const role of ['viewer','owner'] as const){
   const {message}=await errorFor(`${RESOLVER_THREW}leaked ${SECRET} ${encodeURIComponent(SECRET)} ${b64} at https://user:pw@api.example.com/v1?key=abc Authorization: Bearer tok123\n    at note (resolver.js:1:2)`,role);
   expect(message).toContain('[redacted]');expect(message).toContain('https://api.example.com/v1');
   for(const leak of [SECRET,encodeURIComponent(SECRET),b64,'key=abc','user:pw','tok123','resolver.js','\n'])expect(message).not.toContain(leak);
   const long=(await errorFor(`${RESOLVER_THREW}${'x'.repeat(190)}${SECRET}`,role)).message;
   expect(long.length).toBeLessThanOrEqual(200);expect(long).not.toContain(SECRET.slice(0,6));
  }
 });
 it('never shows a platform failure to a non-owner',async()=>{
  for(const reason of ['timeout','secret_host_forbidden: KEY','Script execution timed out.','worker_exit',`x ${RESOLVER_THREW}not at the start`]){
   for(const role of ['editor','viewer','anonymous'] as const)expect(await errorFor(reason,role)).toEqual({message:'Backend execution failed',path:['shop','note'],extensions:{code:'backend_failed'}});
   expect((await errorFor(reason,'owner')).message).toBe('Backend execution failed');
  }
  expect((await errorFor(`${RESOLVER_THREW}`,'viewer')).message).toBe('Backend execution failed');
 });
});
