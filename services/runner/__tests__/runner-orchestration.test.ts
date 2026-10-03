import {afterEach,expect,it,vi} from 'vitest';
import type {RunnerService,RunnerJson} from '@artifactbin/contracts';
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

it('keeps completed history behind simultaneous pending branches and isolates admission errors',async()=>{
 const db=new PGlite();closing.push(()=>db.close());
 const runner:RunnerService={start:async input=>{if(input.input&&typeof input.input==='object'&&!Array.isArray(input.input)&&input.input.message==='bad')throw Error('invalid_start');return {runId:input.requestId};},events:async()=>({events:[],nextSequence:0,hasMore:false}),getRun:async({runId})=>({runId,status:'completed',output:{messages:[]},receipt:{status:'completed'} as never}),cancel:async()=>{}};
 const coordinator=await createAgentCoordinator(db as unknown as TransactionalDatabase,runner,'export default()=>null');
 const base={userId:'alice',artifactId:'chat',model:'fixture',message:'first',requestId:'first'};
 const completed=await coordinator.dispatch(base);
 await db.query("UPDATE hosted_branches SET status='completed',result=$2,created_at='2020-01-01' WHERE id=$1",[completed.branchId,JSON.stringify({messages:[{role:'user',content:'remember me'}]})]);
 for(let i=0;i<8;i++)await coordinator.dispatch({...base,requestId:'pending'+i});
 const ninth=await coordinator.dispatch({...base,requestId:'ninth'});
 expect((await coordinator.branches('alice','chat')).find(b=>b.id===ninth.branchId)?.input).toMatchObject({history:[{role:'user',content:'remember me'}]});
 const bad=await coordinator.dispatch({...base,artifactId:'errors',requestId:'bad',message:'bad'});
 const good=await coordinator.dispatch({...base,artifactId:'errors',requestId:'good',message:'good'});
 await expect(coordinator.tick()).resolves.toBeUndefined();
 const branches=await coordinator.branches('alice','errors');
 expect(branches.find(b=>b.id===bad.branchId)).toMatchObject({status:'failed',result:{receipt:{reason:'invalid_start'}}});
 expect(branches.find(b=>b.id===good.branchId)?.status).toBe('completed');
});

it('posts a final comment when Pi answers without a reply tool and exposes supplied operation schemas',async()=>{
 const db=new PGlite();closing.push(()=>db.close());const calls:Array<{operation:string,args:unknown}>=[];let delivered=false;
 const runner=await createRunner({db,dockerImage:process.env.RUNNER_TEST_IMAGE,capabilities:async(_ctx,operation,args):Promise<RunnerJson>=>{
  calls.push({operation,args});
  if(operation==='ai.open'){delivered=false;return {streamId:'plain'};}
  if(operation==='ai.next'){if(delivered)return null;delivered=true;return {type:'done',reason:'stop',message:{role:'assistant',content:[{type:'text',text:'Final review'}],stopReason:'stop',timestamp:Date.now()}};}
  return {ok:true};
 }});closing.push(()=>runner.close());
 const coordinator=await createAgentCoordinator(db as unknown as TransactionalDatabase,runner);
 await coordinator.dispatch({userId:'alice',artifactId:'doc',requestId:'plain',message:'review',model:'fixture',operationTools:[{name:'list_artifacts',description:'List accessible artifacts',parameters:{type:'object',properties:{}}}]});
 for(let i=0;i<600;i++){await coordinator.tick();if((await coordinator.branches('alice','doc'))[0]?.status==='completed')break;await new Promise(r=>setTimeout(r,20));}
 expect((await coordinator.branches('alice','doc'))[0]?.status).toBe('completed');
 expect(calls.filter(c=>c.operation==='reply')).toEqual([{operation:'reply',args:{body:'Working on this comment.',phase:'acknowledged'}},{operation:'reply',args:{body:'Final review',phase:'completed'}}]);
 expect(calls.find(c=>c.operation==='ai.open')?.args).toMatchObject({context:{tools:expect.arrayContaining([{name:'list_artifacts',description:'List accessible artifacts',parameters:{type:'object',properties:{}}}])}});
});

it('lets Pi correct a tool error and hides comment-only tools in chat',async()=>{
 const db=new PGlite();closing.push(()=>db.close());let turn=0;const delivered=new Set<string>();const calls:string[]=[];let advertised:unknown;
 const runner=await createRunner({db,dockerImage:process.env.RUNNER_TEST_IMAGE,capabilities:async(_ctx,operation,args):Promise<RunnerJson>=>{
  if(operation==='ai.open'){advertised=args;return {streamId:String(++turn)};}
  if(operation==='ai.next'){
   const id=String((args as {streamId:string}).streamId);if(delivered.has(id))return null;delivered.add(id);
   const content=Number(id)<3?[{type:'toolCall',id:'call'+id,name:'list_artifacts',arguments:Number(id)===1?{bad:true}:{}}]:[{type:'text',text:'Corrected answer'}];
   return {type:'done',reason:Number(id)<3?'toolUse':'stop',message:{role:'assistant',content:content as RunnerJson,stopReason:Number(id)<3?'toolUse':'stop',timestamp:Date.now()}};
  }
  calls.push(operation);if(calls.length===1)throw Error('invalid_operation_input');return {artifacts:[]};
 }});closing.push(()=>runner.close());
 const coordinator=await createAgentCoordinator(db as unknown as TransactionalDatabase,runner);
 await coordinator.dispatch({userId:'alice',artifactId:'chat',requestId:'correct',message:'list',model:'fixture',operationTools:[{name:'list_artifacts',description:'List artifacts',parameters:{type:'object',properties:{}}}]});
 for(let i=0;i<600;i++){await coordinator.tick();const status=(await coordinator.branches('alice','chat'))[0]?.status;if(status==='completed'||status==='failed')break;await new Promise(r=>setTimeout(r,20));}
 expect((await coordinator.branches('alice','chat'))[0]?.status).toBe('completed');expect(calls).toEqual(['artifactbin.list_artifacts','artifactbin.list_artifacts']);
 const tools=(advertised as {context:{tools:Array<{name:string}>}}).context.tools.map(t=>t.name);expect(tools).toEqual(['conversation_history','list_artifacts']);
});

it('retries accepted cancellation after transport failure and coordinator restart',async()=>{
 const db=new PGlite();closing.push(()=>db.close());let attempts=0;
 const runner:RunnerService={start:async()=>({runId:'pending-cancel'}),events:async()=>({events:[],nextSequence:0,hasMore:false}),getRun:async({runId})=>({runId,status:'running',output:null,receipt:null}),cancel:async()=>{if(++attempts===1)throw Error('transport_failed');}};
 const coordinator=await createAgentCoordinator(db as unknown as TransactionalDatabase,runner,'export default()=>null');
 const {branchId}=await coordinator.dispatch({userId:'alice',artifactId:'chat',requestId:'cancel-retry',message:'hi',model:'fixture'});await coordinator.tick();
 await expect(coordinator.cancel('alice',branchId)).rejects.toThrow('transport_failed');
 const restarted=await createAgentCoordinator(db as unknown as TransactionalDatabase,runner,'export default()=>null');await restarted.tick();await restarted.tick();
 expect(attempts).toBe(2);expect((await restarted.branches('alice','chat'))[0]?.status).toBe('cancelled');
});
