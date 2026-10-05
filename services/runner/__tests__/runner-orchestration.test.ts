import {afterEach,expect,it,vi} from 'vitest';
import type {CapabilityContext} from '../src/local';
import {PGlite} from '@electric-sql/pglite';
import {createRunner} from '../src/local';
import {createScheduler,type TransactionalDatabase} from '../src/scheduler';
import {hostCapabilities} from '../src/capabilities';
import {fixtureModel} from '../../../docs/proposals/runner-validation/path.mjs';
const closing:Array<()=>Promise<unknown>>=[];afterEach(async()=>{for(const fn of closing.splice(0).reverse())await fn();});
async function setup(){const db=new PGlite();closing.push(()=>db.close());const model=await fixtureModel();closing.push(()=>model.close());const calls:string[]=[];
 const runner=await createRunner({db,dockerImage:process.env.RUNNER_TEST_IMAGE,capabilities:hostCapabilities({artifactbin:async(context,op,args)=>{expect(context.request.userId).toBe('alice');calls.push(op);return op==='read'?{title:'Report'}:args;},ai:{baseUrl:model.url+'/v1',apiKey:'fixture-key',models:['fixture'],defaultModel:'fixture'}})});closing.push(()=>runner.close());return {db,runner,calls,model};}
it('cron coalesces missed occurrences, serializes overlap and deduplicates dispatch',async()=>{
 const {db,runner}=await setup();const scheduler=await createScheduler(db as unknown as TransactionalDatabase,runner,async()=>({artifactId:'abc123',artifactVersion:'1',program:{source:'export default i=>i',language:'typescript'},document:{source:'<p>Original</p>',editId:'edit-original'}}));
 const start=new Date('2026-10-03T00:00:00Z');
 const {id}=await scheduler.put({userId:'alice',artifactId:'abc123',cron:'*/5 * * * *',timezone:'UTC',input:42},start);
 await scheduler.tick(new Date('2026-10-03T00:17:00Z'));await scheduler.tick(new Date('2026-10-03T00:17:00Z'));
 expect((await db.query('SELECT * FROM runner_schedule_occurrences')).rows).toHaveLength(1);
 expect((await db.query<{request:unknown}>('SELECT request FROM runner_runs')).rows[0]?.request).toMatchObject({artifactId:'abc123',artifactVersion:'1',document:{source:'<p>Original</p>',editId:'edit-original'}});
 await expect(scheduler.remove('bob',id)).rejects.toThrow('not_found');await scheduler.remove('alice',id);
});
it('keeps parallel AI responses distinct when they finish out of order',async()=>{
 const waiting:Array<(r:Response)=>void>=[];
 vi.stubGlobal('fetch',()=>new Promise<Response>(resolve=>waiting.push(resolve)));
 try {
  const call=hostCapabilities({artifactbin:async()=>null,ai:{baseUrl:'http://fixture/v1',models:['fixture'],defaultModel:'fixture'}});
  const ctx:CapabilityContext={runId:'parallel',request:{userId:'alice',requestId:'parallel',program:{source:'',language:'javascript'},input:null},signal:new AbortController().signal,requests:[],usage:[]};
  const input={context:{messages:[]}};
  const first=call({...ctx,callId:1},'ai.open',input),second=call({...ctx,callId:2},'ai.open',input);
  const response=(text:string)=>new Response(`data: ${JSON.stringify({choices:[{delta:{content:text},finish_reason:'stop'}]})}\n\ndata: [DONE]\n\n`);
  waiting[1]!(response('second'));const b=await second;
  waiting[0]!(response('first'));const a=await first;
  expect(a).not.toEqual(b);
  expect(await call(ctx,'ai.next',a)).toMatchObject({message:{content:[{text:'first'}]}});
  expect(await call(ctx,'ai.next',b)).toMatchObject({message:{content:[{text:'second'}]}});
 }finally{vi.unstubAllGlobals();}
});
