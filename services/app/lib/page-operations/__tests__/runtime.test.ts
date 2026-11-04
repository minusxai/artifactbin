import {it,expect} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {createRunner} from '@artifactbin/runner/local';
import {createBackendCompiler,createBackendInvoker,pageBackendCapability,type PageBackendRecord} from '../backend';
it('executes a compiled immutable resolver through the retained isolated runner, with caps db, fetch, query and sql only (no caps.postgres)',async()=>{
 const db=new PGlite();let record:PageBackendRecord;
 const runner=await createRunner({dockerImage:process.env.RUNNER_TEST_IMAGE,db,capabilities:async(context,operation,args)=>pageBackendCapability(context.request,operation,args,async()=>record)});
 try{
  const source='export const typeDefs="type Query { double(n:Int!):Int! caps:String! store:String! } type Mutation { add(n:Int!):Int! @auth(role:editor) }"; export default { double:async({n})=>n*2, caps:async(args,principal,caps)=>Object.keys(caps).sort().join(","), store:async(args,principal,caps)=>typeof caps.store+" "+typeof caps.secrets+" "+typeof caps.postgres+" "+typeof globalThis.__capabilities.postgres+" "+typeof globalThis.__capabilities.db, add:async({n})=>n+1 };';
  record={...(await createBackendCompiler(runner)(source)),source,backendId:'backend1',pageId:'page1',version:'v1',ownerId:'owner1'};
  expect(record).toMatchObject({secretBindings:[],secretHosts:{},test:false});
  expect(await createBackendCompiler(runner)('export const secrets={API_KEY:"api.example.com"}; export const typeDefs="type Query { test: String! @auth(role: owner) }"; export default { test:()=>"ok" };')).toMatchObject({secretBindings:['API_KEY'],secretHosts:{API_KEY:'api.example.com'},test:true});
  const invoke=createBackendInvoker(runner,async()=>record);
  const call={namespace:'tasks',fileId:'backend1',version:'v1',operation:'query' as const,field:'double',args:{n:2},principal:{tenant:'page1',subject:'viewer1',role:'viewer' as const},signal:new AbortController().signal};
  expect(await invoke(call)).toBe(4);
  expect(await invoke({...call,operation:'mutation',field:'add',args:{n:1}})).toBe(2);
  expect(await invoke({...call,field:'caps',args:{}})).toBe('db,fetch,query,sql');
  // caps.postgres is gone with no alias, on caps and on the worker's host object alike (caps.db replaced it).
  expect(await invoke({...call,field:'store',args:{}})).toBe('undefined undefined undefined undefined object');
 }finally{await runner.close();await db.close();}
},20000);
it('the host fills secrets, the resolver never sees a value, and a 2 MiB response crosses every link',async()=>{
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
 // caps.query's host port: echoes the caller it was handed, refuses a mutation as the real one does in a query resolver.
 const {ResolverQueryError}=await import('../query');
 const query=async({caller,operation,args}:{caller:unknown;operation:unknown;args:import('@artifactbin/contracts').RunnerJson})=>{
  const a=args as {query:string;variables:import('@artifactbin/contracts').RunnerJson};
  if(a.query.startsWith('mutation'))throw new ResolverQueryError('permission_denied','a dataset mutation runs only inside a mutation resolver');
  return {caller,operation,variables:a.variables} as import('@artifactbin/contracts').RunnerJson;
 };
 // caps.sql's host port: echoes what each call form reached the host as; a write statement is refused as the read door refuses it.
 const sql=async({caller,args}:{caller:unknown;args:import('@artifactbin/contracts').RunnerJson})=>{
  if(JSON.stringify(args).includes('DELETE'))throw new ResolverQueryError('validation_failed','only reads run on /run');
  return {caller,args} as import('@artifactbin/contracts').RunnerJson;
 };
 const runner=await createRunner({dockerImage:process.env.RUNNER_TEST_IMAGE,db,capabilities:async(context,operation,args)=>pageBackendCapability(context.request,operation,args,async()=>record,async(_backend,name)=>name==='KEY'?KEY:Promise.reject(Error('backend_secret_unavailable')),createResolverFetch({policy:{allowPrivate:true,allowHttp:true}}),{query,sql})});
 try{
  const base=`http://api.localhost:${server.port}`;
  const source=`export const secrets={KEY:"api.localhost"}; export const typeDefs="type Query { probe: String! size: Int! many: String! }"; export default {
   probe: async(args,principal,caps)=>{
    const seen={keys:Object.keys(caps),named:typeof caps["sec"+"rets"],role:principal.role};
    seen.query=await caps.query("{ staff { name } }",{team:"red"});
    seen.queryError=await caps.query("mutation { insert_staff_one(object:{}) { _id } }").then(()=>"ran",e=>[e.code,e.message]);
    seen.sql=await caps.sql("SELECT team, count(*) AS n FROM staff GROUP BY team",{min:1});
    seen.sqlBatch=await caps.sql({queries:[{name:"a",sql:"SELECT 1"}],tables:{t:{columns:[{name:"v",type:"number"}],rows:[{v:1}]}}});
    seen.sqlError=await caps.sql("DELETE FROM staff").then(()=>"ran",e=>[e.code,e.message]);
    const host=globalThis.__capabilities.artifactbin;
    seen.direct=await host.call(["pageBackend","secrets","get"].join("."),{name:"KEY"}).then(v=>"leaked "+v,e=>e.message);
    seen.store=await host.call(["pageBackend","store","get"].join("."),{}).then(()=>"open",e=>e.message);
    const r=await caps.fetch("${base}/echo?k={{KEY}}",{method:"POST",headers:{authorization:"Bearer {{KEY}}"},body:"{{KEY}}"});
    seen.response={ok:r.ok,status:r.status,url:r.url,headers:r.headers,text:await r.text()};
    seen.refused=await caps.fetch("https://other.example.com/?k={{KEY}}").then(()=>"sent",e=>e.message);
    return JSON.stringify(seen);
   },
   size: async(args,principal,caps)=>(await (await caps.fetch("${base}/fits")).text()).length,
   many: async(args,principal,caps)=>{let ok=0;try{for(let i=0;i<40;i++){await caps.sql("SELECT 1");ok++;}}catch(e){return ok+" "+e.message;}return ok+" unbounded";} };`;
  record={...(await createBackendCompiler(runner)(source)),source,backendId:'backend2',pageId:'page1',version:'v1',ownerId:'owner1'};
  expect(record).toMatchObject({secretHosts:{KEY:'api.localhost'}});
  const invoke=createBackendInvoker(runner,async()=>record);
  const call={namespace:'conn',fileId:'backend2',version:'v1',operation:'query' as const,field:'probe',args:{},principal:{tenant:'page1',subject:'viewer1',role:'viewer' as const},signal:new AbortController().signal};
  const output=String(await invoke(call));
  for(const form of [KEY,encodeURIComponent(KEY)])expect(output).not.toContain(form);
  expect(received[0]).toBe(`Bearer ${KEY} /echo?k=${encodeURIComponent(KEY)} ${KEY}`);
  // caps is exactly {fetch, query, sql}; the role is the admitted principal's.
  expect(JSON.parse(output)).toEqual({keys:['fetch','query','sql','db'],named:'undefined',role:'viewer',
   query:{caller:{subject:'viewer1',role:'viewer'},operation:'query',variables:{team:'red'}},
   sql:{caller:{subject:'viewer1',role:'viewer'},args:{sql:'SELECT team, count(*) AS n FROM staff GROUP BY team',params:{min:1}}},
   sqlBatch:{caller:{subject:'viewer1',role:'viewer'},args:{queries:[{name:'a',sql:'SELECT 1'}],tables:{t:{columns:[{name:'v',type:'number'}],rows:[{v:1}]}}}},
   sqlError:['validation_failed','only reads run on /run'],
   queryError:['permission_denied','a dataset mutation runs only inside a mutation resolver'],direct:'backend_capability_forbidden',store:'backend_capability_forbidden',
   response:{ok:true,status:200,url:`${base}/echo?k=[redacted]`,headers:expect.objectContaining({'x-echo':'Bearer [redacted]'}),text:JSON.stringify({url:'/echo?k=[redacted]',authorization:'Bearer [redacted]'})},refused:'secret_host_forbidden: KEY'});
  expect(await invoke({...call,field:'size'})).toBe(RESOLVER_LIMITS.fetchResponseBytes);
  // Each caps.sql call is one of the resolver's requests.
  expect(await invoke({...call,field:'many'})).toBe(`${RESOLVER_LIMITS.maxRequests} request_limit`);
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
 const runner=await createRunner({dockerImage:process.env.RUNNER_TEST_IMAGE,db,capabilities:async(context,operation,args)=>pageBackendCapability(context.request,operation,args,async()=>record,async()=>'k3y-value',createResolverFetch({policy:{allowPrivate:true,allowHttp:true}}))});
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
