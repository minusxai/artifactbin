import {it,expect} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {createRunner} from '@artifactbin/runner/local';
import {createBackendCompiler,createBackendInvoker,pageBackendCapability,type PageBackendRecord} from '../backend';
it('executes a compiled immutable backend through the retained isolated runner',async()=>{
 const db=new PGlite();let record:PageBackendRecord;let value:import('@artifactbin/contracts').HtmlJson=null,version=0;
 const store={get:async()=>({value,version}),set:async(_id:string,next:typeof value,expected:number)=>{if(expected!==version)return {ok:false,version};value=next;return {ok:true,version:++version};}};
 const runner=await createRunner({dockerImage:process.env.RUNNER_TEST_IMAGE,db,capabilities:async(context,operation,args)=>pageBackendCapability(store,context.request,operation,args,async()=>record,async url=>({status:200,url,contentType:'application/json',body:'{"value":"public"}'}),async(backend,name)=>backend.ownerId==='owner1'&&name==='TOKEN'?'server-only-token':Promise.reject(Error('forbidden')))});
 try{
  const source='export const secretBindings=["TOKEN"]; export const typeDefs="type Query { count:Int! remote:String! secretReady:Boolean! } type Mutation { add:Int! @auth(role:EDITOR) }"; export default { secretReady:async(args,p,c)=>(await c.secrets.get("TOKEN")).length>0, remote:async(args,principal,caps)=>{const response=await caps.fetch("https://example.com/data");return (await response.json()).value;}, count: async(args,principal,caps)=>(await caps.store.get()).value?.count??0, add:async(args,principal,caps)=>{const s=await caps.store.get();await caps.store.set({count:(s.value?.count??0)+1},{expected:s.version});return principal.tenant==="page1"?1:0;} };';
  record={...(await createBackendCompiler(runner)(source)),source,backendId:'backend1',pageId:'page1',version:'v1',ownerId:'owner1'};
  expect(record.secretBindings).toEqual(['TOKEN']);expect(record.compiled).not.toContain('server-only-token');
  expect(record.api).toBe(1);expect(record.secretHosts).toEqual({});
  expect(await createBackendCompiler(runner)('export const secrets={API_KEY:"api.example.com"}; export const typeDefs="type Query { test: String! @auth(role: OWNER) }"; export default { test:()=>"ok" };')).toMatchObject({secretBindings:['API_KEY'],secretHosts:{API_KEY:'api.example.com'},api:2,test:true});
  const invoke=createBackendInvoker(runner,async()=>record);
  const call={namespace:'tasks',fileId:'backend1',version:'v1',operation:'mutation' as const,field:'add',args:{},principal:{tenant:'page1',subject:'viewer1',role:'viewer' as const},signal:new AbortController().signal};
  expect(await invoke(call)).toBe(1);expect(value).toEqual({count:1});expect(version).toBe(1);
  await expect(invoke({...call,operation:'query',field:'add',args:{pageBackendOperation:'mutation'}})).rejects.toThrow();
  expect(version).toBe(1);expect(value).toEqual({count:1});
  expect(await invoke({...call,operation:'query',field:'count'})).toBe(1);
  expect(await invoke({...call,operation:'query',field:'remote'})).toBe('public');
  expect(await invoke({...call,operation:'query',field:'secretReady'})).toBe(true);
 }finally{await runner.close();await db.close();}
},20000);
it('api 2: the host fills secrets, the resolver never sees a value, and a 2 MiB response crosses every link',async()=>{
 const {withHttpServer}=await import('@artifactbin/test-support/net');
 const {useLoopbackLookup}=await import('@artifactbin/utils/node/loopback-lookup');
 const {createResolverFetch}=await import('../public-fetch');
 const {RESOLVER_LIMITS}=await import('@artifactbin/contracts');
 useLoopbackLookup();
 const KEY='s3cr3t/+&value',received:string[]=[];
 const server=await withHttpServer((req,res)=>{const chunks:Buffer[]=[];req.on('data',c=>chunks.push(c));req.on('end',()=>{
  received.push(`${req.headers.authorization} ${req.url} ${Buffer.concat(chunks)}`);
  if(req.url==='/fits'){res.writeHead(200);res.end('x'.repeat(RESOLVER_LIMITS.fetchResponseBytes));return;}
  res.writeHead(200,{'content-type':'application/json','x-echo':String(req.headers.authorization)});res.end(JSON.stringify({url:req.url,authorization:req.headers.authorization}));
 });});
 const db=new PGlite();let record:PageBackendRecord;
 const store={get:async()=>({value:null,version:0}),set:async()=>({ok:true,version:1})};
 // caps.query's host port: echoes the caller it was handed, refuses a mutation as the real one does in a query resolver.
 const {ResolverQueryError}=await import('../query');
 const query=async({caller,operation,args}:{caller:unknown;operation:unknown;args:import('@artifactbin/contracts').RunnerJson})=>{
  const a=args as {query:string;variables:import('@artifactbin/contracts').RunnerJson};
  if(a.query.startsWith('mutation'))throw new ResolverQueryError('permission_denied','a dataset mutation runs only inside a mutation resolver');
  return {caller,operation,variables:a.variables} as import('@artifactbin/contracts').RunnerJson;
 };
 const runner=await createRunner({dockerImage:process.env.RUNNER_TEST_IMAGE,db,capabilities:async(context,operation,args)=>pageBackendCapability(store,context.request,operation,args,async()=>record,undefined,async(_backend,name)=>name==='KEY'?KEY:Promise.reject(Error('backend_secret_unavailable')),createResolverFetch({policy:{allowPrivate:true,allowHttp:true}}),query)});
 try{
  const base=`http://api.localhost:${server.port}`;
  const source=`export const secrets={KEY:"api.localhost"}; export const typeDefs="type Query { probe: String! size: Int! }"; export default {
   probe: async(args,principal,caps)=>{
    const seen={keys:Object.keys(caps),named:typeof caps["sec"+"rets"],role:principal.role};
    seen.query=await caps.query("{ staff { name } }",{team:"red"});
    seen.queryError=await caps.query("mutation { insert_staff_one(object:{}) { _id } }").then(()=>"ran",e=>[e.code,e.message]);
    const host=globalThis.__capabilities.artifactbin;
    seen.direct=await host.call(["pageBackend","secrets","get"].join("."),{name:"KEY"}).then(v=>"leaked "+v,e=>e.message);
    seen.store=await host.call(["pageBackend","store","get"].join("."),{}).then(()=>"open",e=>e.message);
    const r=await caps.fetch("${base}/echo?k={{KEY}}",{method:"POST",headers:{authorization:"Bearer {{KEY}}"},body:"{{KEY}}"});
    seen.response={ok:r.ok,status:r.status,url:r.url,headers:r.headers,text:await r.text()};
    seen.refused=await caps.fetch("https://other.example.com/?k={{KEY}}").then(()=>"sent",e=>e.message);
    return JSON.stringify(seen);
   },
   size: async(args,principal,caps)=>(await (await caps.fetch("${base}/fits")).text()).length };`;
  record={...(await createBackendCompiler(runner)(source)),source,backendId:'backend2',pageId:'page1',version:'v1',ownerId:'owner1'};
  expect(record).toMatchObject({api:2,secretHosts:{KEY:'api.localhost'}});
  const invoke=createBackendInvoker(runner,async()=>record);
  const call={namespace:'conn',fileId:'backend2',version:'v1',operation:'query' as const,field:'probe',args:{},principal:{tenant:'page1',subject:'viewer1',role:'viewer' as const},signal:new AbortController().signal};
  const output=String(await invoke(call));
  for(const form of [KEY,encodeURIComponent(KEY)])expect(output).not.toContain(form);
  expect(received[0]).toBe(`Bearer ${KEY} /echo?k=${encodeURIComponent(KEY)} ${KEY}`);
  // api 2 caps gain query (resolvers plan PR 5): exactly {fetch, query}; the role is the admitted principal's.
  expect(JSON.parse(output)).toEqual({keys:['fetch','query'],named:'undefined',role:'viewer',
   query:{caller:{subject:'viewer1',role:'viewer'},operation:'query',variables:{team:'red'}},
   queryError:['permission_denied','a dataset mutation runs only inside a mutation resolver'],direct:'backend_capability_forbidden',store:'backend_capability_forbidden',
   response:{ok:true,status:200,url:`${base}/echo?k=[redacted]`,headers:expect.objectContaining({'x-echo':'Bearer [redacted]'}),text:JSON.stringify({url:'/echo?k=[redacted]',authorization:'Bearer [redacted]'})},refused:'secret_host_forbidden: KEY'});
  expect(await invoke({...call,field:'size'})).toBe(RESOLVER_LIMITS.fetchResponseBytes);
  const receipts=(await db.query<{receipt:import('@artifactbin/contracts').RunReceipt}>('SELECT receipt FROM runner_runs')).rows.flatMap(row=>row.receipt?.requests??[]).filter(r=>r.service==='fetch');
  expect(receipts).toContainEqual(expect.objectContaining({status:200,fetch:{method:'POST',host:'api.localhost',path:'/echo',bytesIn:expect.any(Number),bytesOut:Buffer.byteLength(KEY),secrets:['KEY']}}));
  expect(JSON.stringify(receipts)).not.toMatch(/k=|Bearer|s3cr3t/);
 }finally{await runner.close();await db.close();await server.close();}
},30000);
it('a resolver\'s own thrown message reaches the caller; caps refusals, non-Error throws and timeouts stay platform failures',async()=>{
 const {withHttpServer}=await import('@artifactbin/test-support/net');
 const {useLoopbackLookup}=await import('@artifactbin/utils/node/loopback-lookup');
 const {createResolverFetch}=await import('../public-fetch');
 const {composePageSchema,executePageOperation}=await import('../namespaces');
 useLoopbackLookup();
 const server=await withHttpServer((_req,res)=>{res.writeHead(200,{'content-type':'text/html'});res.end('<html>private body</html>');});
 const db=new PGlite();let record:PageBackendRecord;
 const store={get:async()=>({value:null,version:0}),set:async()=>({ok:true,version:1})};
 const runner=await createRunner({dockerImage:process.env.RUNNER_TEST_IMAGE,db,capabilities:async(context,operation,args)=>pageBackendCapability(store,context.request,operation,args,async()=>record,undefined,async()=>'k3y-value',createResolverFetch({policy:{allowPrivate:true,allowHttp:true}}))});
 try{
  const source=`export const secrets={KEY:"api.localhost"}; export const typeDefs="type Query { note: String uncaught: String rethrown: String bad: String str: String spin: String }"; export default {
   note: async()=>{const e=Error("Write a note of 1 to 280 characters.\\nsecond line");throw e;},
   uncaught: async(a,p,caps)=>(await caps.fetch("https://other.example.com/?k={{KEY}}")).text(),
   rethrown: async(a,p,caps)=>{try{await caps.fetch("https://other.example.com/?k={{KEY}}");}catch(e){throw Error("Could not reach the API ("+e.message+")");}},
   bad: async(a,p,caps)=>(await caps.fetch("http://api.localhost:${server.port}/")).json(),
   str: async()=>{throw "plain string";},
   spin: async()=>{for(;;){}} };`;
  record={...(await createBackendCompiler(runner)(source)),source,backendId:'backend3',pageId:'page1',version:'v1',ownerId:'owner1'};
  const schema=composePageSchema([{name:'notes',fileId:'backend3',version:'v1',typeDefs:record.typeDefs}]);
  const invoke=createBackendInvoker(runner,async()=>record);
  const ask=async(field:string,role:'owner'|'viewer')=>(await executePageOperation({schema,request:{query:`{ notes { ${field} } }`},caller:{pageId:'page1',subject:'u1',role},invoke,signal:new AbortController().signal})).errors![0]!;
  expect(await ask('note','viewer')).toMatchObject({message:'Write a note of 1 to 280 characters.',extensions:{code:'backend_failed'}});
  expect((await ask('note','viewer')).extensions).toEqual({code:'backend_failed'});
  expect(await ask('note','owner')).toMatchObject({message:'Write a note of 1 to 280 characters.',extensions:{detail:'Write a note of 1 to 280 characters.'}});
  expect((await ask('rethrown','viewer')).message).toBe("Could not reach the API (secret_host_forbidden: KEY)");
  for(const field of ['uncaught','bad','str','spin'])expect(await ask(field,'viewer'),field).toEqual({message:'Backend execution failed',path:['notes',field],extensions:{code:'backend_failed'}});
  expect((await ask('uncaught','owner')).extensions).toEqual({code:'backend_failed',detail:'secret_host_forbidden: KEY'});
 }finally{await runner.close();await db.close();await server.close();}
},30000);
