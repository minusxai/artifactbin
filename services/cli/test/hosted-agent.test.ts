import {test} from 'node:test';
import {createServer} from 'node:http';
import {existsSync,readFileSync,realpathSync} from 'node:fs';
import {pty} from '../src/pty';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {hostedHarnessArguments,prepareHostedHarness,runHostedAgent} from '../src/hosted-agent';
test('Claude reuses its explicit session only after a transcript exists, including a login-only restart',async()=>{
 const home=await mkdtemp(join(tmpdir(),'af-hosted-'));try{
 const first=await hostedHarnessArguments('claude',home,'context');
 assert.ok(first.includes('--session-id'));const id=first[first.indexOf('--session-id')+1]!;
 assert.deepEqual(await hostedHarnessArguments('claude',home,'context'),first);
 await mkdir(join(home,'.claude','projects','-home-runner'),{recursive:true});
 await writeFile(join(home,'.claude','projects','-home-runner',id+'.jsonl'),'{}\n');
 const resumed=await hostedHarnessArguments('claude',home,'context');assert.ok(resumed.includes('--resume'));assert.equal(resumed[resumed.indexOf('--resume')+1],id);
 }finally{await rm(home,{recursive:true,force:true});}
});
test('Codex resumes an explicit retained session and ignores malformed or other workspace transcripts',async()=>{
 const home=await mkdtemp(join(tmpdir(),'af-hosted-'));try{
 assert.ok(!(await hostedHarnessArguments('codex',home,'context')).includes('resume'));
 const dir=join(home,'.codex','sessions','2026');await mkdir(dir,{recursive:true});
 await writeFile(join(dir,'other.jsonl'),JSON.stringify({type:'session_meta',payload:{id:'other',cwd:'/different'}})+'\n');
 await writeFile(join(dir,'broken.jsonl'),'{');
 assert.ok(!(await hostedHarnessArguments('codex',home,'context')).includes('resume'));
 const id='a37c7d1b-c1f0-445b-883e-21c29b385a28';await writeFile(join(dir,'session.jsonl'),JSON.stringify({type:'session_meta',payload:{id,cwd:home,source:'cli'}})+'\n');
 const args=await hostedHarnessArguments('codex',home,'context');
 await writeFile(join(dir,'newer.jsonl'),JSON.stringify({type:'session_meta',payload:{id:'b37c7d1b-c1f0-445b-883e-21c29b385a28',cwd:home,source:'exec'}})+'\n');
 assert.deepEqual(await hostedHarnessArguments('codex',home,'context'),args);assert.equal(args[0],'resume');assert.ok(args.includes(id));assert.ok(!args.includes('--last'));
 }finally{await rm(home,{recursive:true,force:true});}
});

test('Pi always opens its one explicit retained journal',async()=>{
 const home=await mkdtemp(join(tmpdir(),'af-hosted-'));try{
 const args=await hostedHarnessArguments('pi',home,'context');
 assert.equal(args[0],'--session');assert.equal(args[1],join(home,'.artifactbin','hosted-agent','pi-session.jsonl'));
 await writeFile(args[1]!,'{"type":"session"}\n');assert.deepEqual(await hostedHarnessArguments('pi',home,'context'),args);
 }finally{await rm(home,{recursive:true,force:true});}
});

test('OpenCode pins the first owned root session and never switches to a newer thread',async()=>{
 const home=await mkdtemp(join(tmpdir(),'af-hosted-'));try{
 let rows='';const list=async()=>rows;
 assert.deepEqual(await hostedHarnessArguments('opencode',home,'context',list),['--prompt','context']);
 rows=JSON.stringify([{id:'ses_later',directory:home,created:200},{id:'ses_first',directory:home,created:100},{id:'ses_other',directory:'/other',created:1},{id:'ses_child',directory:home,parentID:'ses_first',created:0}]);
 const args=await hostedHarnessArguments('opencode',home,'context',list);assert.deepEqual(args,['--session','ses_first','--prompt','context']);
 assert.deepEqual(await hostedHarnessArguments('opencode',home,'context',async()=>{throw Error('must not rediscover pinned identity');}),args);
 }finally{await rm(home,{recursive:true,force:true});}
});


test('Codex recovers shared-daemon interactive sessions and pins the earliest owned root',async()=>{
 const home=await mkdtemp(join(tmpdir(),'af-hosted-daemon-'));try{
 const dir=join(home,'.codex','sessions','2026');await mkdir(dir,{recursive:true});
 const original='01a11937-c9fe-7461-8e50-a882225062d6';
 const rows=[
  {id:'11111111-1111-4111-8111-111111111111',cwd:'/other',source:'vscode',timestamp:'2026-10-08T01:00:00Z'},
  {id:'22222222-2222-4222-8222-222222222222',cwd:home,source:'exec',timestamp:'2026-10-08T01:01:00Z'},
  {id:'33333333-3333-4333-8333-333333333333',cwd:home,source:{subagent:{thread_spawn:{parent_thread_id:original}}},timestamp:'2026-10-08T01:02:00Z'},
  {id:original,cwd:home,source:'vscode',timestamp:'2026-10-08T01:54:09Z',base_instructions:{text:'native instructions '.repeat(2048)}},
  {id:'01a1193d-4437-7882-bd5a-cc20aed14c90',cwd:home,source:'cli',timestamp:'2026-10-08T02:00:08Z'}
 ];
 for(const [i,payload] of rows.entries())await writeFile(join(dir,i+'.jsonl'),JSON.stringify({type:'session_meta',payload})+'\n');
 const args=await hostedHarnessArguments('codex',home,'context');assert.equal(args[0],'resume');assert.equal(args[1],original);
 await writeFile(join(dir,'earlier.jsonl'),JSON.stringify({type:'session_meta',payload:{id:'44444444-4444-4444-8444-444444444444',cwd:home,source:'vscode',timestamp:'2026-10-08T01:30:00Z'}})+'\n');
 assert.deepEqual(await hostedHarnessArguments('codex',home,'context'),args);
 }finally{await rm(home,{recursive:true,force:true});}
});


test('resumed OpenCode completes native startup in its explicit session before opening the TUI',async()=>{
 const home=await mkdtemp(join(tmpdir(),'af-opencode-startup-'));try{
 const env={HOME:home,AFBIN_TEST:'private'},calls:Array<{args:string[];env:NodeJS.ProcessEnv;cwd:string}>=[];
 const runStartup=async(args:string[],options:{cwd:string;env:NodeJS.ProcessEnv})=>{calls.push({args,...options});};
 const fresh=await prepareHostedHarness({command:'opencode',home,context:'startup-context',env,listOpenCodeSessions:async()=>'[]',runStartup});
 assert.deepEqual(fresh,['--prompt','startup-context']);assert.equal(calls.length,0);
 const args=await prepareHostedHarness({command:'opencode',home,context:'startup-context',env,listOpenCodeSessions:async()=>JSON.stringify([{id:'ses_original',directory:home,created:1}]),runStartup});
 assert.deepEqual(args,['--session','ses_original']);assert.equal(calls.length,1);assert.deepEqual(calls[0],{args:['run','--session','ses_original','--format','json','startup-context'],cwd:home,env});
 let notice=false;
 const login=await prepareHostedHarness({command:'opencode',home,context:'startup-context',env,runStartup:async()=>{throw Error('provider_auth_required');},onStartupUnavailable:()=>{notice=true;}});
 assert.deepEqual(login,args);assert.equal(notice,true);
 const abort=new AbortController();abort.abort(new Error('cancelled'));
 await assert.rejects(prepareHostedHarness({command:'opencode',home,context:'startup-context',env,signal:abort.signal,runStartup:async()=>{throw abort.signal.reason;}}),/cancelled/);
 }finally{await rm(home,{recursive:true,force:true});}
});


test('OpenCode native startup receives EOF and retained environment before returning TUI arguments',{skip:process.platform==='win32'},async()=>{
 const home=await mkdtemp(join(tmpdir(),'af-opencode-native-startup-'));try{
 const bin=join(home,'bin');await mkdir(bin);
 await writeFile(join(bin,'opencode'),`#!${process.execPath}
const fs=require('node:fs');(async()=>{for await(const chunk of process.stdin){};fs.writeFileSync(${JSON.stringify(join(home,'startup-proof'))},JSON.stringify({args:process.argv.slice(2),proof:process.env.AFBIN_TEST}));})();
`,{mode:0o700});
 const args=await prepareHostedHarness({command:'opencode',home,context:'startup-context',env:{PATH:bin,HOME:home,AFBIN_TEST:'mxmx_test_retained'},listOpenCodeSessions:async()=>JSON.stringify([{id:'ses_native',directory:home,created:1}])});
 assert.deepEqual(JSON.parse(await readFile(join(home,'startup-proof'),'utf8')),{args:['run','--session','ses_native','--format','json','startup-context'],proof:'mxmx_test_retained'});
 assert.deepEqual(args,['--session','ses_native']);
 }finally{await rm(home,{recursive:true,force:true});}
});


test('hosted OpenCode registration and native startup precede PTY spawn and comment exchange',{skip:process.platform==='win32'},async t=>{
 const home=await mkdtemp(join(tmpdir(),'af-opencode-launch-order-')),priorPath=process.env.PATH;
 const bin=join(home,'bin'),proof=join(home,'startup-proof'),events:string[]=[];
 const cwd=join(home,'agents','fixture'),stateDirectory=join(cwd,'.artifactbin','hosted-agent');
 let onExit:((event:{exitCode:number})=>void)|undefined;
 const server=createServer(async(req,res)=>{for await(const _ of req){};res.setHeader('Content-Type','application/json');
  if(req.url==='/api/remote/sessions'){events.push('register');res.end(JSON.stringify({id:'mxmx_test_reserved',runnerKey:'mxmx_test_current_proof'}));return;}
  assert.ok(existsSync(proof),'startup completed before any comment exchange');events.push('exchange');onExit?.({exitCode:0});res.end(JSON.stringify({controller:'local',inputs:[]}));
 });
 try{
  await mkdir(bin);await mkdir(stateDirectory,{recursive:true});await writeFile(join(stateDirectory,'opencode-session'),'ses_owned');
  await writeFile(join(bin,'opencode'),`#!${process.execPath}\nconst fs=require('node:fs');(async()=>{for await(const chunk of process.stdin){};fs.writeFileSync(${JSON.stringify(proof)},JSON.stringify({args:process.argv.slice(2),id:process.env.ARTIFACTBIN__REMOTE_SESSION,proof:process.env.ARTIFACTBIN__REMOTE_PROOF,home:process.env.HOME,state:process.env.ARTIFACTBIN_HOME,db:process.env.OPENCODE_DB,cwd:process.cwd()}));})();\n`,{mode:0o700});process.env.PATH=bin;
  t.mock.method(process,'kill',()=>true);
  t.mock.method(pty,'spawn',(_command:string,args:string[],nativeOptions:import('node-pty').IPtyForkOptions)=>{
   const saved=JSON.parse(readFileSync(proof,'utf8'));assert.equal(saved.id,'mxmx_test_reserved');assert.equal(saved.proof,'mxmx_test_current_proof');assert.deepEqual(saved.args.slice(0,5),['run','--session','ses_owned','--format','json']);
   assert.deepEqual(args,['--session','ses_owned']);assert.equal(nativeOptions.cwd,cwd);assert.equal(nativeOptions.env?.HOME,home);assert.equal(saved.home,home);assert.equal(saved.cwd,realpathSync(cwd));assert.equal(saved.state,join(cwd,'.artifactbin'));assert.equal(saved.db,join(stateDirectory,'opencode.db'));assert.ok(existsSync(join(stateDirectory,'context.md')));assert.ok(!existsSync(join(home,'.artifactbin','hosted-agent','context.md')));events.push('pty');
   return {pid:12345,onData:()=>({dispose(){}}),onExit:(listener:(event:{exitCode:number})=>void)=>{onExit=listener;return {dispose(){}};},kill(){},resize(){},write(){}} as unknown as import('node-pty').IPty;
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  assert.equal(await runHostedAgent({id:'mxmx_test_reserved',generation:'mxmx_test_generation',name:'fixture',command:'opencode',home,cwd,stateDirectory,connection:{server:`http://127.0.0.1:${(server.address() as {port:number}).port}`,token:'mxmx_test_token'},executable:process.execPath,signal:AbortSignal.timeout(5000)}),0);
  assert.deepEqual(events.slice(0,3),['register','pty','exchange']);
 }finally{if(priorPath===undefined)delete process.env.PATH;else process.env.PATH=priorPath;await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(home,{recursive:true,force:true});}
});
