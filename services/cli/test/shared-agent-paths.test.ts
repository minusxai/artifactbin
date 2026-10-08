import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {hostedWorkerEnv} from '../src/config';
import {hostedHarnessArguments,prepareHostedHarness} from '../src/hosted-agent';
test('two Claude agents share provider HOME but own independent identity files and resume the single existing native transcript',async()=>{
 const home=await mkdtemp(join(tmpdir(),'af-shared-home-'));try{
  const a={cwd:join(home,'agents','alice-a'),stateDirectory:join(home,'agents','alice-a','.artifactbin','hosted-agent')},b={cwd:join(home,'agents','alice-b'),stateDirectory:join(home,'agents','alice-b','.artifactbin','hosted-agent')};
  const first=await hostedHarnessArguments('claude',home,'context-a',undefined,a),second=await hostedHarnessArguments('claude',home,'context-b',undefined,b);
  const one=first[first.indexOf('--session-id')+1],two=second[second.indexOf('--session-id')+1];assert.ok(one);assert.ok(two);assert.notEqual(one,two);
  assert.equal((await readFile(join(a.stateDirectory,'claude-session'),'utf8')).trim(),one);assert.equal((await readFile(join(b.stateDirectory,'claude-session'),'utf8')).trim(),two);
  const directory=join(home,'.claude','projects','original-workspace');await mkdir(directory,{recursive:true});await writeFile(join(directory,one+'.jsonl'),'{}\n');
  const resumed=await hostedHarnessArguments('claude',home,'new-context',undefined,a);assert.equal(resumed[resumed.indexOf('--resume')+1],one);assert.equal((await readFile(join(b.stateDirectory,'claude-session'),'utf8')).trim(),two);
 }finally{await rm(home,{recursive:true,force:true});}
});
test('Pi journal and pinned Codex identity stay agent-scoped while shared provider configuration remains untouched',async()=>{
 const home=await mkdtemp(join(tmpdir(),'af-shared-native-'));try{
  const a={cwd:join(home,'agents','a'),stateDirectory:join(home,'agents','a','.artifactbin','hosted-agent')},b={cwd:join(home,'agents','b'),stateDirectory:join(home,'agents','b','.artifactbin','hosted-agent')};
  const piA=await hostedHarnessArguments('pi',home,'context-a',undefined,a),piB=await hostedHarnessArguments('pi',home,'context-b',undefined,b);assert.notEqual(piA[1],piB[1]);assert.equal(piA[1],join(a.stateDirectory,'pi-session.jsonl'));
  const codexHome=join(home,'.codex');await mkdir(codexHome,{recursive:true});await writeFile(join(codexHome,'auth.json'),'mxmx_test_provider_config');
  const one='11111111-1111-4111-8111-111111111111',two='22222222-2222-4222-8222-222222222222';await mkdir(a.stateDirectory,{recursive:true});await mkdir(b.stateDirectory,{recursive:true});await writeFile(join(a.stateDirectory,'codex-session'),one);await writeFile(join(b.stateDirectory,'codex-session'),two);
  assert.equal((await hostedHarnessArguments('codex',home,'context',undefined,a))[1],one);assert.equal((await hostedHarnessArguments('codex',home,'context',undefined,b))[1],two);assert.equal(await readFile(join(codexHome,'auth.json'),'utf8'),'mxmx_test_provider_config');
 }finally{await rm(home,{recursive:true,force:true});}
});

test('Codex and OpenCode discovery select only the agent cwd and startup uses its private database',async()=>{
 const home=await mkdtemp(join(tmpdir(),'af-shared-discovery-'));try{
  const a={cwd:join(home,'agents','a'),stateDirectory:join(home,'agents','a','.artifactbin','hosted-agent')};
  const original='11111111-1111-4111-8111-111111111111',foreign='22222222-2222-4222-8222-222222222222';
  const sessions=join(home,'.codex','sessions');await mkdir(sessions,{recursive:true});
  for(const [id,cwd,timestamp] of [[foreign,home,'2020-01-01T00:00:00Z'],[original,a.cwd,'2021-01-01T00:00:00Z']])await writeFile(join(sessions,id+'.jsonl'),JSON.stringify({type:'session_meta',payload:{id,cwd,source:'vscode',timestamp}})+'\n');
  assert.equal((await hostedHarnessArguments('codex',home,'context',undefined,a))[1],original);
  const env=hostedWorkerEnv('opencode',home,a.stateDirectory,':',{server:'http://localhost:7845',token:'mxmx_test_connection'},{PATH:'/fixture/bin',HOME:'/foreign',ARTIFACTBIN_HOME:'/foreign/state'});
  assert.equal(env.HOME,home);assert.equal(env.ARTIFACTBIN_HOME,join(a.cwd,'.artifactbin'));assert.equal(env.OPENCODE_DB,join(a.stateDirectory,'opencode.db'));assert.equal(env.ARTIFACTBIN_SKILLS,'off');assert.equal(env.CLI__DISABLE_AUTO_UPDATES,'1');
  const startup:Array<{cwd:string;env:NodeJS.ProcessEnv}>=[];
  const args=await prepareHostedHarness({command:'opencode',home,...a,context:'context',env,listOpenCodeSessions:async()=>JSON.stringify([{id:'ses_foreign',directory:home,created:0},{id:'ses_owned',directory:a.cwd,created:1}]),runStartup:async(_args,options)=>{startup.push(options);}});
  assert.deepEqual(args,['--session','ses_owned']);assert.equal(startup[0]?.cwd,a.cwd);assert.equal(startup[0]?.env.OPENCODE_DB,env.OPENCODE_DB);
 }finally{await rm(home,{recursive:true,force:true});}
});
