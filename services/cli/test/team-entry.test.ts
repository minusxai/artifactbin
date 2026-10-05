import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn,type ChildProcess} from 'node:child_process';
import {mkdtemp,writeFile,readFile,rm,realpath} from 'node:fs/promises';
import {createServer} from 'node:net';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as sleep} from 'node:timers/promises';
import {PGlite} from '@electric-sql/pglite';
import {serve} from '@hono/node-server';
import {createRunner} from '../../runner/src/local';
import {runnerHttp} from '../../runner/src/http';
import {hostCapabilities,runnerIdentity,boundedJson} from '../../runner/src/capabilities';
import {overHttp} from '@artifactbin/utils';

test('foreground team process serves real login and excludes another database owner until shutdown',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'afbin-team-process-'));
 const reservation=createServer();await new Promise<void>(resolve=>reservation.listen(0,'127.0.0.1',resolve));
 const port=(reservation.address() as {port:number}).port;await new Promise<void>(resolve=>reservation.close(()=>resolve()));
 const file=join(directory,'server.env');
 const db=new PGlite(),secret='mxmx_test_team_runner_signing_secret';
 const appOrigin=`http://app.lvh.me:${port}`,forward=overHttp(appOrigin,secret);
 const runner=await createRunner({db,capabilities:hostCapabilities({artifactbin:async(context,operation,args)=>{
  const response=await forward(new Request(appOrigin+'/api/runner/operations',{method:'POST',headers:{'content-type':'application/json'},signal:context.signal,body:JSON.stringify({operation:operation.replace(/^artifactbin\./,''),input:args,documentSource:context.request.document?.source})}),runnerIdentity(context));
  if(!response.ok)throw Error('callback_http_'+response.status);return boundedJson(response,1024*1024);
 }})});
 const controller=serve({fetch:runnerHttp(runner,secret).fetch,hostname:'127.0.0.1',port:0});
 if(!controller.listening)await new Promise<void>(resolve=>controller.once('listening',resolve));
 const runnerPort=(controller.address() as {port:number}).port;
 await writeFile(file,`APP__HOST=127.0.0.1\nAPP__PORT=${port}\nAPP__PUBLIC_BASE_URL=http://app.lvh.me:${port}\nAUTH__SECRET=${'s'.repeat(48)}\nEMAIL__DEV_OUTBOX_PATH=outbox.jsonl\nRUNNER__SERVICE_URL=http://127.0.0.1:${runnerPort}\nCONTRACT__ACTOR_SECRET=${secret}\n`);
 const root=fileURLToPath(new URL('../../../',import.meta.url)),entry=new URL('../src/team-entry.ts',import.meta.url).href;
 const reporter=new URL('../src/operator-error.ts',import.meta.url).href;
 const children:ChildProcess[]=[];
 // The same two calls the packaged entrypoint makes: start the host, and report a startup failure.
 const script=`const {startTeamHost}=await import(${JSON.stringify(entry)});const {reportStartupFailure}=await import(${JSON.stringify(reporter)});`
  +`try{await startTeamHost(${JSON.stringify(file)},${JSON.stringify(resolve(root,'services/app'))});}catch(error){reportStartupFailure(error);process.exit(1);}`;
 const launch=()=>{
  const child=spawn(process.execPath,['--import','tsx','--input-type=module','-e',script],{cwd:root,stdio:['ignore','pipe','pipe']});
  children.push(child);let output='';child.stdout!.on('data',chunk=>{output+=chunk;});child.stderr!.on('data',chunk=>{output+=chunk;});
  return {child,output:()=>output};
 };
 const ready=async(process:ReturnType<typeof launch>)=>{
  const deadline=Date.now()+20000;
  while(!process.output().includes('Team server listening')){
   if(process.child.exitCode!==null||Date.now()>deadline)throw new Error('Team startup failed: '+process.output());
   await sleep(40);
  }
 };
 const exited=(child:ChildProcess)=>child.exitCode!==null?Promise.resolve(child.exitCode):new Promise<number|null>(resolve=>child.once('exit',resolve));
 try{
  const first=launch();await ready(first);
  // Startup teaches the operator what to hand teammates, not just that a socket is open.
  assert.ok(first.output().includes(`npx --yes @afbin/cli@latest config set host http://app.lvh.me:${port}`));
  assert.ok(first.output().includes(`http://app.lvh.me:${port}/chat/ensure-node.sh`));
  assert.ok(first.output().includes(`npx --yes @afbin/cli@latest setup --server http://app.lvh.me:${port}`));
  assert.match(first.output(),/\[dev-mail\] otp/);
  const response=await fetch(`http://app.lvh.me:${port}/api/auth/get-session`);assert.equal(response.status,200);assert.equal(await response.json(),null);
  // The shipped host authenticates and submits a published lambda to a real signed HTTP runner.
  const origin=`http://app.lvh.me:${port}`,email='mxmx_test_team_lambda@example.test';
  const post=async(path:string,body:unknown,cookie='')=>fetch(origin+path,{method:'POST',headers:{origin,cookie,'content-type':'application/json'},body:JSON.stringify(body)});
  assert.equal((await post('/api/auth/email-otp/send-verification-otp',{email,type:'sign-in'})).status,200);
  const mail=(await readFile(join(directory,'outbox.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line));
  const login=await post('/api/auth/sign-in/email-otp',{email,otp:mail.find(message=>message.to===email).otp});assert.equal(login.status,200);
  const cookie=login.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');
  const published=await post('/api/my/artifacts',{markup:'<Helmet><Value name="items" type="table" value={[{n:42}]} /><Query name="answer">{`select n from items`}</Query><script>{`import {query} from "page"; const answer=query("$answer"); export default async input => ({message: "Hello " + input.name, rows: await answer.ready})`}</script></Helmet><p>Hello lambda</p>',visibility:'private'},cookie);
  assert.equal(published.status,201,await published.clone().text());const artifact=await published.json();
  const admitted=await post(`/api/artifacts/${artifact.id}/runs`,{requestId:'hello-1',input:{name:'OSS'}},cookie);
  assert.equal(admitted.status,202,await admitted.clone().text());const {runId}=await admitted.json();
  const deadline=Date.now()+15000;let result;
  do{const status=await fetch(origin+'/api/runs/'+runId,{headers:{cookie}});assert.equal(status.status,200);result=await status.json();if(result.receipt)break;await sleep(20);}while(Date.now()<deadline);
  assert.equal(result.status,'completed',JSON.stringify(result));assert.deepEqual(result.output,{message:'Hello OSS',rows:[{n:42}]});
  const schedule=await post(`/api/artifacts/${artifact.id}/schedules`,{cron:'*/5 * * * *',timezone:'UTC',input:{name:'scheduled OSS'}},cookie);
  assert.equal(schedule.status,201,await schedule.clone().text());const {id:scheduleId}=await schedule.json();
  assert.equal((await fetch(origin+'/api/schedules/'+scheduleId,{method:'DELETE',headers:{origin,cookie}})).status,200);
  const second=launch();assert.notEqual(await exited(second.child),0);
  const owned=await realpath(directory);
  assert.match(second.output(),new RegExp(`Another afbin serve is already using ${owned.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}\\.`));
  assert.doesNotMatch(second.output(),/\n\s+at /,'an operator failure is one line, not a runtime stack');
  first.child.kill('SIGTERM');assert.equal(await exited(first.child),0);
  const restarted=launch();await ready(restarted);restarted.child.kill('SIGTERM');assert.equal(await exited(restarted.child),0);
 }finally{
  for(const child of children)if(child.exitCode===null){child.kill('SIGKILL');await exited(child);}
  await new Promise<void>(resolve=>controller.close(()=>resolve()));await runner.close();await db.close();
  await rm(directory,{recursive:true,force:true});
 }
});
