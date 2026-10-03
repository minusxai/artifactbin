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
