/**
 * A pooled worker that dies before it accepted its run (OOM-killed or crashed as a spare, its exit not yet heard)
 * ran no resolver code, so the runner runs the program once more on a fresh worker. One that dies after it accepted
 * the run may have had side effects: the run ends `interrupted / worker_exit` and the program never runs twice.
 */
import {type ChildProcessWithoutNullStreams} from 'node:child_process';
import {afterEach,expect,it,vi} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {createRunner} from '@artifactbin/runner/local';
import type {RunnerJson} from '@artifactbin/contracts';

/** Every spawned process, the `run` messages written to it, and the sabotage the next test arms. */
const state=vi.hoisted(()=>({spawned:[] as Array<{child:ChildProcessWithoutNullStreams;runs:number}>,dieAtHandOff:false,dieOnStarted:false}));
vi.mock('node:child_process',async original=>{
 const real=await original<typeof import('node:child_process')>();
 return {...real,spawn:(...args:Parameters<typeof real.spawn>)=>{
  const child=(real.spawn as (...a:unknown[])=>ChildProcessWithoutNullStreams)(...args),entry={child,runs:0};state.spawned.push(entry);
  const write=child.stdin.write.bind(child.stdin);
  child.stdin.write=((chunk:unknown,...rest:unknown[])=>{
   if(!String(chunk).startsWith('{"type":"run"'))return (write as (...a:unknown[])=>boolean)(chunk,...rest);
   entry.runs++;
   // Gone at hand-off: the process dies and the run message never reaches it.
   if(state.dieAtHandOff){state.dieAtHandOff=false;child.kill('SIGKILL');return true;}
   return (write as (...a:unknown[])=>boolean)(chunk,...rest);
  }) as typeof child.stdin.write;
  // Registered before the pool's own listener: the kill lands as the controller hears the acknowledgement.
  child.stdout.on('data',(b:Buffer)=>{if(state.dieOnStarted&&String(b).includes('"type":"started"')){state.dieOnStarted=false;child.kill('SIGKILL');}});
  return child;
 }};
});

const exited=(c:ChildProcessWithoutNullStreams)=>c.exitCode!==null||c.signalCode!==null;
const until=async(check:()=>boolean,ms=10_000)=>{const end=Date.now()+ms;while(!check()){if(Date.now()>end)throw Error('timed out');await new Promise(r=>setTimeout(r,10));}};
const cleanup:Array<()=>Promise<unknown>>=[];
afterEach(async()=>{for(const close of cleanup.splice(0).reverse())await close();state.spawned.length=0;state.dieAtHandOff=state.dieOnStarted=false;});

async function runner(capabilities:(operation:string,signal:AbortSignal)=>Promise<RunnerJson>=async()=>null){
 const db=new PGlite();cleanup.push(()=>db.close());
 const service=await createRunner({db,prestartedWorkers:1,ceilings:{timeoutMs:5000},capabilities:(ctx,operation)=>capabilities(operation,ctx.signal)});
 cleanup.push(()=>service.close());
 await until(()=>state.spawned.length===1);
 return service;
}
const run=async(service:Awaited<ReturnType<typeof runner>>,source:string)=>{
 const {runId}=await service.start({userId:'alice',requestId:'r1',program:{source,language:'javascript'},input:null});
 return service.getRun({userId:'alice',runId,waitMs:10_000});
};
const runWrites=()=>state.spawned.reduce((n,s)=>n+s.runs,0);

it('runs the program on a fresh worker when the one it was handed dies before receiving it',async()=>{
 const service=await runner();
 state.dieAtHandOff=true;
 const snapshot=await run(service,'export default()=>"answered"');
 expect({status:snapshot.status,reason:snapshot.receipt?.reason,output:snapshot.output}).toEqual({status:'completed',reason:null,output:'answered'});
 const [lost,...rest]=state.spawned.filter(s=>s.runs>0);
 expect(lost!.child.killed).toBe(true);expect(rest).toHaveLength(1);expect(runWrites()).toBe(2);
 await until(()=>exited(lost!.child));
},20000);

it('ends worker_exit, never re-running the program, when its worker dies after accepting it',async()=>{
 const service=await runner();
 state.dieOnStarted=true;
 const snapshot=await run(service,'export default()=>new Promise(()=>{})');
 expect({status:snapshot.status,reason:snapshot.receipt?.reason}).toEqual({status:'interrupted',reason:'worker_exit'});
 expect(runWrites()).toBe(1);
},20000);

it('ends worker_exit, never re-running the program, when its worker dies during a capability call',async()=>{
 let calls=0;
 const service=await runner(async(_operation,signal)=>{
  calls++;
  for(const s of state.spawned)if(s.runs>0&&!exited(s.child))s.child.kill('SIGKILL');
  await new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true}));
  throw Error('aborted');
 });
 const snapshot=await run(service,'export default async(input,caps)=>{await caps.artifactbin.call("probe",{});return "after";}');
 expect({status:snapshot.status,reason:snapshot.receipt?.reason}).toEqual({status:'interrupted',reason:'worker_exit'});
 expect(calls).toBe(1);expect(runWrites()).toBe(1);
},20000);
