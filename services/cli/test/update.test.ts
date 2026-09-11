import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {updateCli} from '../src/update';
import {digest} from '../src/files';
import {skillTargets} from '../src/skill-install';
const skill=Buffer.from(JSON.stringify({version:'9.0.0',protocol:1,files:{'SKILL.md':'---\nname: artifactbin\ndescription: Publish.\n---\nNew skill'}}));
const binary=Buffer.from('new binary');
const manifest={version:'9.0.0',protocol:1,platform:'darwin',arch:'arm64',binary:{file:'afbin-darwin-arm64',sha256:digest(binary)},skills:{file:'afbin-skills.json',sha256:digest(skill)}};
/** The selected server names the release; the bytes and their checksums come from that release. */
function transport(options:{corrupt?:boolean;protocol?:number}={}){return async(input:unknown)=>{
 const path=String(input);
 if(path.endsWith('/chat/release.json'))return Response.json({version:'9.0.0',protocol:options.protocol??1,assets:{}});
 if(path.endsWith('.manifest.json'))return Response.json(manifest);
 if(path.endsWith('/afbin-skills.json'))return new Response(skill);
 if(path.endsWith('/afbin-darwin-arm64'))return new Response(options.corrupt?'corrupt':binary);
 return assert.fail(path);
 };}
test('standalone update verifies bytes, atomically replaces, keeps a backup and installs matching skills',async()=>{
 const home=await mkdtemp(join(tmpdir(),'afbin-update-')),exe=join(home,'afbin');
 try{
  await writeFile(exe,'old binary',{mode:0o755});const result=await updateCli({home,server:'https://artifactbin.dev',env:{},installation:{kind:'standalone',path:exe},platform:'darwin',arch:'arm64',version:'1.0.0',harnesses:['pi','codex'],verifyExecutable:async()=>{},fetch:transport()}) as any;
  assert.equal(await readFile(exe,'utf8'),'new binary');assert.equal((await stat(exe)).mode&0o777,0o755);assert.equal(await readFile(result.backup!,'utf8'),'old binary');
  assert.match(await readFile(join(skillTargets(home,{}).pi,'SKILL.md'),'utf8'),/New skill/);assert.equal(result.version,'9.0.0');
  const provenance=JSON.parse(await readFile(join(skillTargets(home,{}).pi,'.afbin-skill.json'),'utf8'));
  assert.equal(provenance.source,'afbin-cli');assert.equal(provenance.version,'9.0.0');
  assert.deepEqual(result.installations.map((x:any)=>[x.status,x.source,x.version]),[['installed','afbin-cli','9.0.0'],['installed','afbin-cli','9.0.0']]);
  // Codex discovers skills at startup and is told to restart; pi rereads them per run.
  assert.deepEqual(result.installations.map((x:any)=>[x.harnesses,x.restart_required]),[[['pi'],undefined],[['codex'],true]]);
 }finally{await rm(home,{recursive:true,force:true});}
});
test('bad checksum changes neither executable nor skills',async()=>{
 const home=await mkdtemp(join(tmpdir(),'afbin-update-bad-')),exe=join(home,'afbin');
 try{await writeFile(exe,'old binary');await assert.rejects(updateCli({home,server:'https://artifactbin.dev',env:{},installation:{kind:'standalone',path:exe},platform:'darwin',arch:'arm64',version:'1.0.0',harnesses:['pi'],fetch:transport({corrupt:true})}),/checksum/i);assert.equal(await readFile(exe,'utf8'),'old binary');await assert.rejects(stat(skillTargets(home,{}).pi),{code:'ENOENT'});}
 finally{await rm(home,{recursive:true,force:true});}
});
test('a release whose protocol differs from the one the server named is refused',async()=>{
 const home=await mkdtemp(join(tmpdir(),'afbin-update-protocol-')),exe=join(home,'afbin');
 try{await writeFile(exe,'old binary');
  await assert.rejects(updateCli({home,server:'https://artifactbin.dev',env:{},installation:{kind:'standalone',path:exe},platform:'darwin',arch:'arm64',version:'1.0.0',harnesses:[],fetch:transport({protocol:2})}),{code:'compatible_release_unavailable'});
  assert.equal(await readFile(exe,'utf8'),'old binary');
 }finally{await rm(home,{recursive:true,force:true});}
});
test('interruption after executable replacement completes matching skills offline on retry',async()=>{
 const home=await mkdtemp(join(tmpdir(),'afbin-update-recover-')),exe=join(home,'afbin');
 try{
  await writeFile(exe,'old binary');const options={home,server:'https://artifactbin.dev',env:{},installation:{kind:'standalone' as const,path:exe},platform:'darwin',arch:'arm64',version:'1.0.0',harnesses:['pi' as const]};
  await assert.rejects(updateCli({...options,verifyExecutable:async()=>{},fetch:transport(),afterReplace:()=>{throw new Error('simulated interruption');}}),/interruption/);
  const result=await updateCli({...options,fetch:async()=>assert.fail('recovery must stay offline')}) as any;assert.equal(result.recovered,true);assert.match(await readFile(join(skillTargets(home,{}).pi,'SKILL.md'),'utf8'),/New skill/);
 }finally{await rm(home,{recursive:true,force:true});}
});
test('dry-run resolves the release and reports skill provenance without writing',async()=>{
 const home=await mkdtemp(join(tmpdir(),'afbin-update-dry-')),exe=join(home,'afbin');
 try{
  await writeFile(exe,'old binary',{mode:0o755});
  const target=skillTargets(home,{}).pi;await mkdir(target,{recursive:true});
  await writeFile(join(target,'SKILL.md'),'old skill');
  await writeFile(join(target,'.afbin-skill.json'),JSON.stringify({version:'1.0.0',source:'afbin-cli',files:{'SKILL.md':digest('old skill')}}));
  const before=JSON.stringify((await readdir(home,{recursive:true})).sort());
  const result=await updateCli({home,server:'https://artifactbin.dev',env:{},installation:{kind:'standalone',path:exe},platform:'darwin',arch:'arm64',version:'1.0.0',harnesses:['pi'],dryRun:true,fetch:async(input:unknown)=>{
   const path=String(input);if(path.endsWith('/chat/release.json'))return Response.json({version:'9.0.0',protocol:1});
   return assert.fail(`dry-run downloaded ${path}`);
  }});
  assert.equal(result.dry_run,true);
  assert.deepEqual(result.release,{version:'9.0.0',protocol:1});
  assert.deepEqual(result.binary,{installation:'standalone',path:exe,current:'1.0.0',available:'9.0.0',change:'update',asset:'afbin-darwin-arm64'});
  assert.deepEqual(result.skills,[{harness:'pi',path:target,version:'9.0.0',status:'update',source:'afbin-cli',installed:'1.0.0'}]);
  assert.equal(await readFile(exe,'utf8'),'old binary');
  assert.equal(await readFile(join(target,'SKILL.md'),'utf8'),'old skill');
  assert.equal(JSON.stringify((await readdir(home,{recursive:true})).sort()),before,'dry-run wrote to the home directory');
 }finally{await rm(home,{recursive:true,force:true});}
});
test('dry-run reports an installation it cannot update instead of refusing',async()=>{
 const home=await mkdtemp(join(tmpdir(),'afbin-update-unmanaged-'));
 try{
  const result=await updateCli({home,server:'https://artifactbin.dev',env:{},platform:'darwin',arch:'arm64',version:'1.0.0',harnesses:[],dryRun:true,fetch:async()=>Response.json({version:'9.0.0',protocol:1})});
  assert.equal(result.binary.installation,'unmanaged');
  assert.equal(result.binary.change,'unavailable');
  assert.match(result.binary.reason!,/install\.sh/);
 }finally{await rm(home,{recursive:true,force:true});}
});
