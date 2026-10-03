import type {RunnerService} from '@artifactbin/contracts';
import {afterEach,expect,it} from 'vitest';
import {useAppHarness,request} from './harness';
import {mintToken,createUser,claimToken} from '@/lib/accounts';
import {POST as publish} from '@/app/api/artifacts/route';
import {createAnnotationFor} from '@/lib/annotations';
import {remoteAgents} from '@/lib/remote/agents';
import {createHostedRemoteAgent} from '@/lib/remote/hosted';
import {setHostedRemoteAgent} from '@/lib/remote/hosted-interface';
import {createRunner} from '../../runner/src/local';
import {hostCapabilities} from '../../runner/src/capabilities';
import {fixtureModel} from '../../../docs/proposals/runner-validation/path.mjs';
const harness=useAppHarness();const cleanup:Array<()=>Promise<unknown>>=[];afterEach(async()=>{setHostedRemoteAgent(undefined);for(const close of cleanup.splice(0).reverse())await close();});
it('presents a default session and processes a real comment using existing permissions and receipts',async()=>{
 const db=await harness.db();const token=await mintToken('hosted'),user=await createUser({email:'mxmx_test_hosted@example.com'});await claimToken(user.id,token.token);
 const response=await publish(request('/api/artifacts',{method:'POST',token:token.token,json:{markup:'<p>Review me</p>'}}));expect(response.status).toBe(201);const doc=await response.json();
 const model=await fixtureModel();cleanup.push(()=>model.close());
 let hosted:Awaited<ReturnType<typeof createHostedRemoteAgent>>;
 const runner=await createRunner({db,dockerImage:process.env.RUNNER_TEST_IMAGE,capabilities:hostCapabilities({artifactbin:async(ctx,op,args)=>{const response=await hosted.agent.operation(ctx.request.userId,ctx.request.requestId,op,args);const value=await response.json();if(!response.ok)throw Error(JSON.stringify(value));return value;},ai:{baseUrl:model.url+'/v1',apiKey:'fixture-key',models:['fixture'],defaultModel:'fixture'}})});cleanup.push(()=>runner.close());
 hosted=await createHostedRemoteAgent({runner,secret:'hosted-test-secret-'.repeat(3),model:'fixture'});setHostedRemoteAgent(hosted.agent);
 const sessions=await remoteAgents.list(user.id);expect(sessions).toHaveLength(1);expect(sessions[0].online).toBe(true);
 const thread=await createAnnotationFor({tokenId:token.id,userId:user.id},doc.id,{bodyPath:'0',baseEditId:doc.edit_id,body:`[@artifactbin](/chat?session=${sessions[0].id}) review`},{kind:'human',label:'Owner',transport:'browser'});
 if(!thread||!('id' in thread))throw Error('annotation_failed');
 for(let i=0;i<600;i++){await hosted.tick();const branches=await hosted.coordinator.branches(user.id,doc.id);if(branches[0]?.status==='completed'||branches[0]?.status==='failed')break;await new Promise(r=>setTimeout(r,20));}
 const branches=await hosted.coordinator.branches(user.id,doc.id);expect(branches[0]?.status,JSON.stringify(branches)).toBe('completed');
 expect((await remoteAgents.work(db,doc.id,thread!.id))[0]?.phase).toBe('completed');
 expect((await db.query<{body:string}>('SELECT body FROM annotations WHERE root_id=$1 ORDER BY created_at',[thread!.id])).rows.map(r=>r.body)).toEqual(['Working on this comment.','validated reply café']);
 expect((await hosted.agent.operation('another-user','agent:'+branches[0].id,'read',{})).status).toBe(404);
});

const idleRunner:RunnerService={start:async()=>{throw Error('queue_full');},getRun:async()=>{throw Error('not_found');},events:async()=>{throw Error('not_found');},cancel:async()=>{}};
it('persists terminal input across app replicas and cancels queued work before dispatch',async()=>{
 const db=await harness.db();const options={runner:idleRunner,secret:'replica-secret-'.repeat(3),model:'fixture'};
 const first=await createHostedRemoteAgent(options),second=await createHostedRemoteAgent(options);
 const session=await first.agent.ensure('alice');
 await first.agent.input('alice',session.id,'hello ');
 await second.agent.input('alice',session.id,'world\r');
 expect((await first.coordinator.branches('alice','chat'))[0]?.input).toMatchObject({message:'hello world'});
 await Promise.all([first.agent.input('alice',session.id,'one\r'),second.agent.input('alice',session.id,'two\r')]);
 expect((await first.coordinator.branches('alice','chat')).map(b=>(b.input as {message:string}).message)).toEqual(expect.arrayContaining(['one','two']));
 await db.query("INSERT INTO remote_work(id,owner,session_id,artifact_id,thread_id,comment_id,phase,data) VALUES('queued','alice',$1,'doc','thread','comment','queued',$2)",[session.id,JSON.stringify({payload:{body:'review'}})]);
 await second.agent.stop('alice',session.id);
 expect((await db.query<{phase:string}>("SELECT phase FROM remote_work WHERE id='queued'")).rows[0]?.phase).toBe('unavailable');
 expect((await first.coordinator.branches('alice','chat')).every(b=>b.status==='cancelled')).toBe(true);
 const restarted=await createHostedRemoteAgent(options);
 expect((await restarted.agent.view('alice',session.id,0)).snapshot?.endsWith('\r\n> ')).toBe(true);
});
it('shows persisted checkpoints and terminal error reasons in the existing terminal view',async()=>{
 const db=await harness.db();const hosted=await createHostedRemoteAgent({runner:idleRunner,secret:'view-secret-'.repeat(4),model:'fixture'});
 const session=await hosted.agent.ensure('alice');const branch=await hosted.coordinator.dispatch({userId:'alice',artifactId:'chat',requestId:'view',message:'hi',model:'fixture'});
 await db.query("UPDATE hosted_branches SET status='running',checkpoint=$2 WHERE id=$1",[branch.branchId,JSON.stringify([{role:'assistant',content:[{text:'checkpoint answer\nsecond line'}]}])]);
 expect((await hosted.agent.view('alice',session.id,0)).snapshot).toContain('checkpoint answer\r\nsecond line');
 await db.query("UPDATE hosted_branches SET status='failed',result=$2 WHERE id=$1",[branch.branchId,JSON.stringify({receipt:{reason:'ai_unavailable'}})]);
 expect((await hosted.agent.view('alice',session.id,0)).snapshot).toContain('ai_unavailable');
});

it('revokes a run admitted concurrently with stop and leaves the default session available',async()=>{
 let begin!:()=>void,release!:(value:{runId:string})=>void;const began=new Promise<void>(r=>begin=r),admission=new Promise<{runId:string}>(r=>release=r);const cancelled:string[]=[];
 const runner:RunnerService={...idleRunner,start:async()=>{begin();return admission;},cancel:async({runId})=>{cancelled.push(runId);}};
 const hosted=await createHostedRemoteAgent({runner,secret:'stop-race-secret-'.repeat(3),model:'fixture'});const session=await hosted.agent.ensure('alice');
 await hosted.agent.input('alice',session.id,'hello\r');const ticking=hosted.tick();await began;
 await hosted.agent.stop('alice',session.id);release({runId:'late-admission'});await ticking;
 expect(cancelled).toEqual(['late-admission']);expect((await hosted.coordinator.branches('alice','chat'))[0]?.status).toBe('cancelled');
 expect((await hosted.agent.ensure('alice')).online).toBe(true);
});

it('preserves an existing artifactbin session when naming the default hosted agent',async()=>{
 const db=await harness.db();const hosted=await createHostedRemoteAgent({runner:idleRunner,secret:'name-collision-secret-'.repeat(3),model:'fixture'});
 await db.query("INSERT INTO remote_agents(id,owner,name,proof_hash,info) VALUES('external','alice','artifactbin','external-proof',$1)",[JSON.stringify({id:'external',name:'artifactbin',managed:true})]);
 const session=await hosted.agent.ensure('alice');expect(session.id).not.toBe('external');expect(session.name).toContain('hosted');expect(session.online).toBe(true);
 expect(await hosted.agent.ensure('alice')).toMatchObject({id:session.id,name:session.name});
 expect((await db.query<{name:string}>("SELECT name FROM remote_agents WHERE id='external'")).rows[0]?.name).toBe('artifactbin');
 expect((await db.query<{name:string;info:{name:string}}>('SELECT name,info FROM remote_agents WHERE id=$1',[session.id])).rows[0]).toMatchObject({name:session.name,info:{name:session.name}});
});

it('reports owner-scoped pending and running work until terminal completion',async()=>{
 const db=await harness.db();const hosted=await createHostedRemoteAgent({runner:idleRunner,secret:'activity-secret-'.repeat(3),model:'fixture'});
 const session=await hosted.agent.ensure('alice');expect(session.activity).toBe('listening');
 const {branchId}=await hosted.coordinator.dispatch({userId:'alice',artifactId:'doc',requestId:'activity',message:'review',model:'fixture'});
 expect((await hosted.agent.ensure('alice')).activity).toBe('working');expect((await hosted.agent.view('alice',session.id,0)).session.activity).toBe('working');
 await db.query("UPDATE hosted_branches SET status='running' WHERE id=$1",[branchId]);expect((await hosted.agent.ensure('alice')).activity).toBe('working');
 await hosted.coordinator.dispatch({userId:'bob',artifactId:'chat',requestId:'other',message:'hi',model:'fixture'});
 await db.query("UPDATE hosted_branches SET status='completed' WHERE id=$1",[branchId]);
 expect((await hosted.agent.ensure('alice')).activity).toBe('listening');expect((await hosted.agent.view('alice',session.id,0)).session.activity).toBe('listening');
});
