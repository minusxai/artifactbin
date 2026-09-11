import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {updateCli} from '../src/update';
import {digest} from '../src/files';
import {skillTargets} from '../src/skill-install';
const skill=Buffer.from(JSON.stringify({version:'9.0.0',protocol:1,files:{'SKILL.md':'---\nname: artifactbin\ndescription: Publish.\n---\nNew skill'}}));
const binary=Buffer.from('new binary');
const manifest={version:'9.0.0',protocol:1,platform:'darwin',arch:'arm64',binary:{file:'afbin-darwin-arm64',sha256:digest(binary)},skills:{file:'afbin-skills.json',sha256:digest(skill)}};
function transport(corrupt=false){return async(input:unknown)=>{
 const path=String(input);if(path.endsWith('/api/capabilities'))return Response.json({protocol:1});
 if(path.includes('/releases?'))return Response.json([{tag_name:'afbin-v9.0.0',draft:false,prerelease:false}]);
 if(path.endsWith('.manifest.json'))return Response.json(manifest);
 if(path.endsWith('/afbin-skills.json'))return new Response(skill);
 if(path.endsWith('/afbin-darwin-arm64'))return new Response(corrupt?'corrupt':binary);
 assert.fail(path);
 };}
test('standalone update verifies bytes, atomically replaces, keeps a backup and installs matching skills',async()=>{
 const home=await mkdtemp(join(tmpdir(),'afbin-update-')),exe=join(home,'afbin');
 try{
  await writeFile(exe,'old binary',{mode:0o755});const result=await updateCli({home,server:'https://artifactbin.dev',env:{},installation:{kind:'standalone',path:exe},platform:'darwin',arch:'arm64',version:'1.0.0',harnesses:['pi'],verifyExecutable:async()=>{},fetch:transport()});
  assert.equal(await readFile(exe,'utf8'),'new binary');assert.equal((await stat(exe)).mode&0o777,0o755);assert.equal(await readFile(result.backup!,'utf8'),'old binary');
  assert.match(await readFile(join(skillTargets(home,{}).pi,'SKILL.md'),'utf8'),/New skill/);assert.equal(result.version,'9.0.0');
 }finally{await rm(home,{recursive:true,force:true});}
});
test('bad checksum changes neither executable nor skills',async()=>{
 const home=await mkdtemp(join(tmpdir(),'afbin-update-bad-')),exe=join(home,'afbin');
 try{await writeFile(exe,'old binary');await assert.rejects(updateCli({home,server:'https://artifactbin.dev',env:{},installation:{kind:'standalone',path:exe},platform:'darwin',arch:'arm64',version:'1.0.0',harnesses:['pi'],fetch:transport(true)}),/checksum/i);assert.equal(await readFile(exe,'utf8'),'old binary');await assert.rejects(stat(skillTargets(home,{}).pi),{code:'ENOENT'});}
 finally{await rm(home,{recursive:true,force:true});}
});
test('interruption after executable replacement completes matching skills offline on retry',async()=>{
 const home=await mkdtemp(join(tmpdir(),'afbin-update-recover-')),exe=join(home,'afbin');
 try{
  await writeFile(exe,'old binary');const options={home,server:'https://artifactbin.dev',env:{},installation:{kind:'standalone' as const,path:exe},platform:'darwin',arch:'arm64',version:'1.0.0',harnesses:['pi' as const]};
  await assert.rejects(updateCli({...options,verifyExecutable:async()=>{},fetch:transport(),afterReplace:()=>{throw new Error('simulated interruption');}}),/interruption/);
  const result=await updateCli({...options,fetch:async()=>assert.fail('recovery must stay offline')});assert.equal(result.recovered,true);assert.match(await readFile(join(skillTargets(home,{}).pi,'SKILL.md'),'utf8'),/New skill/);
 }finally{await rm(home,{recursive:true,force:true});}
});
test('npm installation updates through its manager without overwriting a shim',async()=>{
 const home=await mkdtemp(join(tmpdir(),'afbin-update-npm-'));const calls:string[][]=[];
 try{
  await updateCli({home,server:'https://artifactbin.dev',env:{},installation:{kind:'npm',prefix:home,global:false},platform:'darwin',arch:'arm64',version:'1.0.0',harnesses:[],verifyExecutable:async()=>{},fetch:transport(),runPackageManager:async args=>{calls.push(args);}});
  assert.deepEqual(calls,[['install','--prefix',home,'@artifactbin/cli@9.0.0']]);
 }finally{await rm(home,{recursive:true,force:true});}
});
