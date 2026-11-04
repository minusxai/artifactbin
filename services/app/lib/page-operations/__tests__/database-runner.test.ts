/**
 * `caps.db` through the whole resolver path — compiled backend, real runner and worker, controller tunnel — for each
 * kind, against minimal loopback servers that speak just enough of its wire protocol: one that echoes the password
 * it is sent back in its error (Postgres: sent in clear on request; MySQL: decrypted from caching_sha2_password's RSA
 * exchange with a key the server makes), and one that never answers. (Real servers are the integration tests,
 * database-postgres.test.ts and database-mysql.test.ts.) What readers can see never carries the password; a run that
 * ends, is cancelled or loses its worker closes its sockets; a name the page does not declare is refused.
 */
import {execFileSync,type ChildProcess} from 'node:child_process';
import {constants,generateKeyPairSync,privateDecrypt,randomBytes} from 'node:crypto';
import {once} from 'node:events';
import net from 'node:net';
import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {createRunner} from '@artifactbin/runner/local';
import {CHUNK_BYTES,DATABASE_KINDS,DATABASE_OPERATION,WINDOW_BYTES} from '@artifactbin/runner/worker-database';
import {RESOLVER_DATABASE_KINDS,RESOLVER_DATABASE_LIMITS,RESOLVER_DATABASE_OPERATION,type RunnerService,type RunStart} from '@artifactbin/contracts';
import {createBackendCompiler,createBackendInvoker,pageBackendCapability,type PageBackendRecord} from '../backend';
import {createResolverFetch} from '../public-fetch';

/**
 * Every process the runner spawns, by pid: a test that kills workers waits for their exits, which the pool hears
 * first (its listener came first), so the next run is never handed a spare that is dead but not yet known to be.
 */
const spawned=vi.hoisted(()=>new Map<number,ChildProcess>());
vi.mock('node:child_process',async original=>{
 const real=await original<typeof import('node:child_process')>();
 return {...real,spawn:((...args:Parameters<typeof real.spawn>)=>{const child=(real.spawn as (...a:unknown[])=>ChildProcess)(...args);if(child.pid)spawned.set(child.pid,child);return child;}) as typeof real.spawn};
});

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
/**
 * A MySQL server that asks for caching_sha2_password, demands full authentication, hands out its own RSA key,
 * decrypts the password the client sends with it and answers an access-denied error quoting that password.
 */
function echoingMysqlServer(){
 const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
 const pem=publicKey.export({type:'spki',format:'pem'});
 return net.createServer(socket=>{
  socket.on('error',()=>{});
  const scramble=randomBytes(20).map(b=>b%94+33);
  const packet=(seq:number,payload:Buffer)=>{const head=Buffer.alloc(4);head.writeUIntLE(payload.length,0,3);head[3]=seq;socket.write(Buffer.concat([head,payload]));};
  const caps=0x1|0x8|0x200|0x8000|0x80000|0x200000;
  const flags=Buffer.alloc(2);
  packet(0,Buffer.concat([Buffer.from([10]),Buffer.from('8.0.99-echo\0'),Buffer.from([1,0,0,0]),scramble.subarray(0,8),Buffer.from([0]),(flags.writeUInt16LE(caps&0xffff),Buffer.from(flags)),Buffer.from([255,2,0]),(flags.writeUInt16LE(caps>>>16),Buffer.from(flags)),Buffer.from([21]),Buffer.alloc(10),scramble.subarray(8),Buffer.from([0]),Buffer.from('caching_sha2_password\0')]));
  let buffered=Buffer.alloc(0),step=0;
  socket.on('data',b=>{
   buffered=Buffer.concat([buffered,b]);
   while(buffered.length>=4&&buffered.length>=4+buffered.readUIntLE(0,3)){
    const length=buffered.readUIntLE(0,3),seq=buffered[3]!,body=buffered.subarray(4,4+length);buffered=buffered.subarray(4+length);
    step++;
    if(step===1)packet(seq+1,Buffer.concat([Buffer.from([0xfe]),Buffer.from('caching_sha2_password\0'),scramble,Buffer.from([0])]));
    else if(step===2)packet(seq+1,Buffer.from([1,4]));
    else if(step===3)packet(seq+1,Buffer.concat([Buffer.from([1]),Buffer.from(pem)]));
    else{
     const mixed=privateDecrypt({key:privateKey,oaepHash:'sha1',padding:constants.RSA_PKCS1_OAEP_PADDING},body);
     const sent=Buffer.from(mixed.map((v,i)=>v^scramble[i%scramble.length]!)).toString().replace(/\0$/,'');
     const code=Buffer.alloc(2);code.writeUInt16LE(1045);
     packet(seq+1,Buffer.concat([Buffer.from([0xff]),code,Buffer.from('#28000'),Buffer.from(`Access denied: password "${sent}" was rejected`)]));
     socket.end();
    }
   }
  });
 });
}
/**
 * A MySQL server that accepts any login, then answers every statement but the session's time zone with a LOCAL
 * INFILE request for a worker file. It records the client's capability flags and every byte sent after a request.
 */
const hostile={flags:[] as number[],infile:[] as Buffer[]};
function hostileMysqlServer(){
 return net.createServer(socket=>{
  socket.on('error',()=>{});
  const packet=(seq:number,payload:Buffer)=>{const head=Buffer.alloc(4);head.writeUIntLE(payload.length,0,3);head[3]=seq;socket.write(Buffer.concat([head,payload]));};
  const ok=(seq:number)=>packet(seq,Buffer.from([0,0,0,2,0,0,0]));
  const caps=0x1|0x8|0x80|0x200|0x8000|0x10000|0x80000|0x200000,flags=Buffer.alloc(2),scramble=randomBytes(20).map(b=>b%94+33);
  packet(0,Buffer.concat([Buffer.from([10]),Buffer.from('8.0.99-hostile\0'),Buffer.from([2,0,0,0]),scramble.subarray(0,8),Buffer.from([0]),(flags.writeUInt16LE(caps&0xffff),Buffer.from(flags)),Buffer.from([255,2,0]),(flags.writeUInt16LE(caps>>>16),Buffer.from(flags)),Buffer.from([21]),Buffer.alloc(10),scramble.subarray(8),Buffer.from([0]),Buffer.from('mysql_native_password\0')]));
  let buffered=Buffer.alloc(0),authed=false,requested=false;
  socket.on('data',b=>{
   buffered=Buffer.concat([buffered,b]);
   while(buffered.length>=4&&buffered.length>=4+buffered.readUIntLE(0,3)){
    const length=buffered.readUIntLE(0,3),seq=buffered[3]!,body=buffered.subarray(4,4+length);buffered=buffered.subarray(4+length);
    if(!authed){authed=true;hostile.flags.push(body.readUInt32LE(0));ok(seq+1);}
    else if(requested){hostile.infile.push(Buffer.from(body));if(!length){requested=false;ok(seq+1);}}
    else if(body.subarray(1).toString().startsWith('SET time_zone'))ok(seq+1);
    else{requested=true;packet(seq+1,Buffer.concat([Buffer.from([0xfb]),Buffer.from('/etc/passwd')]));}
   }
  });
 });
}
const sockets:net.Socket[]=[],closed:net.Socket[]=[];
/** A server that reads everything and answers nothing (reading, so it sees the peer close). */
function silentServer(){return net.createServer(socket=>{sockets.push(socket);socket.resume();socket.on('error',()=>{});socket.on('close',()=>closed.push(socket));});}
const listen=(s:net.Server)=>new Promise<number>(r=>s.listen(0,'127.0.0.1',()=>r((s.address() as net.AddressInfo).port)));

const SOURCE=`export const secrets={WAREHOUSE:'postgres',SILENT:'postgres',SHOP:'mysql',SILENT_MY:'mysql',HOSTILE:'mysql',API_KEY:'api.example.com'};
export const typeDefs="type Query { caught(name:String!): String rethrown(name:String!): String wrapped(name:String!): String refusals: String hang(name:String!): String infile: String }";
export default {
 caught: async({name},p,caps)=>{const db=await caps.db(name);try{await db.query('select 1');return 'ran';}catch(e){return JSON.stringify({code:e.code,message:e.message,stack:String(e.stack),own:Object.keys(e)});}},
 rethrown: async({name},p,caps)=>{const db=await caps.db(name);await db.query('select 1');return 'ran';},
 wrapped: async({name},p,caps)=>{const db=await caps.db(name);try{await db.query('select 1');}catch(e){throw new Error('wrapped '+e.message);}return 'ran';},
 refusals: async(a,p,caps)=>{
  const code=f=>f().then(()=>'ran',e=>e.code??e.message);
  return JSON.stringify({
   missing:await code(()=>caps.db('MISSING')),
   fetchSecret:await code(()=>caps.db('API_KEY')),
   badName:await code(()=>caps.db('lower')),
   direct:await code(()=>globalThis.__capabilities.artifactbin.call('pageBackend.db',{name:'WAREHOUSE'})),
   directMysql:await code(()=>globalThis.__capabilities.artifactbin.call('pageBackend.db',{name:'SHOP'})),
   asFetch:await code(()=>caps.fetch('https://api.example.com/?p={{WAREHOUSE}}')),
   asFetchMysql:await code(()=>caps.fetch('https://api.example.com/?p={{SHOP}}')),
   // caps.postgres is gone, with no alias; the old operation is refused like any unknown one.
   postgres:typeof caps.postgres,
   oldOperation:await code(()=>globalThis.__capabilities.artifactbin.call('pageBackend.postgres',{name:'WAREHOUSE'})),
  });
 },
 hang: async({name},p,caps)=>{const db=await caps.db(name);await db.query('select 1');return 'answered';},
 infile: async(a,p,caps)=>{const db=await caps.db('HOSTILE');try{await db.query("select 'anything'");return 'ran';}catch(e){return e.code+': '+e.message;}finally{await db.end();}},
};`;

let runner:Awaited<ReturnType<typeof createRunner>>,db:PGlite,record:PageBackendRecord,invoke:ReturnType<typeof createBackendInvoker>,silent:net.Server;
const servers:net.Server[]=[];const runIds:string[]=[];
beforeAll(async()=>{
 const echo=echoingServer(),echoMysql=echoingMysqlServer(),hostileMysql=hostileMysqlServer();silent=silentServer();servers.push(echo,echoMysql,silent,hostileMysql);
 const silentPort=await listen(silent),base={host:'127.0.0.1',database:'d',user:'u',password:PASSWORD,tls:'disable'};
 const values:Record<string,string>={
  WAREHOUSE:JSON.stringify({...base,kind:'postgres',port:await listen(echo)}),
  SILENT:JSON.stringify({...base,kind:'postgres',port:silentPort}),
  SHOP:JSON.stringify({...base,kind:'mysql',port:await listen(echoMysql)}),
  SILENT_MY:JSON.stringify({...base,kind:'mysql',port:silentPort}),
  HOSTILE:JSON.stringify({...base,kind:'mysql',port:await listen(hostileMysql)}),
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
const call=(field:string,signal=new AbortController().signal,args:Record<string,string>={})=>({namespace:'db',fileId:'b1',version:'v1',operation:'query' as const,field,args,principal:{tenant:'page1',subject:'owner1',role:'owner' as const},signal});
const failure=(field:string,name:string)=>invoke(call(field,undefined,{name})).then(()=>{throw Error('expected a failure');},(e:{code:string;detail?:string;shown?:string})=>e);

describe('the password stays out of everything a reader or the owner can see',()=>{
 it('declares connections as secrets bound to their database kind',()=>{
  expect(record).toMatchObject({secretBindings:['API_KEY','HOSTILE','SHOP','SILENT','SILENT_MY','WAREHOUSE'],secretHosts:{WAREHOUSE:'postgres',SILENT:'postgres',SHOP:'mysql',SILENT_MY:'mysql',HOSTILE:'mysql',API_KEY:'api.example.com'}});
 });
 const echoed={postgres:{name:'WAREHOUSE',message:'28P01 password "[redacted]" was rejected'},mysql:{name:'SHOP',message:'28000 Access denied: password "[redacted]" was rejected'}};
 describe.each(Object.entries(echoed))('%s',(_kind,{name,message})=>{
  it('redacts it from a driver error resolver code catches, which carries no settings either',async()=>{
   const out=JSON.parse(await invoke(call('caught',undefined,{name})) as string);
   expect(out).toMatchObject({code:'database_error',message});
   expect(JSON.stringify(out)).not.toContain(PASSWORD);expect(JSON.stringify(out)).not.toContain('127.0.0.1');
  },20000);
  it('redacts it from a failed run\'s reason, owner detail and resolver-thrown message',async()=>{
   const rethrown=await failure('rethrown',name);
   expect(rethrown.code).toBe('backend_failed');expect(rethrown.detail).toContain('[redacted]');
   // An uncaught capability refusal keeps its code in the owner's detail (Test connection reads it).
   expect(rethrown.detail).toBe('database_error: '+message);
   const wrapped=await failure('wrapped',name);
   expect(wrapped.shown).toBe('wrapped '+message);
   for(const e of [rethrown,wrapped])expect(JSON.stringify({...e,message:(e as unknown as Error).message})).not.toContain(PASSWORD);
  },20000);
 });
 it('never stores it in the runner\'s runs, receipts or events',async()=>{
  await until(()=>runIds.length>=6);
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
  expect(JSON.parse(await invoke(call('refusals')) as string)).toEqual({missing:'unknown_connection',fetchSecret:'unknown_connection',badName:'invalid_request',direct:'backend_capability_forbidden',directMysql:'backend_capability_forbidden',
   asFetch:'secret_host_forbidden: WAREHOUSE',asFetchMysql:'secret_host_forbidden: SHOP',postgres:'undefined',oldOperation:'backend_capability_forbidden'});
 },20000);
 it('mysql: offers neither LOCAL INFILE nor multiple statements, and sends no file when a server asks for one',async()=>{
  const answer=await invoke(call('infile')) as string;
  expect(answer).toMatch(/^database_error: As a result of LOCAL INFILE command server wants to read \/etc\/passwd file/);
  // CLIENT_LOCAL_FILES (0x80) and CLIENT_MULTI_STATEMENTS (0x10000) off; an empty packet is all the server got.
  expect(hostile.flags.length).toBe(1);expect(hostile.flags[0]!&0x80).toBe(0);expect(hostile.flags[0]!&0x10000).toBe(0);
  expect(hostile.infile.map(b=>b.length)).toEqual([0]);
 },20000);
 it('refuses the connection operation for another page\'s admitted run, a forged program and another owner',async()=>{
  const read=async()=>{throw Error('must not read');};
  const request:RunStart={requestId:'r',pageBackendOperation:'query',userId:'owner1',artifactId:'b1',artifactVersion:'v1',program:{source:record.compiled,language:'javascript'},input:{kind:'invoke',principal:{tenant:'page1',subject:null}}};
  const forgeries:RunStart[]=[{...request,input:{kind:'invoke',principal:{tenant:'page2',subject:null}}},{...request,program:{source:'forged',language:'javascript'}},{...request,userId:'owner2'},{...request,input:{kind:'schema'}}];
  for(const forged of forgeries)
   for(const name of ['WAREHOUSE','SHOP'])await expect(pageBackendCapability(forged,RESOLVER_DATABASE_OPERATION,{name},async()=>record,read)).rejects.toThrow('backend_capability_forbidden');
 });
});

describe.each([['postgres','SILENT'],['mysql','SILENT_MY']])('every %s tunnel closes with its run',(_kind,name)=>{
 const hung=async(start:(signal:AbortController)=>Promise<unknown>,end:(controller:AbortController)=>void)=>{
  // The tunnel's own connection, not a socket count polled against a budget; a run that ends first fails at once.
  const controller=new AbortController(),opened=once(silent,'connection').then(([socket])=>({socket:socket as net.Socket}));
  const outcome=start(controller).catch(e=>e);
  const first=await Promise.race([opened,outcome.then(ended=>({ended}))]);
  if(!('socket' in first))throw Error('the run ended before its tunnel opened: '+JSON.stringify(first.ended));
  const {socket}=first;expect(closed).not.toContain(socket);
  const ended=Date.now();end(controller);
  if(!closed.includes(socket))await once(socket,'close');
  return {outcome:await outcome,closedAfterMs:Date.now()-ended};
 };
 it('when the reader cancels the call',async()=>{
  const {outcome,closedAfterMs}=await hung(c=>invoke(call('hang',c.signal,{name})),c=>c.abort());
  expect((outcome as {code:string}).code).toBe('deadline');expect(closedAfterMs).toBeLessThan(3000);
 },20000);
 it('when the run reaches its time limit',async()=>{
  const {outcome}=await hung(c=>invoke(call('hang',c.signal,{name})),()=>{});
  expect((outcome as {code:string}).code).toBe('backend_failed');expect((outcome as {detail:string}).detail).toBe('timeout');
 },20000);
 it('when the worker is killed',async()=>{
  let killed:ChildProcess[]=[];
  const {outcome,closedAfterMs}=await hung(c=>invoke(call('hang',c.signal,{name})),()=>{
   // Every worker of this process (spares too); the pool replaces them.
   const children=execFileSync('ps',['-A','-o','pid=,ppid=,command=']).toString().split('\n').map(l=>l.trim().split(/\s+/)).filter(([,ppid,...cmd])=>Number(ppid)===process.pid&&/runner-worker\.mjs|docker start/.test(cmd.join(' ')));
   expect(children.length).toBeGreaterThan(0);
   killed=children.map(([pid])=>spawned.get(Number(pid))!);expect(killed).not.toContain(undefined);
   for(const [pid] of children)process.kill(Number(pid),'SIGKILL');
  });
  expect((outcome as {code:string}).code).toBe('backend_failed');expect(closedAfterMs).toBeLessThan(3000);
  // The run ends with its own worker; the killed spares' exits are the pool's to hear before the next run takes one.
  await Promise.all(killed.map(child=>child.exitCode!==null||child.signalCode!==null||once(child,'exit')));
 },20000);
});

it('keeps the worker\'s window, chunk, operation and drivers equal to the contracts\' (the worker runs without them)',()=>{
 expect(WINDOW_BYTES).toBe(RESOLVER_DATABASE_LIMITS.windowBytes);expect(CHUNK_BYTES).toBe(RESOLVER_DATABASE_LIMITS.chunkBytes);
 expect(DATABASE_OPERATION).toBe(RESOLVER_DATABASE_OPERATION);expect(DATABASE_KINDS).toEqual([...RESOLVER_DATABASE_KINDS]);
});
