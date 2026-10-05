/** CI-only: installed serve owns editing/auth and forwards execution to an explicitly signed controller. */
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,access,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {randomBytes} from 'node:crypto';
import {setTimeout as sleep} from 'node:timers/promises';
import {runnerHttp} from '../../runner/src/http.ts';
import {getRequestListener} from '@hono/node-server';
const entry=resolve(process.argv[2]),runtime=join(dirname(entry),'runtime');
for(const file of ['runner-worker.mjs','agent.ts.txt'])await assert.rejects(access(join(runtime,file)),{code:'ENOENT'});
const secret=randomBytes(32).toString('hex'),calls=[];
const remote=createServer(getRequestListener(runnerHttp({
 start:async()=>{throw Error('not_used');},cancel:async()=>{throw Error('not_used');},events:async()=>{throw Error('not_used');},
 getRun:async input=>{calls.push(input);return {runId:input.runId,status:'completed',output:{remote:true},receipt:null};},
},secret).fetch));
await new Promise(done=>remote.listen(0,'127.0.0.1',done));
const root=await mkdtemp(join(tmpdir(),'afbin runner boundary é '));
let child,log='';
async function stop(){
 if(!child||child.exitCode!==null)return;
 const running=child;
 await new Promise((done,reject)=>{
  const timer=setTimeout(()=>{running.kill('SIGKILL');reject(Error('Serve failed graceful shutdown: '+log));},15000);
  running.once('exit',code=>{clearTimeout(timer);code===0?done():reject(Error('Serve shutdown code '+code+': '+log));});
  running.send({type:'afbin.shutdown'},error=>{if(error){clearTimeout(timer);reject(error);}});
 });child=undefined;
}
try{
 for(const configured of [false,true]){
  const directory=join(root,configured?'remote':'unconfigured');await mkdir(directory);
  const reserve=createServer();await new Promise(done=>reserve.listen(0,'127.0.0.1',done));
  const port=reserve.address().port;await new Promise(done=>reserve.close(done));
  const origin='http://127.0.0.1:'+port,file=join(directory,'server.env'),outbox=join(directory,'outbox.jsonl');
  await writeFile(file,`APP__HOST=127.0.0.1\nAPP__PORT=${port}\nAPP__PUBLIC_BASE_URL=${origin}\nAPP__PAGES_HOST=lvh.me\nAUTH__SECRET=${randomBytes(32).toString('hex')}\nEMAIL__DEV_OUTBOX_PATH=${outbox}\n`+(configured?`RUNNER__SERVICE_URL=http://127.0.0.1:${remote.address().port}\nCONTRACT__ACTOR_SECRET=${secret}\n`:''));
  log='';child=spawn(process.execPath,[entry,'serve','--config',file,'--dir',directory],{cwd:directory,env:{...process.env,HOME:directory,USERPROFILE:directory,XDG_CONFIG_HOME:join(directory,'config'),ARTIFACTBIN_SKILLS:'off',ARTIFACTBIN_HOME:join(directory,'client'),CLI__AUTO_UPDATE:'0'},stdio:['ignore','pipe','pipe','ipc']});
  for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>log=(log+chunk).slice(-12000));
  const deadline=Date.now()+90000;
  while(!log.includes('Team server listening')){if(child.exitCode!==null||Date.now()>deadline)throw Error('Serve failed readiness: '+log);await sleep(50);}
  const post=(path,body,cookie='')=>fetch(origin+path,{method:'POST',headers:{origin,cookie,'content-type':'application/json'},body:JSON.stringify(body)});
  const email=`mxmx_test_npm_runner_${configured?'remote':'none'}@example.test`;
  assert.equal((await post('/api/auth/email-otp/send-verification-otp',{email,type:'sign-in'})).status,200);
  const messages=(await readFile(outbox,'utf8')).trim().split('\n').map(line=>JSON.parse(line));
  const login=await post('/api/auth/sign-in/email-otp',{email,otp:messages.find(message=>message.to===email).otp});
  assert.equal(login.status,200,await login.clone().text());const account=await login.json();
  const cookie=login.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');
  const path='/api/runs/npm-proof';
  assert.equal((await fetch(origin+path)).status,401,'No unauthenticated runner access');
  const response=await fetch(origin+path,{headers:{cookie}}),body=await response.json();
  if(configured){assert.equal(response.status,200,JSON.stringify(body));assert.deepEqual(body.output,{remote:true});assert.deepEqual(calls,[{runId:'npm-proof',userId:account.user.id}]);}
  else{assert.equal(response.status,400);assert.deepEqual(body,{error:'runner_unavailable'});assert.equal(calls.length,0);}
  assert.doesNotMatch(log,/ERR_MODULE_NOT_FOUND|Cannot find (?:package|module).*isolated-vm/);
  await stop();
 }
 console.log('PASS installed serve: no local worker assets, email login, unavailable runner without config, signed owner-scoped remote runner, natural shutdown');
}finally{await stop();remote.closeAllConnections();await new Promise(done=>remote.close(done));await rm(root,{recursive:true,force:true});}
