import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {hostedWorkerEnv} from '../src/config';
import {hostedHarnessArguments,prepareHostedHarness} from '../src/hosted-agent';
import {relocatePinnedOpenCodeSession} from '../src/hosted-opencode';
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

test('Codex and OpenCode discovery select only the agent cwd and resumed OpenCode uses its private database',async()=>{
 const home=await mkdtemp(join(tmpdir(),'af-shared-discovery-'));try{
  const a={cwd:join(home,'agents','a'),stateDirectory:join(home,'agents','a','.artifactbin','hosted-agent')};
  const original='11111111-1111-4111-8111-111111111111',foreign='22222222-2222-4222-8222-222222222222';
  const sessions=join(home,'.codex','sessions');await mkdir(sessions,{recursive:true});
  for(const [id,cwd,timestamp] of [[foreign,home,'2020-01-01T00:00:00Z'],[original,a.cwd,'2021-01-01T00:00:00Z']])await writeFile(join(sessions,id+'.jsonl'),JSON.stringify({type:'session_meta',payload:{id,cwd,source:'vscode',timestamp}})+'\n');
  assert.equal((await hostedHarnessArguments('codex',home,'context',undefined,a))[1],original);
  const env=hostedWorkerEnv('opencode',home,a.stateDirectory,':',{server:'http://localhost:7845',token:'mxmx_test_connection'},{PATH:'/fixture/bin',HOME:'/foreign',ARTIFACTBIN_HOME:'/foreign/state'},a.cwd);
  assert.equal(env.HOME,home);assert.equal(env.PWD,a.cwd);assert.equal(env.ARTIFACTBIN_HOME,join(a.cwd,'.artifactbin'));assert.equal(env.OPENCODE_DB,join(a.stateDirectory,'opencode.db'));assert.equal(env.ARTIFACTBIN_SKILLS,'off');assert.equal(env.CLI__DISABLE_AUTO_UPDATES,'1');
  await mkdir(a.stateDirectory,{recursive:true});seedNativeDatabase(a.stateDirectory,'ses_owned',home);
  const args=await prepareHostedHarness({command:'opencode',home,...a,context:'context',env,listOpenCodeSessions:async()=>JSON.stringify([{id:'ses_foreign',directory:home,created:0},{id:'ses_owned',directory:a.cwd,created:1}])});
  assert.deepEqual(args,['--mini','--session','ses_owned','--prompt','context']);assert.equal(env.OPENCODE_DB,join(a.stateDirectory,'opencode.db'));
  const db=new DatabaseSync(env.OPENCODE_DB,{readOnly:true});try{assert.equal(db.prepare('SELECT directory FROM session WHERE id=?').get('ses_owned')?.directory,a.cwd);}finally{db.close();}
 }finally{await rm(home,{recursive:true,force:true});}
});


function seedNativeDatabase(directory:string,sessionId:string,legacyCwd:string):void {
 const db=new DatabaseSync(join(directory,'opencode.db'));
 try{db.exec('CREATE TABLE session(id TEXT PRIMARY KEY,directory TEXT NOT NULL,project_id TEXT NOT NULL,path TEXT,parent_id TEXT,workspace_id TEXT,version TEXT,metadata TEXT); CREATE TABLE message(id TEXT PRIMARY KEY,session_id TEXT,data TEXT); CREATE TABLE part(id TEXT PRIMARY KEY,message_id TEXT,session_id TEXT,data TEXT); CREATE TABLE project(id TEXT PRIMARY KEY,worktree TEXT);');
 db.prepare('INSERT INTO project VALUES (?,?)').run('global',legacyCwd);
 db.prepare('INSERT INTO session (id,directory,project_id) VALUES (?,?,?)').run(sessionId,legacyCwd,'global');
 db.prepare('INSERT INTO session (id,directory,project_id) VALUES (?,?,?)').run('ses_other',legacyCwd,'global');
 db.prepare('INSERT INTO message VALUES (?,?,?)').run('msg_original',sessionId,JSON.stringify({role:'assistant',content:'synthetic-original-marker'}));
 }finally{db.close();}
}

test('resumed OpenCode startup routes the original session to its private cwd and preserves other state',async()=>{
 const home=await mkdtemp(join(tmpdir(),'af-opencode-route-'));try{
  const a={cwd:join(home,'agents','a'),stateDirectory:join(home,'agents','a','.artifactbin','hosted-agent')};
  const b=join(home,'agents','b','.artifactbin','hosted-agent');
  await mkdir(a.stateDirectory,{recursive:true});await mkdir(b,{recursive:true});
  await writeFile(join(a.stateDirectory,'opencode-session'),'ses_original');
  seedNativeDatabase(a.stateDirectory,'ses_original',home);seedNativeDatabase(b,'ses_sibling',home);
  const sibling=await readFile(join(b,'opencode.db'));
  const env=hostedWorkerEnv('opencode',home,a.stateDirectory,':',{server:'http://localhost:8040',token:'mxmx_test_connection'},{PWD:home},a.cwd);
  for(let attempt=0;attempt<2;attempt++){
   const args=await prepareHostedHarness({command:'opencode',home,...a,context:'Synthetic startup',env});
   assert.deepEqual(args,['--mini','--session','ses_original','--prompt','Synthetic startup']);
   const db=new DatabaseSync(join(a.stateDirectory,'opencode.db'),{readOnly:true});try{
    assert.equal(db.prepare('SELECT directory FROM session WHERE id=?').get('ses_original')?.directory,a.cwd,'native session requests must route to the same directory as events');
    assert.equal(db.prepare('SELECT directory FROM session WHERE id=?').get('ses_other')?.directory,home);
    assert.equal(db.prepare('SELECT project_id FROM session WHERE id=?').get('ses_original')?.project_id,'global');
    assert.equal(db.prepare('SELECT worktree FROM project WHERE id=?').get('global')?.worktree,home);
    assert.equal(db.prepare('SELECT data FROM message WHERE id=?').get('msg_original')?.data,JSON.stringify({role:'assistant',content:'synthetic-original-marker'}));
   }finally{db.close();}
  }
  assert.deepEqual(await readFile(join(b,'opencode.db')),sibling);
  assert.equal(await readFile(join(a.stateDirectory,'opencode-session'),'utf8'),'ses_original');
 }finally{await rm(home,{recursive:true,force:true});}
});

test('OpenCode startup refuses a shared database before touching another agent session',async()=>{
 const home=await mkdtemp(join(tmpdir(),'af-opencode-shared-refusal-'));try{
  const paths={cwd:join(home,'agents','a'),stateDirectory:join(home,'agents','a','.artifactbin','hosted-agent')};await mkdir(paths.stateDirectory,{recursive:true});
  await writeFile(join(paths.stateDirectory,'opencode-session'),'ses_original');await mkdir(join(home,'.local','share','opencode'),{recursive:true});
  const globalDatabase=join(home,'.local','share','opencode','opencode.db');const db=new DatabaseSync(globalDatabase);db.exec('CREATE TABLE session(id TEXT PRIMARY KEY,directory TEXT);');db.prepare('INSERT INTO session VALUES (?,?)').run('ses_original',home);db.close();
  const before=await readFile(globalDatabase);
  await assert.rejects(prepareHostedHarness({command:'opencode',home,...paths,context:'Synthetic startup',env:{OPENCODE_DB:globalDatabase}}),/private.*database|database.*private/);
  assert.deepEqual(await readFile(globalDatabase),before);
 }finally{await rm(home,{recursive:true,force:true});}
});

test('OpenCode relocation refuses unknown schema, missing sessions, and foreign legacy directories',async()=>{
 const home=await mkdtemp(join(tmpdir(),'af-opencode-relocation-refusal-'));try{
  const cwd=join(home,'agents','a'),stateDirectory=join(cwd,'.artifactbin','hosted-agent'),databasePath=join(stateDirectory,'opencode.db');await mkdir(stateDirectory,{recursive:true});
  const options={home,cwd,stateDirectory,databasePath,sessionId:'ses_original'};
  let db=new DatabaseSync(databasePath);try{db.exec('CREATE TABLE session(id TEXT PRIMARY KEY,directory TEXT);');db.prepare('INSERT INTO session VALUES (?,?)').run('ses_original',home);}finally{db.close();}
  await assert.rejects(relocatePinnedOpenCodeSession(options),/unsupported_opencode_database_schema/);
  await rm(databasePath,{force:true});seedNativeDatabase(stateDirectory,'ses_missing',home);
  await assert.rejects(relocatePinnedOpenCodeSession(options),/opencode_session_not_found_in_private_database/);
  await rm(databasePath,{force:true});seedNativeDatabase(stateDirectory,'ses_original',join(home,'old-agent'));
  await assert.rejects(relocatePinnedOpenCodeSession(options),/opencode_session_has_unexpected_legacy_directory/);
  const check=new DatabaseSync(databasePath,{readOnly:true});try{assert.equal(check.prepare('SELECT directory FROM session WHERE id=?').get('ses_original')?.directory,join(home,'old-agent'));}finally{check.close();}
  if(process.platform!=='win32'){
   const external=join(home,'external');await mkdir(external);seedNativeDatabase(external,'ses_original',home);await rm(databasePath,{force:true});await symlink(join(external,'opencode.db'),databasePath);
   await assert.rejects(relocatePinnedOpenCodeSession(options),/opencode_private_database_required/);
  }
 }finally{await rm(home,{recursive:true,force:true});}
});
