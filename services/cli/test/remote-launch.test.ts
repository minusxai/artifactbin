import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {launchRemote} from '../src/remote-launch';

test('detached launch returns a registered receipt, passes credentials only through IPC and snapshots history without changing argv',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'afbin-remote-'));
 try{
  const history=join(dir,'history.md');await writeFile(history,'Context with $(literal) and `ticks`.');
  const worker=join(dir,'worker.mjs');
  await writeFile(worker,`import {writeFileSync} from 'node:fs';process.once('message',m=>{writeFileSync(${JSON.stringify(join(dir,'received.json'))},JSON.stringify({m,argv:process.argv}));process.send({id:'session',name:'claude',url:'http://localhost:3000/chat?session=session',status:'starting',pid:process.pid});process.disconnect();setTimeout(()=>process.exit(0),200);});`);
  const receipt=await launchRemote({connection:{server:'http://localhost:3000',token:'test-only-secret'},command:'claude',args:['--chrome','literal space'],history,cwd:dir,home:dir,env:{...process.env,ARTIFACTBIN_HOME:join(dir,'state')},worker:{command:process.execPath,args:[worker]}});
  assert.equal(receipt.name,'claude');assert.equal(receipt.status,'starting');
  const received=JSON.parse(await readFile(join(dir,'received.json'),'utf8'));
  assert.deepEqual(received.m.args,['--chrome','literal space']);assert.equal(received.m.history,'Context with $(literal) and `ticks`.');
  assert.equal(received.m.connection.token,'test-only-secret');assert.ok(!JSON.stringify(received.argv).includes('secret'));
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('startup failure and timeout reject instead of claiming a running agent',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'afbin-remote-fail-'));
 try{
  const opts={connection:{server:'http://localhost:3000',token:'test'},command:'claude',args:[],cwd:dir,home:dir,timeoutMs:200};
  await assert.rejects(launchRemote({...opts,worker:{command:process.execPath,args:['-e','process.exit(3)']}}),/exited|start/i);
  await assert.rejects(launchRemote({...opts,worker:{command:process.execPath,args:['-e','setInterval(()=>{},1000)']}}),/timed out/i);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('missing history and invalid names fail before spawning',async()=>{
 const opts={connection:{server:'http://localhost:3000',token:'test'},command:'claude',args:[],cwd:tmpdir(),home:tmpdir()};
 await assert.rejects(launchRemote({...opts,history:'/no-such-history.md'}),/history|ENOENT/i);
 await assert.rejects(launchRemote({...opts,name:'two words'}),/name/i);
});

import {remoteArguments} from '../src/remote-context';
test('each supported harness receives bootstrap context without changing its supplied flag values',()=>{
 for(const command of ['claude','codex','pi','opencode']){
  const args=remoteArguments(command,['--model','my model'],'Read /private/context.md');
  assert.deepEqual(args.slice(0,2),['--model','my model']);assert.ok(args.includes('Read /private/context.md'));
  if(command==='opencode')assert.equal(args[args.length-2],'--prompt');
 }
 assert.deepEqual(remoteArguments('/bin/sh',['-c','echo yes'],'context'),['-c','echo yes']);
});

import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
test('real detached worker retains its PTY after launch returns and stops when the relay requests it',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'afbin-real-worker-'));let output='',exited=false,stop=false;
 const server=createServer(async(req,res)=>{
  let raw='';for await(const c of req)raw+=c;const data=JSON.parse(raw||'{}');res.setHeader('Content-Type','application/json');
  if(req.url==='/api/remote/sessions'){assert.equal(data.managed,true);res.end(JSON.stringify({id:'real-worker',runnerKey:'proof'}));return;}
  output+=data.output??'';if(data.exitCode!==undefined)exited=true;
  if(output.includes('ALIVE'))stop=true;
  res.end(JSON.stringify({controller:'local',inputs:[],stop}));
 });
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const port=(server.address() as {port:number}).port;
 let pid:number|undefined;
 try{
  const result=await launchRemote({connection:{server:`http://127.0.0.1:${port}`,token:'test-only'},command:'/bin/sh',args:['-c','sleep 20 & echo $! > descendant.pid; sleep 0.3; echo ALIVE; wait'],cwd:dir,home:dir,env:{...process.env,ARTIFACTBIN_HOME:join(dir,'state')},worker:{command:process.execPath,args:['--import',fileURLToPath(new URL('../../../node_modules/tsx/dist/loader.mjs',import.meta.url)),fileURLToPath(new URL('../src/main.ts',import.meta.url)),'--internal-remote-worker']}});
  pid=result.pid;assert.equal(result.status,'starting');
  for(let i=0;i<60&&!exited;i++)await delay(100);
  assert.ok(output.includes('ALIVE'));assert.equal(exited,true,'stop must terminate the managed child and relay its exit');
  const descendant=Number(await readFile(join(dir,'descendant.pid'),'utf8'));
  let alive=true;for(let i=0;i<20&&alive;i++){await delay(50);try{process.kill(descendant,0);}catch{alive=false;}}
  assert.equal(alive,false,'stop must kill descendants, not just the shell');
 }finally{if(pid)try{process.kill(pid,'SIGTERM');}catch{}server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));await rm(dir,{recursive:true,force:true});}
});

import {State,HOME_SCOPE} from '../src/state';
import {stopLocalRemote,remoteStateKey} from '../src/remote-state';
test('local stop is server scoped and uses a worker request instead of signaling a saved PID',async()=>{
 const home=await mkdtemp(join(tmpdir(),'afbin-stop-'));const env={ARTIFACTBIN_HOME:home};const server='http://localhost:5401';
 const state=await State.open(home,env);
 try{
  state.put(HOME_SCOPE,'remote-agent',remoteStateKey(server,'test'),{id:'test',server,pid:process.pid,directory:home,historyDigest:'digest',stopRequested:false});
  assert.equal(await stopLocalRemote(home,'http://localhost:5402','test',env),false);
  assert.equal(await stopLocalRemote(home,server,'test',env),true);
  assert.equal(state.get<{stopRequested:boolean}>(HOME_SCOPE,'remote-agent',remoteStateKey(server,'test'))?.value.stopRequested,true);
 }finally{state.close();await rm(home,{recursive:true,force:true});}
});

import {remoteRequestInput} from '../src/remote-context';
test('every request repeats the exact CLI executable so a login shell or compaction cannot select an old installation',()=>{
 const data=remoteRequestInput(JSON.stringify({type:'artifactbin.comment',body:'a "quote"',request_id:'request'})+'\r',"/private/context's/afbin");
 assert.equal(data.at(-1),'\r');const payload=JSON.parse(data.trim());
 assert.equal(payload.cli_executable,"/private/context's/afbin");assert.equal(payload.body,'a "quote"');assert.match(payload.instruction,/absolute/);
});

import {runRemote} from '../src/runner';
import type {HttpClient} from '../src/http';
test('failure to persist the startup receipt kills the spawned PTY and releases the registration',async()=>{
 let pid:number|undefined;let removed=false;
 const client={connection:{server:'http://localhost:5401'},request:async(_path:string,method:string)=>{if(method==='DELETE')removed=true;return {id:'startup-failure',runnerKey:'test-proof'};}} as unknown as HttpClient;
 try{
  await assert.rejects(runRemote({client,command:'/bin/sh',args:['-c','sleep 20'],interactive:false,managed:true,onStarted:(_session,childPid)=>{pid=childPid;throw new Error('state write failed');}}),/state write failed/);
  let alive=true;for(let i=0;i<20&&alive;i++){await delay(50);try{process.kill(pid!,0);}catch{alive=false;}}
  assert.equal(alive,false,'a failed startup receipt must not leave a running agent');
  assert.equal(removed,true,'failed startup must release the reserved session');
 }finally{if(pid)try{process.kill(-pid,'SIGKILL');}catch{}}
});
