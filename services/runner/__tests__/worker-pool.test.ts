import {afterEach,expect,it,vi} from 'vitest';
import {spawn,type ChildProcessWithoutNullStreams} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {PGlite} from '@electric-sql/pglite';
import {createWorkerPool,type WorkerPool} from '../src/worker-pool';

const spawned=vi.hoisted(()=>[] as Array<{child:ChildProcessWithoutNullStreams;runs:number}>);
vi.mock('node:child_process',async original=>{
 const real=await original<typeof import('node:child_process')>();
 return {...real,spawn:(...args:Parameters<typeof real.spawn>)=>{const child=(real.spawn as (...a:unknown[])=>ChildProcessWithoutNullStreams)(...args);const entry={child,runs:0};spawned.push(entry);const write=child.stdin.write.bind(child.stdin);child.stdin.write=((chunk:unknown,...rest:unknown[])=>{if(String(chunk).startsWith('{"type":"run"'))entry.runs++;return (write as (...a:unknown[])=>boolean)(chunk,...rest);}) as typeof child.stdin.write;return child;}};
});
const {createRunner}=await import('../src/local');
const worker=fileURLToPath(new URL('../src/runner-worker.mjs',import.meta.url));
const real=()=>spawn(process.execPath,['--no-node-snapshot',worker],{stdio:['pipe','pipe','pipe'],env:{}});
const cleanup:Array<()=>Promise<unknown>>=[];
afterEach(async()=>{for(const close of cleanup.splice(0).reverse())await close();spawned.length=0;});
async function until(check:()=>boolean,ms=10_000){const end=Date.now()+ms;while(!check()){if(Date.now()>end)throw Error('timed out');await new Promise(r=>setTimeout(r,10));}}
const exited=(c:ChildProcessWithoutNullStreams)=>c.exitCode!==null||c.signalCode!==null;
function pool(size:number,spawnChild=real):WorkerPool{const p=createWorkerPool({size,spawnChild});cleanup.push(()=>p.close());return p;}

it('hands each started process to exactly one claimant and replaces it',async()=>{
 const p=pool(2);await until(()=>p.spares.length===2&&p.spares.every(w=>w.ready));
 const first=p.take(),second=p.take();
 expect(first.ready).toBe(true);expect(new Set([first.child.pid,second.child.pid]).size).toBe(2);
 expect(p.spares.map(w=>w.child.pid)).not.toContain(first.child.pid);expect(p.spares).toHaveLength(2);
 const heard:string[]=[];first.claim({message:m=>heard.push(m.type),fault:()=>{},startFailed:()=>{},exit:()=>{}});expect(heard).toEqual(['ready']);
 expect(()=>first.claim({message:()=>{},fault:()=>{},startFailed:()=>{},exit:()=>{}})).toThrow('worker_already_claimed');
 for(const w of [first,second])w.child.kill('SIGKILL');
});
it('replaces a killed spare and stops respawning a binary that never starts',async()=>{
 const p=pool(2);await until(()=>p.spares.length===2&&p.spares.every(w=>w.ready));
 const victim=p.spares[0]!.child;victim.kill('SIGKILL');
 await until(()=>exited(victim)&&p.spares.length===2&&p.spares.every(w=>w.ready&&w.child.pid!==victim.pid));
 let starts=0;const broken=pool(2,()=>{starts++;return spawn(process.execPath,['-e','process.exit(1)'],{stdio:['pipe','pipe','pipe']});});
 await until(()=>broken.spares.length===0&&starts>=3);await new Promise(r=>setTimeout(r,300));expect(starts).toBeLessThanOrEqual(4);
 const onDemand=broken.take();expect(onDemand.ready).toBe(false);onDemand.child.kill('SIGKILL');
});
it('a spare that speaks before it is claimed is discarded, and close kills every spare',async()=>{
 const p=pool(1,()=>spawn(process.execPath,['-e','console.log(JSON.stringify({type:"result",result:1}));setInterval(()=>{},1000)'],{stdio:['pipe','pipe','pipe']}));
 const first=p.spares[0]!.child;await until(()=>exited(first));
 const healthy=pool(2);await until(()=>healthy.spares.length===2);const children=healthy.spares.map(w=>w.child);
 await healthy.close();expect(children.every(exited)).toBe(true);expect(()=>healthy.take()).toThrow('runner_closed');
});
it('runs every program in its own pre-started process and never reuses one',async()=>{
 const db=new PGlite();cleanup.push(()=>db.close());
 const runner=await createRunner({db,prestartedWorkers:2,capabilities:async()=>null});cleanup.push(()=>runner.close());
 await until(()=>spawned.length===2);
 const ids:string[]=[];for(let n=0;n<4;n++)ids.push((await runner.start({userId:'alice',requestId:'serial'+n,program:{source:`export default()=>${n}`,language:'javascript'},input:null})).runId);
 ids.push(...await Promise.all(Array.from({length:4},async(_,n)=>(await runner.start({userId:'alice',requestId:'burst'+n,program:{source:'export default()=>"burst"',language:'javascript'},input:null})).runId)));
 for(const runId of ids)expect((await runner.getRun({userId:'alice',runId,waitMs:10_000})).status).toBe('completed');
 const used=spawned.filter(s=>s.runs>0);
 expect(used).toHaveLength(ids.length);expect(spawned.every(s=>s.runs<=1)).toBe(true);
 await until(()=>used.every(s=>exited(s.child)));
});
