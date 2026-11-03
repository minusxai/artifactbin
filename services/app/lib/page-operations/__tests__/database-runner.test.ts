/**
 * `caps.postgres` through the whole resolver path — compiled backend, real runner and worker, controller tunnel —
 * against minimal loopback servers that speak just enough of the Postgres wire protocol: one that echoes the
 * cleartext password it is sent back in its error, and one that never answers. (A real server is the
 * integration test, database-postgres.test.ts.) What readers can see never carries the password; a run that ends,
 * is cancelled or loses its worker closes its sockets; a name the page does not declare is refused.
 */
import {execFileSync} from 'node:child_process';
import net from 'node:net';
import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {createRunner} from '@artifactbin/runner/local';
import {CHUNK_BYTES,WINDOW_BYTES} from '@artifactbin/runner/worker-database';
import {RESOLVER_DATABASE_LIMITS,type RunnerService,type RunStart} from '@artifactbin/contracts';
import {createBackendCompiler,createBackendInvoker,pageBackendCapability,type PageBackendRecord} from '../backend';
import {createResolverFetch} from '../public-fetch';

const PASSWORD='pg-pa55word-0f-the-0wner';
const until=async(check:()=>boolean,ms=8000)=>{const end=Date.now()+ms;while(!check()){if(Date.now()>end)throw Error('timed out');await new Promise(r=>setTimeout(r,10));}};

/** A server answering a startup with "send your password in clear", then an error quoting the password back. */
function echoingServer(){
 const s=net.createServer(socket=>{
  socket.on('error',()=>{});let buffered=Buffer.alloc(0),started=false;
  socket.on('data',b=>{
   buffered=Buffer.concat([buffered,b]);
   if(!started&&buffered.length>=8&&buffered.length>=buffered.readInt32BE(0)){started=true;buffered=buffered.subarray(buffered.readInt32BE(0));socket.write(Buffer.from([0x52,0,0,0,8,0,0,0,3]));}
   if(started&&buffered.length>=5&&buffered[0]===0x70&&buffered.length>=1+buffered.readInt32BE(1)){
    const sent=buffered.subarray(5,1+buffered.readInt32BE(1)-1).toString();
    const fields=Buffer.concat([Buffer.from('SFATAL\0'),Buffer.from('C28P01\0'),Buffer.from(`Mpassword "${sent}" was rejected\0`),Buffer.from('\0')]);
    const head=Buffer.alloc(5);head[0]=0x45;head.writeInt32BE(4+fields.length,1);socket.end(Buffer.concat([head,fields]));
   }
  });
 });
 return s;
}
const sockets:net.Socket[]=[],closed:net.Socket[]=[];
/** A server that reads everything and answers nothing (reading, so it sees the peer close). */
function silentServer(){return net.createServer(socket=>{sockets.push(socket);socket.resume();socket.on('error',()=>{});socket.on('close',()=>closed.push(socket));});}
const listen=(s:net.Server)=>new Promise<number>(r=>s.listen(0,'127.0.0.1',()=>r((s.address() as net.AddressInfo).port)));

const SOURCE=`export const secrets={WAREHOUSE:'postgres',SILENT:'postgres',API_KEY:'api.example.com'};
export const typeDefs="type Query { caught: String rethrown: String wrapped: String refusals: String hang: String }";
export default {
 caught: async(a,p,caps)=>{const db=await caps.postgres('WAREHOUSE');try{await db.query('select 1');return 'ran';}catch(e){return JSON.stringify({code:e.code,message:e.message,stack:String(e.stack),own:Object.keys(e)});}},
 rethrown: async(a,p,caps)=>{const db=await caps.postgres('WAREHOUSE');await db.query('select 1');return 'ran';},
 wrapped: async(a,p,caps)=>{const db=await caps.postgres('WAREHOUSE');try{await db.query('select 1');}catch(e){throw new Error('wrapped '+e.message);}return 'ran';},
 refusals: async(a,p,caps)=>{
  const code=f=>f().then(()=>'ran',e=>e.code??e.message);
  return JSON.stringify({
   missing:await code(()=>caps.postgres('MISSING')),
   fetchSecret:await code(()=>caps.postgres('API_KEY')),
   badName:await code(()=>caps.postgres('lower')),
   direct:await code(()=>globalThis.__capabilities.artifactbin.call('pageBackend.postgres',{name:'WAREHOUSE'})),
   asFetch:await code(()=>caps.fetch('https://api.example.com/?p={{WAREHOUSE}}')),
  });
 },
 hang: async(a,p,caps)=>{const db=await caps.postgres('SILENT');await db.query('select 1');return 'answered';},
};`;

let runner:Awaited<ReturnType<typeof createRunner>>,db:PGlite,record:PageBackendRecord,invoke:ReturnType<typeof createBackendInvoker>;
const servers:net.Server[]=[];const runIds:string[]=[];
beforeAll(async()=>{
 const echo=echoingServer(),silent=silentServer();servers.push(echo,silent);
 const values:Record<string,string>={
  WAREHOUSE:JSON.stringify({host:'127.0.0.1',port:await listen(echo),database:'d',user:'u',password:PASSWORD,tls:'disable'}),
  SILENT:JSON.stringify({host:'127.0.0.1',port:await listen(silent),database:'d',user:'u',password:PASSWORD,tls:'disable'}),
 };
 const readSecret=async(_b:PageBackendRecord,name:string)=>values[name]??Promise.reject(Error('backend_secret_unavailable'));
 db=new PGlite();
 // The development opt-in: these fake databases are on loopback and speak no TLS.
 runner=await createRunner({db,dockerImage:process.env.RUNNER_TEST_IMAGE,database:{allowLoopback:true},ceilings:{timeoutMs:2000},
  capabilities:async(ctx,operation,args)=>pageBackendCapability(ctx.request,operation,args,async()=>record,readSecret,createResolverFetch(),undefined,ctx.signal)});
 record={...(await createBackendCompiler(runner)(SOURCE)),source:SOURCE,backendId:'b1',pageId:'page1',version:'v1',ownerId:'owner1'};
 const recording:RunnerService={...runner,start:async(input:RunStart)=>{const admitted=await runner.start(input);runIds.push(admitted.runId);return admitted;}};
 invoke=createBackendInvoker(recording,async()=>record,{readSecret,startRetryDelaysMs:[1]});
},30000);
afterAll(async()=>{await runner?.close();await db?.close();for(const s of servers)s.close();});
const call=(field:string,signal=new AbortController().signal)=>({namespace:'db',fileId:'b1',version:'v1',operation:'query' as const,field,args:{},principal:{tenant:'page1',subject:'owner1',role:'owner' as const},signal});
const failure=(field:string)=>invoke(call(field)).then(()=>{throw Error('expected a failure');},(e:{code:string;detail?:string;shown?:string})=>e);

describe('the password stays out of everything a reader or the owner can see',()=>{
 it('declares connections as secrets bound to postgres',()=>{
  expect(record).toMatchObject({secretBindings:['API_KEY','SILENT','WAREHOUSE'],secretHosts:{WAREHOUSE:'postgres',SILENT:'postgres',API_KEY:'api.example.com'}});
 });
 it('redacts it from a driver error resolver code catches, which carries no settings either',async()=>{
  const out=JSON.parse(await invoke(call('caught')) as string);
  expect(out).toMatchObject({code:'database_error',message:'28P01 password "[redacted]" was rejected'});
  expect(JSON.stringify(out)).not.toContain(PASSWORD);expect(JSON.stringify(out)).not.toContain('127.0.0.1');
 },20000);
 it('redacts it from a failed run\'s reason, owner detail and resolver-thrown message',async()=>{
  const rethrown=await failure('rethrown');
  expect(rethrown.code).toBe('backend_failed');expect(rethrown.detail).toContain('[redacted]');
  const wrapped=await failure('wrapped');
  expect(wrapped.shown).toBe('wrapped 28P01 password "[redacted]" was rejected');
  for(const e of [rethrown,wrapped])expect(JSON.stringify({...e,message:(e as unknown as Error).message})).not.toContain(PASSWORD);
 },20000);
 it('never stores it in the runner\'s runs, receipts or events',async()=>{
  await until(()=>runIds.length>=3);
  for(const runId of runIds){
   const snapshot=await runner.getRun({userId:'owner1',runId});
   expect(JSON.stringify(snapshot)).not.toContain(PASSWORD);
   expect(JSON.stringify(await runner.events({userId:'owner1',runId,afterSequence:0}))).not.toContain(PASSWORD);
  }
  const rows=await db.query('SELECT * FROM runner_runs');expect(rows.rows.length).toBeGreaterThan(0);
  expect(JSON.stringify(rows.rows)).not.toContain(PASSWORD);
  expect(JSON.stringify((await db.query('SELECT * FROM runner_events')).rows)).not.toContain(PASSWORD);
 });
});

describe('refusals',()=>{
 it('refuses a name the page does not declare, a fetch secret, resolver code asking for the settings directly, and fetch filling a connection',async()=>{
  expect(JSON.parse(await invoke(call('refusals')) as string)).toEqual({missing:'unknown_connection',fetchSecret:'unknown_connection',badName:'invalid_request',direct:'backend_capability_forbidden',asFetch:'secret_host_forbidden: WAREHOUSE'});
 },20000);
 it('refuses the connection operation for another page\'s admitted run, a forged program and another owner',async()=>{
  const read=async()=>{throw Error('must not read');};
  const request:RunStart={requestId:'r',pageBackendOperation:'query',userId:'owner1',artifactId:'b1',artifactVersion:'v1',program:{source:record.compiled,language:'javascript'},input:{kind:'invoke',principal:{tenant:'page1',subject:null}}};
  const forgeries:RunStart[]=[{...request,input:{kind:'invoke',principal:{tenant:'page2',subject:null}}},{...request,program:{source:'forged',language:'javascript'}},{...request,userId:'owner2'},{...request,input:{kind:'schema'}}];
  for(const forged of forgeries)
   await expect(pageBackendCapability(forged,'artifactbin.pageBackend.postgres',{name:'WAREHOUSE'},async()=>record,read)).rejects.toThrow('backend_capability_forbidden');
 });
});

describe('every tunnel closes with its run',()=>{
 const hung=async(start:(signal:AbortController)=>Promise<unknown>,end:(controller:AbortController)=>void)=>{
  const before=sockets.length,controller=new AbortController();
  const outcome=start(controller).catch(e=>e);
  await until(()=>sockets.length>before);
  const socket=sockets.at(-1)!;expect(closed).not.toContain(socket);
  const ended=Date.now();end(controller);
  await until(()=>closed.includes(socket));
  return {outcome:await outcome,closedAfterMs:Date.now()-ended};
 };
 it('when the reader cancels the call',async()=>{
  const {outcome,closedAfterMs}=await hung(c=>invoke(call('hang',c.signal)),c=>c.abort());
  expect((outcome as {code:string}).code).toBe('deadline');expect(closedAfterMs).toBeLessThan(3000);
 },20000);
 it('when the run reaches its time limit',async()=>{
  const {outcome}=await hung(c=>invoke(call('hang',c.signal)),()=>{});
  expect((outcome as {code:string}).code).toBe('backend_failed');expect((outcome as {detail:string}).detail).toBe('timeout');
 },20000);
 it('when the worker is killed',async()=>{
  const {outcome,closedAfterMs}=await hung(c=>invoke(call('hang',c.signal)),()=>{
   // Every worker of this process (spares too); the pool replaces them.
   const children=execFileSync('ps',['-A','-o','pid=,ppid=,command=']).toString().split('\n').map(l=>l.trim().split(/\s+/)).filter(([,ppid,...cmd])=>Number(ppid)===process.pid&&/runner-worker\.mjs|docker start/.test(cmd.join(' ')));
   expect(children.length).toBeGreaterThan(0);
   for(const [pid] of children)process.kill(Number(pid),'SIGKILL');
  });
  expect((outcome as {code:string}).code).toBe('backend_failed');expect(closedAfterMs).toBeLessThan(3000);
 },20000);
});

it('keeps the worker\'s window and chunk within the controller\'s limits',()=>{
 expect(WINDOW_BYTES).toBe(RESOLVER_DATABASE_LIMITS.windowBytes);expect(CHUNK_BYTES).toBe(RESOLVER_DATABASE_LIMITS.chunkBytes);
});
