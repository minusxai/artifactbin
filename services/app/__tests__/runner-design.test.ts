import {it,expect,afterEach} from 'vitest';
import {useAppHarness,request} from './harness';
import {mintToken,createUser,claimToken} from '@/lib/accounts';
import {POST as publish} from '@/app/api/artifacts/route';
import {GET as read} from '@/app/api/artifacts/[id]/route';
import {POST as reply} from '@/app/api/artifacts/[id]/annotations/[annId]/route';
import {createAnnotationFor} from '@/lib/annotations';
import {remoteAgents} from '@/lib/remote/agents';
import {remoteSessions} from '@/lib/remote/registry';
import {runDesignPath} from '../../../docs/proposals/runner-validation/path.mjs';
const harness=useAppHarness(); afterEach(()=>remoteSessions.clear());
async function setup(){
 const token=await mintToken('design'),user=await createUser({email:'mxmx_test_design@example.com'}); await claimToken(user.id,token.token);
 const response=await publish(request('/api/artifacts',{method:'POST',token:token.token,json:{markup:'<p>Review café</p>'}}));expect(response.status).toBe(201);const doc=await response.json();
 const session=await remoteAgents.create(user.id,{name:'pi',harness:'pi',cwd:'/project',machine:'test',cols:80,rows:24,managed:true,recoveryKey:'a'.repeat(64)});
 const thread: any=await createAnnotationFor({tokenId:token.id,userId:user.id},doc.id,{bodyPath:'0',baseEditId:doc.edit_id,body:`[@pi](/chat?session=${session.id}) review`},{kind:'human',label:'Owner',transport:'browser'});
 const db=await harness.db();const work=(await remoteAgents.work(db,doc.id,thread.id))[0];expect(work.phase).toBe('queued');
 await db.query("UPDATE remote_work SET phase='dispatching' WHERE id=$1",[work.id]);
 return {db,actor:{credential:'bearer',userId:user.id,tokenId:token.id},artifactId:doc.id,threadId:thread.id,work,session,routes:{read:(req:Request,id:string)=>read(req,{params:Promise.resolve({id})}),reply:(req:Request,id:string,annId:string)=>reply(req,{params:Promise.resolve({id,annId})})}};
}
it('runs queued comment through real signed HTTP handlers, isolate Pi tools, SSE and durable history',async()=>{
 const fixture=await setup();const result=await runDesignPath({...fixture,retryReplies:true});
 expect(result.completed,JSON.stringify(result)).toBe(true);expect(result.revision).toBe(1);expect(result.branch.final.outcome).toBe('completed');
 expect(result.modelRequests).toHaveLength(3);expect(result.modelRequests.every((r:any)=>r.authorized)).toBe(true);
 expect(result.observed,JSON.stringify(result.result)).toEqual([{operation:'reply',status:200},{operation:'read',status:200},{operation:'reply',status:200}]);
 const replies=await fixture.db.query('SELECT body FROM annotations WHERE root_id=$1 ORDER BY created_at',[fixture.threadId]);expect(replies.rows.map(r=>r.body)).toEqual(['Working on this comment.','validated reply café']);
 expect((await remoteAgents.work(fixture.db,fixture.artifactId,fixture.threadId))[0].phase).toBe('completed');
},45000);
it('refuses truncated model streams and preserves checkpoint without claiming completion',async()=>{
 const fixture=await setup();const result=await runDesignPath({...fixture,modelMode:'truncated'});
 expect(result.status).toBe('failed');expect(result.receipt.error).toContain('stream_truncated');expect(result.revision).toBe(0);expect(result.branch.final).toBeNull();
 expect((await remoteAgents.work(fixture.db,fixture.artifactId,fixture.threadId))[0].phase).toBe('acknowledged');
},45000);

import {DesignRunner} from '../../../docs/proposals/runner-validation/runner.mjs';
it.each([
 ['synchronous loop','while(true){}','failed'],
 ['loop after awaited host call','await c.emit({type:"checkpoint",messages:[{role:"user",content:"saved"}]});while(true){}','timeout'],
 ['oversized return','return "x".repeat(50000)','failed'],
])('terminates %s and records a terminal receipt',async(_name,body,status)=>{
 const db=await harness.db();const runner=new DesignRunner(db,async()=>({}));await runner.initialize();
 try{
 const {runId}=await runner.start({userId:'limits',requestId:crypto.randomUUID(),bundle:`var Program={default:async(i,c)=>{${body}}}`,input:{},cpuMs:20,timeoutMs:process.env.RUNNER_VALIDATION_DOCKER?5000:1000,maxOutputBytes:10000});
 const result=await runner.wait(runId);expect(result.status).toBe(status);expect((await db.query('SELECT status,receipt FROM design_runs WHERE id=$1',[runId])).rows[0]).toMatchObject({status,receipt:{status}});
 }finally{await runner.close();}
},15000);
it('never exposes native IO or host secrets and ignores forged identity in capability arguments',async()=>{
 const runner=new DesignRunner(await harness.db(),async(_id: string,run: any)=>({userId:run.request.userId}));await runner.initialize();
 try{
 const {runId}=await runner.start({userId:'actual-user',requestId:crypto.randomUUID(),bundle:'var Program={default:async(i,c)=>({identity:await c.artifactbin.read({userId:"forged",authorization:"steal"}),globals:[typeof process,typeof require,typeof fetch,typeof navigator,typeof localStorage],escape:c.artifactbin.read.constructor("return typeof process")()})}',input:{},timeoutMs:10000});
 const result=await runner.wait(runId);expect(result.status).toBe('completed');expect(result.result).toEqual({identity:{userId:'actual-user'},globals:['undefined','undefined','undefined','undefined','undefined'],escape:'undefined'});
 }finally{await runner.close();}
},15000);
it('deduplicates admission, rejects conflicting retry and commits parallel branches once',async()=>{
 const db=await harness.db();const runner=new DesignRunner(db,async()=>({}));await runner.initialize();
 try{
 const convo=crypto.randomUUID();await db.query('INSERT INTO design_conversations(id) VALUES($1)',[convo]);
 const request={userId:'parallel',requestId:crypto.randomUUID(),bundle:'var Program={default:async()=>({outcome:"completed"})}',input:{},timeoutMs:10000};
 const starts=await Promise.all(Array.from({length:8},()=>runner.start(request)));expect(new Set(starts.map(s=>s.runId)).size).toBe(1);
 await expect(runner.start({...request,input:{different:true}})).rejects.toThrow('start_conflict');
 const other=await runner.start({...request,requestId:crypto.randomUUID()});
 for(const id of [starts[0].runId,other.runId])await db.query('INSERT INTO design_branches(id,conversation_id,run_id) VALUES($1,$2,$3)',[id,convo,id]);
 const results=await Promise.all([runner.wait(starts[0].runId),runner.wait(other.runId)]);expect(results.map(r=>r.status)).toEqual(['completed','completed']);
 await Promise.all(Array.from({length:8},(_,i)=>runner.commit(i%2?other.runId:starts[0].runId,{outcome:'completed'})));
 expect((await db.query('SELECT revision FROM design_conversations WHERE id=$1',[convo])).rows[0].revision).toBe(2);
 }finally{await runner.close();}
},20000);
it('cancels pending host IO and preserves already durable checkpoints',async()=>{
 const db=await harness.db();let entered!:()=>void;const reached=new Promise<void>(r=>entered=r);let aborted=false;
 const runner=new DesignRunner(db,async(_id: string,run: any)=>{const c=new AbortController();run.controllers.add(c);entered();return new Promise((_,reject)=>c.signal.addEventListener('abort',()=>{aborted=true;reject(Error('cancelled'));}));});await runner.initialize();
 try{
 const {runId}=await runner.start({userId:'cancel',requestId:crypto.randomUUID(),bundle:'var Program={default:async(i,c)=>{await c.emit({type:"checkpoint",messages:[{role:"user",content:"saved"}]});await c.artifactbin.read({});return "wrong"}}',input:{},timeoutMs:10000});
 await reached;await runner.stop(runId);expect((await runner.wait(runId)).status).toBe('cancelled');expect(aborted).toBe(true);
 expect((await db.query<{event:any}>('SELECT event FROM design_events WHERE run_id=$1',[runId])).rows[0].event.messages[0].content).toBe('saved');
 }finally{await runner.close();}
},15000);
it('rejects a signed user-only actor on bearer routes instead of claiming it is sufficient',async()=>{
 const fixture=await setup();const result=await runDesignPath({...fixture,actor:{credential:'session',userId:fixture.actor.userId}});
 expect(result.status).toBe('failed');expect(result.observed[0].status).toBe(401);expect(result.revision).toBe(0);
},45000);
it('rejects a different owner even when remote-agent proof is otherwise valid',async()=>{
 const fixture=await setup();const token=await mintToken('other'),user=await createUser({email:'mxmx_test_other_design@example.com'});await claimToken(user.id,token.token);
 const result=await runDesignPath({...fixture,actor:{credential:'bearer',userId:user.id,tokenId:token.id}});
 expect(result.status).toBe('failed');expect(result.observed[0].status).toBe(404);expect(result.revision).toBe(0);
},45000);
it('recovers worker death with the durable checkpoint and a replayable terminal receipt',async()=>{
 const db=await harness.db();let entered!:()=>void;const reached=new Promise<void>(r=>entered=r);
 const runner=new DesignRunner(db,async()=>{entered();return new Promise(()=>{});});await runner.initialize();
 try{
 const {runId}=await runner.start({userId:'crash',requestId:crypto.randomUUID(),bundle:'var Program={default:async(i,c)=>{await c.emit({type:"checkpoint",messages:[{role:"user",content:"before crash"}]});await c.artifactbin.read({})}}',input:{},timeoutMs:10000});
 await reached;runner.active.get(runId).child.kill('SIGKILL');expect((await runner.wait(runId)).status).toBe('interrupted');
 const replacement=new DesignRunner(db,async()=>({}));await replacement.initialize();await replacement.recover();
 expect((await db.query('SELECT receipt FROM design_runs WHERE id=$1',[runId])).rows[0].receipt).toMatchObject({status:'interrupted'});
 expect((await db.query<{event:any}>('SELECT event FROM design_events WHERE run_id=$1',[runId])).rows[0].event.messages[0].content).toBe('before crash');
 }finally{await runner.close();}
},15000);
it('caps requests even when the program catches host failures',async()=>{
 let calls=0;const runner=new DesignRunner(await harness.db(),async()=>{calls++;return {};});await runner.initialize();
 try{
 const {runId}=await runner.start({userId:'quota',requestId:crypto.randomUUID(),bundle:'var Program={default:async(i,c)=>{for(let n=0;n<5;n++)try{await c.artifactbin.read({})}catch{};return "done"}}',input:{},maxRequests:2,timeoutMs:10000});
 expect((await runner.wait(runId)).status).toBe('completed');expect(calls).toBe(2);
 }finally{await runner.close();}
},15000);

it('seeds Pi with the saved transcript on the next comment and isolates history by user/artifact',async()=>{
 const fixture=await setup(),first=await runDesignPath(fixture);expect(first.completed).toBe(true);
 const thread:any=await createAnnotationFor({tokenId:fixture.actor.tokenId,userId:fixture.actor.userId},fixture.artifactId,{bodyPath:'0',body:`[@pi](/chat?session=${fixture.session.id}) next comment`},{kind:'human',label:'Owner',transport:'browser'});
 const work=(await remoteAgents.work(fixture.db,fixture.artifactId,thread.id))[0];await fixture.db.query("UPDATE remote_work SET phase='dispatching' WHERE id=$1",[work.id]);
 const next=await runDesignPath({...fixture,threadId:thread.id,work,history:first.result.messages});expect(next.completed,JSON.stringify(next)).toBe(true);expect(next.revision).toBe(2);
 expect(next.modelRequests[0].body.messages.length).toBeGreaterThan(first.modelRequests[0].body.messages.length);
},45000);
