import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {launchRemote} from '../src/remote-launch';
import {claudeConfigEnvironment} from '../src/config';

test('detached launch returns a registered receipt, passes credentials only through IPC and snapshots history without changing argv',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'afbin-remote-'));
 try{
  const history=join(dir,'history.md');await writeFile(history,'Context with $(literal) and `ticks`.');
  const worker=join(dir,'worker.mjs');
  await writeFile(worker,`import {writeFileSync} from 'node:fs';process.once('message',m=>{writeFileSync(${JSON.stringify(join(dir,'received.json'))},JSON.stringify({m,argv:process.argv,claudeConfigDir:process.env.CLAUDE_CONFIG_DIR}));process.send({id:'session',name:'claude',url:'http://localhost:3000/chat?session=session',status:'starting',pid:process.pid});process.disconnect();setTimeout(()=>process.exit(0),200);});`);
  const conversation={sessionId:'550e8400-e29b-41d4-a716-446655440000',command:'claude',args:['--chrome','--model','sonnet'],cwd:dir,claudeConfigDir:join(dir,'.claude'),claudeConfigDirExplicit:false};
  const resumeReservation={key:`http://localhost:3000/${conversation.sessionId}`,token:'test-reservation'};
  const launchEnv=claudeConfigEnvironment(join(dir,'.claude'),false,{...process.env,ARTIFACTBIN_HOME:join(dir,'state')});
  const receipt=await launchRemote({connection:{server:'http://localhost:3000',token:'test-only-secret'},command:'claude',args:['--chrome','--model','sonnet'],conversation,resumeReservation,history,cwd:dir,home:dir,env:launchEnv,worker:{command:process.execPath,args:[worker]}});
  assert.equal(receipt.name,'claude');assert.equal(receipt.status,'starting');
  const received=JSON.parse(await readFile(join(dir,'received.json'),'utf8'));
  assert.deepEqual(received.m.args,['--chrome','--model','sonnet']);assert.equal(received.m.history,'Context with $(literal) and `ticks`.');
  assert.equal(received.m.connection.token,'test-only-secret');assert.ok(!JSON.stringify(received.argv).includes('secret'));
  assert.deepEqual(received.m.conversation,conversation);assert.ok(!JSON.stringify(received.m.conversation).includes('test-only-secret'));
  assert.equal(received.claudeConfigDir,undefined);
  assert.deepEqual(received.m.resumeReservation,resumeReservation);
  await launchRemote({connection:{server:'http://localhost:3000',token:'test-only-secret'},command:'claude',args:['--chrome','--model','sonnet'],conversation:{...conversation,claudeConfigDirExplicit:true},cwd:dir,home:dir,env:claudeConfigEnvironment(join(dir,'custom-claude'),true,{...process.env,ARTIFACTBIN_HOME:join(dir,'state')}),worker:{command:process.execPath,args:[worker]}});
  const explicitLaunch=JSON.parse(await readFile(join(dir,'received.json'),'utf8'));
  assert.equal(explicitLaunch.claudeConfigDir,join(dir,'custom-claude'));
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
  const saved=await State.openReadOnly(dir,{ARTIFACTBIN_HOME:join(dir,'state')});
  try{const row=saved!.get<{directory:string}>(HOME_SCOPE,'remote-agent',remoteStateKey(`http://127.0.0.1:${port}`,'real-worker'));assert.equal(dirname(row!.value.directory),join(dir,'state'),'context must inherit the already-protected state boundary');}finally{saved?.close();}
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

import {remoteRequestInput,REMOTE_REVIEW_POLICY,COMMENT_IMAGE_INSTRUCTIONS} from '../src/remote-context';
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

test('managed harness defaults avoid routine permission prompts without changing caller arguments',()=>{
 const supplied=['--model','chosen'];
 assert.deepEqual(remoteArguments('/usr/local/bin/claude',supplied,'context'),[...supplied,'--dangerously-skip-permissions','context']);
 assert.deepEqual(remoteArguments('codex',supplied,'context'),[...supplied,'--yolo','context']);
 assert.deepEqual(remoteArguments('pi',supplied,'context'),[...supplied,'context']);
 assert.deepEqual(supplied,['--model','chosen']);
});
test('explicit permission modes and Codex profiles override managed defaults',()=>{
 for(const args of [['--permission-mode','plan'],['--permission-mode=default'],['--dangerously-skip-permissions']]){
  assert.deepEqual(remoteArguments('claude',args,'context'),[...args,'context']);
 }
 for(const args of [['--yolo'],['--dangerously-bypass-approvals-and-sandbox'],['--sandbox','read-only'],['--sandbox=workspace-write'],['-s','read-only'],['--ask-for-approval','on-request'],['-a','never'],['--approve-for-me'],['--full-auto'],['--profile','restricted'],['-p','restricted'],['-c','sandbox_mode="read-only"'],['--config=approval_policy="on-request"']]){
  assert.deepEqual(remoteArguments('codex',args,'context'),[...args,'context']);
 }
 assert.deepEqual(remoteArguments('codex',['-c','model="chosen"'],'context'),['-c','model="chosen"','--yolo','context']);
});

import {remotePermissionEnv,saveConnection} from '../src/config';
test('OpenCode receives per-process automatic permissions and preserves explicit environment overrides',()=>{
 const env={PATH:'/bin',OPENCODE_CONFIG_CONTENT:'{"model":"chosen"}'};
 assert.deepEqual(remotePermissionEnv('/bin/opencode',env),{...env,OPENCODE_PERMISSION:'{"*":"allow"}'});
 assert.deepEqual(remotePermissionEnv('opencode',{...env,OPENCODE_PERMISSION:'{"*":"ask"}'}),{...env,OPENCODE_PERMISSION:'{"*":"ask"}'});
 for(const harness of ['claude','codex','pi','sh'])assert.deepEqual(remotePermissionEnv(harness,env),env);
 assert.equal('OPENCODE_PERMISSION' in env,false);
});

test('every dispatched request teaches downloading and inspecting comment images before answering',()=>{
 const payload=JSON.parse(remoteRequestInput(JSON.stringify({type:'artifactbin.comment',instruction:'Acknowledge first.'}),'/private/afbin').trim());
 assert.match(payload.instruction,/--image/);assert.match(payload.instruction,/image viewing tool/);assert.match(payload.instruction,/drawn marks/);
});


test('startup and repeated requests require published edits, with a compact per-request reminder',()=>{
 const payload=JSON.parse(remoteRequestInput(JSON.stringify({type:'artifactbin.comment',instruction:'Acknowledge first.',body:'Please fix the title',request_id:'edit-request'}),'/private/afbin').trim());
 for(const instruction of [REMOTE_REVIEW_POLICY,payload.instruction]){
  assert.match(instruction,/update and publish the artifact before reporting completion or resolving/);
  assert.match(instruction,/For questions, answer directly without unsolicited edits/);
 }
 assert.equal(payload.body,'Please fix the title');assert.equal(payload.request_id,'edit-request');
 assert.match(payload.instruction,/Acknowledge first/);
 assert.ok(!payload.instruction.includes(COMMENT_IMAGE_INSTRUCTIONS),'full screenshot policy belongs in startup');
 assert.match(payload.instruction,/--image <image-id> --output <fresh-workspace-path>.webp --json/);
 assert.match(payload.instruction,/blocked/);
});

for(const ephemeral of [false,true])test(`generated managed helper restores ${ephemeral?'ephemeral':'saved'} auth and readiness after the harness filters Artifactbin environment`,async()=>{
 const dir=await mkdtemp(join(tmpdir(),'afbin-filtered-context-'));let ready=false,exited=false,output='';let pid:number|undefined;const proof='mxmx_test_filtered_proof';
 const server=createServer(async(req,res)=>{
  let raw='';for await(const chunk of req)raw+=chunk;const data=JSON.parse(raw||'{}');res.setHeader('Content-Type','application/json');
  if(req.url==='/api/remote/sessions'){res.end(JSON.stringify({id:'mxmx_test_filtered',runnerKey:proof}));return;}
  if(data.type==='ready'){assert.equal(data.proof,proof);assert.equal(req.headers.authorization,'Bearer mxmx_test_filtered_token');ready=true;res.end('{}');return;}
  output+=data.output??'';if(data.exitCode!==undefined)exited=true;res.end(JSON.stringify({controller:'local',inputs:[],stop:ready}));
 });
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const port=(server.address() as {port:number}).port,origin=`http://127.0.0.1:${port}`;
 try{
  const state=join(dir,'.artifactbin'),connection={server:origin,token:'mxmx_test_filtered_token'};
  if(!ephemeral)await saveConnection(connection,dir,{ARTIFACTBIN_HOME:state});
  const harness=join(dir,'filtered.mjs');
  await writeFile(harness,`import {execFileSync} from 'node:child_process';import {readFileSync,writeFileSync} from 'node:fs';const executable=process.env.PATH.split(':')[0]+'/afbin';const helper=readFileSync(executable,'utf8');writeFileSync(${JSON.stringify(join(dir,'helper.txt'))},helper);const env={...Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('ARTIFACTBIN'))),HOME:${JSON.stringify(dir)}};try{process.stdout.write(execFileSync(executable,['remote','--ready','mxmx_test_filtered','--server',${JSON.stringify(origin)},'--json'],{env,encoding:'utf8'}));}catch(error){process.stdout.write(error.stdout??'');process.stderr.write(error.stderr??'');process.exitCode=1;}`);
  const result=await launchRemote({connection,command:process.execPath,args:[harness],name:'filtered',cwd:dir,home:dir,env:{...process.env,ARTIFACTBIN_HOME:state,ARTIFACTBIN_SKILLS:'off',CLI__AUTO_UPDATE:'0',TSX_TSCONFIG_PATH:fileURLToPath(new URL('../../../tsconfig.json',import.meta.url))},worker:{command:process.execPath,args:['--import',fileURLToPath(new URL('../../../node_modules/tsx/dist/loader.mjs',import.meta.url)),fileURLToPath(new URL('../src/main.ts',import.meta.url)),'--internal-remote-worker']}});
  pid=result.pid;for(let i=0;i<100&&!exited;i++)await delay(100);
  assert.equal(ready,true,output);assert.ok(!output.includes(proof));assert.ok(!(await readFile(join(dir,'helper.txt'),'utf8')).includes(proof));assert.equal(exited,true);
 }finally{if(pid)try{process.kill(pid,'SIGTERM');}catch{}server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));await rm(dir,{recursive:true,force:true});}
});
test('hosted PTY uses the advertised fixed dimensions from registration through actual terminal execution',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'af-hosted-size-'));let output='',registered:Record<string,unknown>|undefined;
 const client={connection:{server:'http://localhost:5401'},request:async(_path:string,_method:string,body:Record<string,unknown>)=>{
  if(_path==='/remote/sessions'){registered=body;return {id:'hosted-size',runnerKey:'test-proof'};}
  output+=String(body.output??'');return {controller:'web',inputs:[],stop:output.includes('30 100')};
 }} as unknown as HttpClient;
 try{await runRemote({client,command:'/bin/sh',args:['-c','stty size; sleep 2'],cwd:dir,interactive:false,managed:true,hostedSessionId:'hosted-size',hostedGeneration:'test-generation'});
 assert.equal(registered?.cols,100);assert.equal(registered?.rows,30);assert.match(output,/30 100/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
