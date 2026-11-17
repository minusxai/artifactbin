/** A cancelled waiter cannot dispatch later; a closing session continues to own its pool capacity. */
import { expect, it, vi } from 'vitest';
import { SessionPool } from '../src/sessions';
import { openConnection } from '../src/index';

const latch = () => { let resolve!:()=>void; const promise=new Promise<void>(done=>{resolve=done;});return {promise,resolve}; };
const bounds = {size:1,idleMs:1000,waitMs:1000};

it('keeps a retiring session counted until its driver confirms termination', async () => {
  const closing=latch(), stopped=latch();
  let opened=0;
  const pool=new SessionPool({open:async()=>({id:++opened}),close:async()=>{closing.resolve();await stopped.promise;}},bounds);
  const first=pool.use('db',async(_session,discard)=>{discard();return 1;});
  let second:Promise<number>|undefined;
  try {
    await closing.promise;
    second=pool.use('db',async s=>s.id);
    await new Promise(resolve=>setTimeout(resolve,30));
    expect(opened).toBe(1);
    expect(pool.count()).toBe(1);
    stopped.resolve();
    expect(await second).toBe(2);
  } finally { stopped.resolve();await first;await second;await pool.close(); }
});

it('removes a cancelled queue waiter before it can acquire a released session', async () => {
  const entered=latch(), release=latch();
  const pool=new SessionPool({open:async()=>({}),close:async()=>{}},bounds);
  const first=pool.use('db',async()=>{entered.resolve();await release.promise;});
  let ran=0, guard:ReturnType<typeof setTimeout>|undefined;
  type Use = (key:string,work:(s:object,discard:()=>void)=>Promise<void>,context?:{signal?:AbortSignal;timeoutMs?:number})=>Promise<void>;
  const use=pool.use.bind(pool) as Use;
  const controller=new AbortController();
  await entered.promise;
  const queued=use('db',async()=>{ran++;},{signal:controller.signal,timeoutMs:500});
  const outcome=queued.then(()=>'ran',()=>'cancelled');
  try {
    controller.abort();
    expect(await Promise.race([outcome,new Promise(resolve=>{guard=setTimeout(()=>resolve('waiting'),200);})])).toBe('cancelled');
    release.resolve();await first;await outcome;
    expect(ran).toBe(0);
  } finally {clearTimeout(guard);release.resolve();await first;await outcome;await pool.close();}
});

it.each([0,-1,1.5,NaN,Infinity,120001])('rejects invalid trusted connector query budget %s before opening sockets',async queryTimeoutMs=>{
  const open=openConnection as typeof openConnection & ((config:unknown,policy:{allowPrivateNetwork:boolean},seams:undefined,readPolicy:{queryTimeoutMs:number})=>ReturnType<typeof openConnection>);
  let connection:ReturnType<typeof openConnection>|undefined;
  try {
    expect(()=>{connection=open({connector:'postgres',host:'127.0.0.1',port:5432,database:'example',user:'reader',tls:'disable'},{allowPrivateNetwork:true},undefined,{queryTimeoutMs});}).toThrow();
  } finally {await connection?.close();}
});

it('quarantines failed termination and permits explicit bounded cleanup retry',async()=>{
 let confirmed=false,opened=0;
 const pool=new SessionPool({open:async()=>++opened,close:async()=>{if(!confirmed)throw Error('termination unavailable');}},bounds);
 // Only cleanup failed: the work's own result stands, and the slot stays quarantined.
 await expect(pool.use('db',async(_,discard)=>{discard();return 'answer';})).resolves.toBe('answer');
 expect(pool.count()).toBe(1);
 await expect(pool.use('db',async()=>{throw Error('must never dispatch');},{timeoutMs:20})).rejects.toMatchObject({code:'timeout'});
 expect(opened).toBe(1);
 confirmed=true;await pool.close();expect(pool.count()).toBe(0);
});

it.each([0,-1,1.5,NaN,Infinity])('rejects malformed per-query timeout %s before socket acquisition',async timeoutMs=>{
 const connection=openConnection({connector:'postgres',host:'127.0.0.1',port:1,database:'example',user:'reader',tls:'disable'},{allowPrivateNetwork:true});
 try{await expect(connection.query({text:'select 1',params:{},viewer:null,limits:{timeoutMs}})).rejects.toThrow();expect(connection.sessions()).toBe(0);}
 finally{await connection.close();}
});

it('reports the work error, not a failed cleanup, and keeps the unconfirmed slot counted',async()=>{
 const warn=vi.spyOn(console,'warn').mockImplementation(()=>{});
 let confirmed=false;
 const pool=new SessionPool({open:async()=>({}),close:async()=>{if(!confirmed)throw Error('termination unavailable');}},bounds);
 try{
  await expect(pool.use('db',async()=>{throw Error('syntax error at or near "selec"');})).rejects.toThrow('syntax error at or near "selec"');
  expect(pool.count()).toBe(1);
  expect(warn).toHaveBeenCalled();
 }finally{warn.mockRestore();confirmed=true;await pool.close();}
});

it('never fails an acquiring caller because evicting another idle session failed',async()=>{
 const warn=vi.spyOn(console,'warn').mockImplementation(()=>{});
 let confirmed=false;
 const pool=new SessionPool<{key:string}>({open:async key=>({key}),close:async s=>{if(!confirmed&&s.key==='stuck')throw Error('termination unavailable');}},{size:2,idleMs:1000,waitMs:1000});
 try{
  await pool.use('stuck',async()=>{});
  await pool.use('other',async()=>{});
  // The least recently used idle session cannot be terminated: the caller evicts the next one and runs.
  expect(await pool.use('fresh',async s=>s.key)).toBe('fresh');
  expect(pool.count()).toBe(2);
  // Capacity never frees past the quarantined slot and a busy one: the caller gets its own timeout.
  const busy=latch();
  const holding=pool.use('fresh',()=>busy.promise);
  await expect(pool.use('late',async()=>'ran',{timeoutMs:50})).rejects.toMatchObject({code:'timeout'});
  busy.resolve();await holding;
 }finally{warn.mockRestore();confirmed=true;await pool.close();}
});

it('bounds an eviction whose termination never settles by the acquiring caller deadline',async()=>{
 const warn=vi.spyOn(console,'warn').mockImplementation(()=>{});
 const hung=latch();
 const pool=new SessionPool<{key:string}>({open:async key=>({key}),close:async s=>{if(s.key==='stuck')await hung.promise;}},bounds);
 try{
  await pool.use('stuck',async()=>{});
  const started=performance.now();
  await expect(pool.use('late',async()=>'ran',{timeoutMs:50})).rejects.toMatchObject({code:'timeout'});
  expect(performance.now()-started).toBeLessThan(1000);
  expect(pool.count()).toBe(1);
 }finally{warn.mockRestore();hung.resolve();await pool.close();}
});
