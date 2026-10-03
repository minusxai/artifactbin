import {afterEach,expect,it,vi} from 'vitest';
import type {CapabilityContext} from '../src/local';
import {PGlite} from '@electric-sql/pglite';
import {createRunner} from '../src/local';
import {createAgentCoordinator,type TransactionalDatabase} from '../src/coordinator';
import {createScheduler} from '../src/scheduler';
import {hostCapabilities} from '../src/capabilities';
import {fixtureModel} from '../../../docs/proposals/runner-validation/path.mjs';
const closing:Array<()=>Promise<unknown>>=[];afterEach(async()=>{for(const fn of closing.splice(0).reverse())await fn();});
async function setup(){const db=new PGlite();closing.push(()=>db.close());const model=await fixtureModel();closing.push(()=>model.close());const calls:string[]=[];
 const runner=await createRunner({db,dockerImage:process.env.RUNNER_TEST_IMAGE,capabilities:hostCapabilities({artifactbin:async(context,op,args)=>{expect(context.request.userId).toBe('alice');calls.push(op);return op==='read'?{title:'Report'}:args;},ai:{baseUrl:model.url+'/v1',apiKey:'fixture-key',models:['fixture'],defaultModel:'fixture'}})});closing.push(()=>runner.close());return {db,runner,calls,model};}
it('runs real Pi, persists checkpoints, finalizes once and seeds the next conversation',async()=>{
 const {db,runner,calls,model}=await setup();const agent=await createAgentCoordinator(db as unknown as TransactionalDatabase,runner);
 const input={userId:'alice',artifactId:'abc123',requestId:'comment1',message:'Please review',model:'fixture'};
 const first=await agent.dispatch(input);expect(await agent.dispatch(input)).toEqual(first);
 for(let i=0;i<600;i++){await agent.tick();const rows=await agent.branches('alice','abc123');if(rows[0]?.status==='completed')break;await new Promise(r=>setTimeout(r,20));}
 const rows=await agent.branches('alice','abc123');expect(rows[0]?.status).toBe('completed');expect(rows[0]?.checkpoint).toBeInstanceOf(Array);expect(calls).toContain('read');expect(calls.filter(c=>c==='reply')).toHaveLength(2);expect(model.requests.every((r:{authorized:boolean})=>r.authorized)).toBe(true);
 await agent.tick();expect((await db.query<{revision:number}>('SELECT revision FROM hosted_conversations')).rows[0]?.revision).toBe(1);
 await agent.dispatch({...input,requestId:'comment2'});const second=(await agent.branches('alice','abc123'))[0]!;expect((second.input as {history:unknown[]}).history.length).toBeGreaterThan(0);expect(await agent.branches('bob','abc123')).toEqual([]);
});
it('cron coalesces missed occurrences, serializes overlap and deduplicates dispatch',async()=>{
 const {db,runner}=await setup();const scheduler=await createScheduler(db as unknown as TransactionalDatabase,runner);
 const start=new Date('2026-10-03T00:00:00Z');const program={source:'export default i=>i',language:'typescript' as const};
 const {id}=await scheduler.put({userId:'alice',artifactId:'abc123',version:'1',cron:'*/5 * * * *',timezone:'UTC',program,document:{source:'<p>Original</p>',editId:'edit-original'},input:42},start);
 await scheduler.tick(new Date('2026-10-03T00:17:00Z'));await scheduler.tick(new Date('2026-10-03T00:17:00Z'));
 expect((await db.query('SELECT * FROM runner_schedule_occurrences')).rows).toHaveLength(1);
 expect((await db.query<{request:unknown}>('SELECT request FROM runner_runs')).rows[0]?.request).toMatchObject({artifactId:'abc123',artifactVersion:'1',document:{source:'<p>Original</p>',editId:'edit-original'}});
 await expect(scheduler.remove('bob',id)).rejects.toThrow('not_found');await scheduler.remove('alice',id);
});
it('pins the dispatched program across coordinator restart and cancels queued branches',async()=>{
 const {db,runner}=await setup();const first=await createAgentCoordinator(db as unknown as TransactionalDatabase,runner,'export default()=>({messages:[],version:1})');const input={userId:'alice',artifactId:'pin',requestId:'pin',message:'hi',model:'fixture'};
 await first.dispatch(input);const cancelled=await first.dispatch({...input,requestId:'cancel'});await first.cancel('alice',cancelled.branchId);
 const restarted=await createAgentCoordinator(db as unknown as TransactionalDatabase,runner,'export default()=>({messages:[],version:2})');
 for(let i=0;i<600;i++){await restarted.tick();const row=(await restarted.branches('alice','pin')).find(b=>b.request_key==='pin');if(row?.status==='completed')break;await new Promise(r=>setTimeout(r,20));}
 const rows=await restarted.branches('alice','pin');expect(rows.find(b=>b.request_key==='pin')?.result).toMatchObject({version:1});expect(rows.find(b=>b.id===cancelled.branchId)?.run_id).toBeNull();
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
