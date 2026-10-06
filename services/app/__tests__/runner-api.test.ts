import {readFileSync} from 'node:fs';
import type {RunnerService,RunStart} from '@artifactbin/contracts';
import {POST as startRun} from '@/app/api/artifacts/[id]/runs/route';
import {GET as readRun} from '@/app/api/runs/[id]/route';
import {GET as readEvents} from '@/app/api/runs/[id]/events/route';
import {POST as cancelRun} from '@/app/api/runs/[id]/cancel/route';
import {afterEach,expect,it} from 'vitest';
import {attachActor} from '@artifactbin/utils';
import {useAppHarness,request} from './harness';
import {mintToken,claimToken,createUser} from '@/lib/accounts';
import {POST as publish} from '@/app/api/artifacts/route';
import {invokeArtifact,runRequest,setLambdaProgramResolver,runnerOperation,startLambdaSchedules,artifactSchedule,deleteSchedule} from '@/lib/runner';
import {getArtifactById} from '@/lib/artifacts';
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
 expect((await db.query<{request:{artifactVersion:string;userId:string;document:{source:string;editId:string}}}>('SELECT request FROM runner_runs WHERE id=$1',[runId])).rows[0]?.request).toMatchObject({artifactVersion:'pinned-1',userId:owner.id,document:{source:(await getArtifactById(doc.id))!.source,editId:expect.any(String)}});
 expect((await runRequest(req('/run',undefined,'other-user'),runId,'get')).status).toBe(404);
 expect((await invokeArtifact(req('/run',{requestId:'foreign'},'other-user'),doc.id)).status).toBe(404);
 const schedule=await artifactSchedule(req('/schedule',{cron:'*/5 * * * *',timezone:'UTC'}),doc.id);expect(schedule.status).toBe(201);const {id}=await schedule.json();
 expect((await deleteSchedule(req('/schedule',{},'other-user'),id)).status).toBe(404);expect((await deleteSchedule(req('/schedule',{}),id)).status).toBe(200);
 const cross=attachActor(new Request('http://localhost/api/runner/operations',{method:'POST',headers:{origin:'https://evil.example','sec-fetch-site':'cross-site'}}),{userId:owner.id,credential:'session'});
 expect((await runnerOperation(cross,'update_artifact',{id:doc.id,markup:'bad'})).status).toBe(403);
});

it('executes the documented HTTP handler lifecycle through authenticated routes',async()=>{
 const guide=readFileSync(new URL('../skills/artifactbin/references/lambdas.md',import.meta.url),'utf8');
 const authoring=readFileSync(new URL('../skills/artifactbin/references/http-authoring.md',import.meta.url),'utf8');
 const code=/```js\n(\/\/ BEGIN HTTP RUN[\s\S]*?\/\/ END HTTP RUN)\n```/.exec(guide)?.[1];
 expect(Buffer.byteLength(guide)).toBeLessThanOrEqual(8192);
 expect(code,'HTTP clients must discover and execute the existing runs contract').toBeTruthy();
 expect(authoring).toContain('[server handlers and runs](lambdas.md)');
 const owner=await createUser({email:'mxmx_test_http_run_doc@example.com'}),token=await mintToken('http-run-doc');await claimToken(owner.id,token.token);
 const published=await publish(request('/api/artifacts',{method:'POST',token:token.token,json:{markup:'<p>Run doc fixture</p>'}}));
 const doc=await published.json(),starts:RunStart[]=[];
 setLambdaProgramResolver(async()=>({version:'published-version',program:{source:'export default i=>i',language:'typescript'}}));
 const runner:RunnerService={start:async input=>{starts.push(input);return {runId:'run-doc'};},getRun:async({userId,runId})=>{
  if(userId!==owner.id)throw Error('not_found');return {runId,status:'running',output:null,receipt:null};
 },events:async({afterSequence,limit})=>{expect(afterSequence).toBe(0);expect(limit).toBe(100);return {events:[],nextSequence:0,hasMore:false};},cancel:async({userId,runId})=>{expect(userId).toBe(owner.id);expect(runId).toBe('run-doc');}};
 setServices({runner});
 const seen:string[]=[];
 const fetchSample=async(url:string,init?:RequestInit)=>{
  const parsed=new URL(url),path=parsed.pathname;seen.push(path);
  expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer '+token.token);
  const req=attachActor(request(path+parsed.search,{method:init?.method??'GET',token:token.token,
   ...(init?.body?{json:JSON.parse(String(init.body))}:{})}),{credential:'bearer',userId:owner.id,tokenId:token.id});
  const params={params:Promise.resolve({id:path.includes('/artifacts/')?doc.id:'run-doc'})};
  if(path.endsWith('/cancel'))return cancelRun(req,params);
  if(path.endsWith('/events'))return readEvents(req,params);
  if(path.endsWith('/runs'))return startRun(req,params);
  return readRun(req,params);
 };
 await new Function('fetch','base','accessToken','artifactId','return (async()=>{'+code+'\nawait cancelRun();\n})()')(fetchSample,'http://localhost',token.token,doc.id);
 expect(starts).toHaveLength(1);expect(starts[0]).toMatchObject({artifactId:doc.id,artifactVersion:'published-version',userId:owner.id,input:{name:'Ada'},requestId:'artifact:'+doc.id+':greeting-1'});
 expect(seen).toEqual(['/api/artifacts/'+doc.id+'/runs','/api/runs/run-doc','/api/runs/run-doc/events','/api/runs/run-doc/cancel']);
 expect((await readRun(request('/api/runs/run-doc'),{params:Promise.resolve({id:'run-doc'})})).status).toBe(401);
});
