import {runCli} from '../src/dispatch';
import {saveConnection} from '../src/config';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {installSkills,skillTargets,selectSkills} from '../src/skill-install';
const bundle={'SKILL.md':'---\nname: artifactbin\ndescription: Publish artifacts.\n---\nHello','references/a.md':'A'};
test('installation selects only requested harnesses, remembers opt-outs and backs up modified files',async()=>{
 const home=await mkdtemp(join(tmpdir(),'afbin-install-'));
 try{
  const options={home,env:{},files:bundle,version:'1.0.0'};
  const targets=skillTargets(home,{});
  const first=await installSkills(['pi','codex'],options);assert.equal(first.installations.length,2);
  assert.equal(await readFile(join(targets.pi,'SKILL.md'),'utf8'),bundle['SKILL.md']);
  await assert.rejects(stat(targets.claude),{code:'ENOENT'});
  assert.deepEqual(await selectSkills({home,env:{},interactive:false,detected:['claude','pi','codex']}),['pi','codex']);
  const stable=await installSkills(['pi','codex'],options);assert.ok(stable.installations.every(x=>x.status==='unchanged'));
  await writeFile(join(targets.pi,'SKILL.md'),'My edited skill');await writeFile(join(targets.pi,'notes.txt'),'Keep me');
  const updated=await installSkills(['pi'],{...options,files:{'SKILL.md':'New skill'},version:'2.0.0'});
  assert.equal(await readFile(join(updated.installations[0].backup!,'SKILL.md'),'utf8'),'My edited skill');
  assert.equal(await readFile(join(targets.pi,'notes.txt'),'utf8'),'Keep me');
  await assert.rejects(stat(join(targets.pi,'references/a.md')),{code:'ENOENT'});
  assert.equal((await stat(join(home,'.artifactbin','settings.json'))).mode&0o777,0o600);
  await installSkills([],{...options});assert.deepEqual(await selectSkills({home,env:{},interactive:false,detected:['pi']}),[]);
 }finally{await rm(home,{recursive:true,force:true});}
});
test('shared physical destinations update once; unsafe bundle paths are refused before writes',async()=>{
 const home=await mkdtemp(join(tmpdir(),'afbin-shared-install-'));
 try{
  const targets=skillTargets(home,{});await mkdir(targets.pi,{recursive:true});await mkdir(join(home,'.codex','skills'),{recursive:true});await symlink(targets.pi,targets.codex);
  const result=await installSkills(['pi','codex'],{home,env:{},files:bundle,version:'1.0.0'});
  assert.equal(result.installations.length,1);assert.deepEqual(result.installations[0].harnesses,['pi','codex']);
  await assert.rejects(installSkills(['claude'],{home,env:{},files:{'../escape':'bad'},version:'1.0.0'}),/bundle path/i);
  await assert.rejects(stat(targets.claude),{code:'ENOENT'});
 }finally{await rm(home,{recursive:true,force:true});}
});
test('interactive checklist starts with detected defaults and cancellation makes no writes',async()=>{
 const home=await mkdtemp(join(tmpdir(),'afbin-select-'));
 try{
  assert.deepEqual(await selectSkills({home,env:{},interactive:true,detected:['pi','opencode'],choose:async choices=>{
   assert.deepEqual(choices.filter(x=>x.selected).map(x=>x.name),['pi','opencode']);return ['pi'];
  }}),['pi']);
  await assert.rejects(stat(join(home,'.artifactbin')),{code:'ENOENT'});
  await assert.rejects(selectSkills({home,env:{},interactive:true,detected:[],choose:async()=>{throw new Error('cancelled');}}),/cancelled/);
 }finally{await rm(home,{recursive:true,force:true});}
});

test('setup verifies saved credentials once and installs the exact unattended selection',async()=>{
 const home=await mkdtemp(join(tmpdir(),'afbin-setup-install-'));
 try{
  await saveConnection({server:'https://artifactbin.dev',token:'test_token'},home);
  const out:string[]=[];let checks=0;
  const code=await runCli(['setup','--harness','pi','--yes','--json'],{home,cwd:home,env:{},interactive:false,stdout:x=>out.push(x),stderr:()=>{},fetch:async(input)=>{checks++;assert.equal(new URL(String(input)).pathname,'/api/artifacts');return Response.json({artifacts:[]});}});
  assert.equal(code,0,out.join(''));assert.equal(checks,1);assert.deepEqual(JSON.parse(out.join('')).harnesses,['pi']);
  assert.match(await readFile(join(skillTargets(home,{}).pi,'SKILL.md'),'utf8'),/name: artifactbin/);
  await assert.rejects(stat(skillTargets(home,{}).codex),{code:'ENOENT'});
 }finally{await rm(home,{recursive:true,force:true});}
});
test('setup detects revoked credentials and returns a fresh browser approval without installing skills',async()=>{
 const home=await mkdtemp(join(tmpdir(),'afbin-setup-revoked-'));
 try{
  await saveConnection({server:'https://artifactbin.dev',token:'revoked_token'},home);const output:string[]=[],calls:string[]=[];
  await runCli(['setup','--harness','pi','--yes','--json'],{home,cwd:home,env:{},interactive:false,stdout:x=>output.push(x),stderr:()=>{},fetch:async input=>{
   const path=new URL(String(input)).pathname;calls.push(path);
   if(path==='/api/artifacts')return Response.json({error:'unauthorized'},{status:401});
   if(path==='/oauth/device')return Response.json({device_code:'a'.repeat(43),user_code:'ABCD-EFGH',verification_uri_complete:'https://artifactbin.dev/oauth/device?code=ABCD-EFGH',expires_in:300,interval:5});
   if(path==='/oauth/device/token')return Response.json({error:'authorization_pending'},{status:400});
   assert.fail(path);
  }});
  assert.equal(JSON.parse(output.join('')).error.code,'approval_required');assert.deepEqual(calls,['/api/artifacts','/oauth/device','/oauth/device/token']);await assert.rejects(stat(skillTargets(home,{}).pi),{code:'ENOENT'});
 }finally{await rm(home,{recursive:true,force:true});}
});

test('malformed settings refuse explicit installation before any harness files change',async()=>{
 const home=await mkdtemp(join(tmpdir(),'afbin-invalid-settings-'));
 try {
  await mkdir(join(home,'.artifactbin'));await writeFile(join(home,'.artifactbin','settings.json'),'{broken');
  await assert.rejects(installSkills(['pi'],{home,env:{},files:bundle}),{code:'invalid_settings'});
  await assert.rejects(stat(skillTargets(home,{}).pi),{code:'ENOENT'});
  assert.equal(await readFile(join(home,'.artifactbin','settings.json'),'utf8'),'{broken');
 }finally{await rm(home,{recursive:true,force:true});}
});
