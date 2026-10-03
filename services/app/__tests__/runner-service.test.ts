import {afterEach, describe, expect, it} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {createRunner} from '../../runner/src/local';
import {runnerHttp} from '../../runner/src/http';
import {runnerClient} from '../../utils/src/runner-client';
import {inProcess,overHttp,signActor} from '@artifactbin/utils';
import {serve} from '@hono/node-server';
import {ACTOR_HEADER} from '@artifactbin/contracts';
const cleanup: Array<()=>Promise<unknown>>=[];
afterEach(async()=>{for(const close of cleanup.splice(0).reverse())await close();});
async function setup(){
 const db=new PGlite(); cleanup.push(()=>db.close());
 const runner=await createRunner({db,dockerImage:process.env.RUNNER_TEST_IMAGE,capabilities:async (_ctx,op,args)=>{if(op==='read')return args;throw Error('forbidden');}});
 cleanup.push(()=>runner.close());return {runner,db};
}
const request=(source='export default async (input,c) => {await c.emit(input); return {input, native:typeof process, network:typeof fetch};}')=>({userId:'alice',requestId:'one',program:{source,language:'typescript' as const},input:{hello:'world'}});
async function terminal(r:Awaited<ReturnType<typeof createRunner>>,runId:string){for(let n=0;n<1200;n++){const s=await r.getRun({userId:'alice',runId});if(s.receipt)return s;await new Promise(r=>setTimeout(r,10));}throw Error('never terminated');}
describe('product runner',()=>{
 it('durably deduplicates admission and persists output, ordered events and receipt',async()=>{
  const {runner}=await setup();const {runId}=await runner.start(request());
  expect(await runner.start(request())).toEqual({runId});
  await expect(runner.start({...request(),input:1})).rejects.toThrow('start_conflict');
  const result=await terminal(runner,runId);expect(result.status).toBe('completed');
  expect(result.output).toEqual({input:{hello:'world'},native:'undefined',network:'undefined'});
  expect(result.receipt?.estimatedDollars).toBeNull();
  expect(await runner.events({userId:'alice',runId,afterSequence:0})).toMatchObject({events:[{sequence:1,event:{hello:'world'}}],nextSequence:1,hasMore:false});
  await expect(runner.getRun({userId:'bob',runId})).rejects.toThrow('not_found');
  await expect(runner.cancel({userId:'bob',runId})).rejects.toThrow('not_found');
 });
 it('terminates infinite programs, cancels and isolates capabilities',async()=>{
  const {runner}=await setup();const a=await runner.start(request('export default () => {while(true){}}'));
  expect((await terminal(runner,a.runId)).status).toBe('failed');
  const b=await runner.start({...request('export default async()=>new Promise(()=>{})'),requestId:'two'});
  await runner.cancel({userId:'alice',runId:b.runId});expect((await terminal(runner,b.runId)).status).toBe('cancelled');
  const c=await runner.start({...request('export default async(i,c)=>c.artifactbin.read({value:42})'),requestId:'three'});
  expect((await terminal(runner,c.runId)).output).toEqual({value:42});
 });
 it('rejects native imports and enforces output limits',async()=>{
  const {runner}=await setup();await expect(runner.start(request('import fs from "node:fs";export default()=>fs.readFileSync("/etc/passwd")'))).rejects.toThrow('import_not_allowed');
  const {runId}=await runner.start({...request('export default()=>"x".repeat(3000)'),limits:{maxOutputBytes:100}});
  expect((await terminal(runner,runId)).receipt?.reason).toBe('output_limit');
 });
 it('preserves the same owner-scoped contract through HTTP handlers',async()=>{
  const {runner}=await setup();const app=runnerHttp(runner);const client=runnerClient('http://runner',inProcess(app));
  const {runId}=await client.start(request());await terminal(runner,runId);
  expect((await client.getRun({userId:'alice',runId})).status).toBe('completed');
  await expect(client.events({userId:'bob',runId,afterSequence:0})).rejects.toThrow('not_found');
  const denied=await app.request('/v1/runs',{method:'POST',body:JSON.stringify(request())});expect(denied.status).toBe(401);
 });
});
it('bounds event replay, rejects invalid cursors and preserves terminal receipts across restart',async()=>{
 const {runner,db}=await setup();const {runId}=await runner.start(request('export default async(i,c)=>{for(let n=0;n<3;n++)await c.emit(n);return 9}'));
 await terminal(runner,runId);expect(await runner.events({userId:'alice',runId,afterSequence:0,limit:2})).toEqual({events:[{sequence:1,event:0},{sequence:2,event:1}],nextSequence:2,hasMore:true});
 await expect(runner.events({userId:'alice',runId,afterSequence:-1})).rejects.toThrow('invalid_cursor');await runner.close();
 const restarted=await createRunner({db,dockerImage:process.env.RUNNER_TEST_IMAGE,capabilities:async()=>null});cleanup.push(()=>restarted.close());expect((await restarted.getRun({userId:'alice',runId})).output).toBe(9);
});
it('interrupts recovered admissions without replaying code',async()=>{
 const {runner,db}=await setup();await runner.close();await db.query("INSERT INTO runner_runs(id,owner,request_key,fingerprint,status,request,admitted_at) VALUES('recovered','alice','restart','hash','running',$1,$2)",[JSON.stringify(request()),new Date().toISOString()]);
 const restarted=await createRunner({db,dockerImage:process.env.RUNNER_TEST_IMAGE,capabilities:async()=>{throw Error('must not execute');}});cleanup.push(()=>restarted.close());expect((await restarted.getRun({userId:'alice',runId:'recovered'})).receipt).toMatchObject({status:'interrupted',reason:'host_restart'});
});
it('kills post-await loops on the wall deadline and aborts outstanding host I/O',async()=>{
 const {runner}=await setup();const {runId}=await runner.start({...request('export default async(i,c)=>{await c.emit("checkpoint");while(true){}}'),limits:{timeoutMs:process.env.RUNNER_TEST_IMAGE?5000:600}});
 expect((await terminal(runner,runId)).receipt?.reason).toBe('timeout');
 const db=new PGlite();cleanup.push(()=>db.close());let aborted=false;let started!:()=>void;const began=new Promise<void>(resolve=>started=resolve);
 const other=await createRunner({db,dockerImage:process.env.RUNNER_TEST_IMAGE,capabilities:async c=>{started();return new Promise(resolve=>c.signal.addEventListener('abort',()=>{aborted=true;resolve(null);},{once:true}));}});cleanup.push(()=>other.close());
 const pending=await other.start(request('export default async(i,c)=>await c.artifactbin.read({})'));
 await began;await other.cancel({userId:'alice',runId:pending.runId});expect(aborted).toBe(true);expect((await other.getRun({userId:'alice',runId:pending.runId})).status).toBe('cancelled');
});
it('authenticates the production HTTP boundary and refuses body identity spoofing',async()=>{
 const {runner}=await setup();
 const secret='test-service-secret-'.repeat(3);const app=runnerHttp(runner,secret);const server=serve({fetch:app.fetch,hostname:'127.0.0.1',port:0});await new Promise<void>(r=>server.listening?r():server.once('listening',r));cleanup.push(()=>new Promise<void>(r=>{if('closeAllConnections' in server)server.closeAllConnections();server.close(()=>r());}));
 const address=server.address();if(!address||typeof address==='string')throw Error('no address');const url=`http://127.0.0.1:${address.port}`;const client=runnerClient(url,overHttp(url,secret));
 const {runId}=await client.start(request());await terminal(runner,runId);expect((await client.getRun({userId:'alice',runId})).status).toBe('completed');
 const response=await fetch(url+'/v1/runs',{method:'POST',headers:{'content-type':'application/json',[ACTOR_HEADER]:signActor({userId:'bob',credential:'session'},secret)},body:JSON.stringify(request())});expect(response.status).toBe(403);
 const unsigned=await fetch(url+`/v1/runs/${runId}`,{headers:{[ACTOR_HEADER]:'forged'}});expect(unsigned.status).toBe(401);
});

it('deduplicates concurrent admission before applying queue capacity',async()=>{
 const db=new PGlite();cleanup.push(()=>db.close());
 const runner=await createRunner({db,maxQueued:1,dockerImage:process.env.RUNNER_TEST_IMAGE,capabilities:async()=>null});cleanup.push(()=>runner.close());
 const input=request('export default()=>new Promise(()=>{})');
 const admissions=await Promise.all([runner.start(input),runner.start(input)]);
 expect(admissions[1]).toEqual(admissions[0]);
 await expect(runner.start({...input,requestId:'different'})).rejects.toThrow('queue_full');
 await expect(runner.start({...input,input:2})).rejects.toThrow('start_conflict');
});
