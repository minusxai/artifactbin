import {afterEach,expect,it} from 'vitest';
import {attachActor} from '@artifactbin/utils';
import {useAppHarness,request} from './harness';
import {mintToken,claimToken,createUser} from '@/lib/accounts';
import {POST as publish} from '@/app/api/artifacts/route';
import {invokeArtifact,runRequest,setLambdaProgramResolver,runnerOperation,startLambdaSchedules,artifactSchedule,deleteSchedule} from '@/lib/runner';
import {setServices} from '@/lib/platform/services';
import {createRunner} from '../../runner/src/local';
const harness=useAppHarness();const close:Array<()=>Promise<unknown>>=[];afterEach(async()=>{setLambdaProgramResolver(undefined);setServices({runner:undefined});for(const fn of close.splice(0).reverse())await fn();});
it('pins the server-selected artifact program, protects owner reads and composes API and cron',async()=>{
 const db=await harness.db();const owner=await createUser({email:'mxmx_test_runner_api@example.com'}),token=await mintToken('runner');await claimToken(owner.id,token.token);
 const published=await publish(request('/api/artifacts',{method:'POST',token:token.token,json:{markup:'<p>Lambda adapter fixture</p>'}}));const doc=await published.json();
 const runner=await createRunner({db,dockerImage:process.env.RUNNER_TEST_IMAGE,capabilities:async()=>null});setServices({runner});close.push(()=>runner.close());
 const stop=await startLambdaSchedules(db);close.push(stop);
 const req=(path:string,input?:unknown,userId=owner.id)=>attachActor(new Request('http://localhost'+path,{method:input===undefined?'GET':'POST',headers:{'content-type':'application/json'},...(input===undefined?{}:{body:JSON.stringify(input)})}),{credential:'session',userId});
 expect((await invokeArtifact(req('/run',{requestId:'one'}),doc.id)).status).toBe(400);
 setLambdaProgramResolver(async id=>id===doc.id?{version:'pinned-1',program:{source:'export default i=>i',language:'typescript'}}:null);
 const response=await invokeArtifact(req('/run',{requestId:'one',input:12,userId:'forged',program:{source:'bad'}}),doc.id);expect(response.status).toBe(202);const {runId}=await response.json();
 for(let i=0;i<1200;i++){const result=await runner.getRun({userId:owner.id,runId});if(result.receipt)break;await new Promise(r=>setTimeout(r,10));}
 expect((await runner.getRun({userId:owner.id,runId})).output).toBe(12);
 expect((await db.query<{request:{artifactVersion:string;userId:string}}>('SELECT request FROM runner_runs WHERE id=$1',[runId])).rows[0]?.request).toMatchObject({artifactVersion:'pinned-1',userId:owner.id});
 expect((await runRequest(req('/run',undefined,'other-user'),runId,'get')).status).toBe(404);
 expect((await invokeArtifact(req('/run',{requestId:'foreign'},'other-user'),doc.id)).status).toBe(404);
 const schedule=await artifactSchedule(req('/schedule',{cron:'*/5 * * * *',timezone:'UTC'}),doc.id);expect(schedule.status).toBe(201);const {id}=await schedule.json();
 expect((await deleteSchedule(req('/schedule',{},'other-user'),id)).status).toBe(404);expect((await deleteSchedule(req('/schedule',{}),id)).status).toBe(200);
 const cross=attachActor(new Request('http://localhost/api/runner/operations',{method:'POST',headers:{origin:'https://evil.example','sec-fetch-site':'cross-site'}}),{userId:owner.id,credential:'session'});
 expect((await runnerOperation(cross,'update_artifact',{id:doc.id,markup:'bad'})).status).toBe(403);
});
