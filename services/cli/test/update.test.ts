import {withLock,HOME_SCOPE} from '../src/state';
import {test,describe} from 'node:test';
import {gzipSync} from 'node:zlib';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm,stat,lstat,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {updateCli} from '../src/update';
import {digest} from '../src/files';
import {skillTargets} from '../src/skill-install';
import {cliHarness} from './harness';
const skill=Buffer.from(JSON.stringify({version:'9.0.0',protocol:2,files:{'SKILL.md':'---\nname: artifactbin\ndescription: Publish.\n---\nNew skill'}}));
const binary=Buffer.from('new binary');
const manifest={version:'9.0.0',protocol:2,platform:'darwin',arch:'arm64',binary:{file:'afbin-darwin-arm64',sha256:digest(binary)},skills:{file:'afbin-skills.json',sha256:digest(skill)}};
/** The selected server names the release; the bytes and their checksums come from that release. */
function transport(options:{corrupt?:boolean;protocol?:number}={}){return async(input:unknown)=>{
 const path=String(input);
 if(path.endsWith('/chat/release.json'))return Response.json({version:'9.0.0',protocol:options.protocol??2,assets:{}});
 assert.ok(path.startsWith('https://github.com/minusxai/artifactbin/releases/download/afbin-v9.0.0/'), 'updates must use the canonical repository directly');
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
  await assert.rejects(updateCli({home,server:'https://artifactbin.dev',env:{},installation:{kind:'standalone',path:exe},platform:'darwin',arch:'arm64',version:'1.0.0',harnesses:[],fetch:transport({protocol:3})}),{code:'compatible_release_unavailable'});
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
   const path=String(input);if(path.endsWith('/chat/release.json'))return Response.json({version:'9.0.0',protocol:2});
   return assert.fail(`dry-run downloaded ${path}`);
  }});
  assert.equal(result.dry_run,true);
  assert.deepEqual(result.release,{version:'9.0.0',protocol:2});
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
  const result=await updateCli({home,server:'https://artifactbin.dev',env:{},platform:'darwin',arch:'arm64',version:'1.0.0',harnesses:[],dryRun:true,fetch:async()=>Response.json({version:'9.0.0',protocol:2})});
  assert.equal(result.binary.installation,'unmanaged');
  assert.equal(result.binary.change,'unavailable');
  assert.match(result.binary.reason!,/install\.sh/);
 }finally{await rm(home,{recursive:true,force:true});}
});

test('a download that stops delivering bytes is abandoned as stalled, not waited on forever',async()=>{
 const home=await mkdtemp(join(tmpdir(),'afbin-stall-')),exe=join(home,'afbin');await writeFile(exe,'old binary',{mode:0o755});
 const stalled=async(input:unknown)=>{
  const path=String(input);
  if(path.endsWith('/afbin-darwin-arm64'))return new Response(new ReadableStream({start(controller){controller.enqueue(new Uint8Array([1]));}}));
  return transport()(input);
 };
 await assert.rejects(updateCli({home,server:'https://artifactbin.dev',env:{},installation:{kind:'standalone',path:exe},platform:'darwin',arch:'arm64',version:'1.0.0',harnesses:[],fetch:stalled as any,verifyExecutable:async()=>{},stallMs:100}),(error:any)=>error.code==='release_unavailable'&&/stalled/.test(error.message));
 assert.equal((await readFile(exe,'utf8')),'old binary');
});

test('gzip updates verify both transport and executable, and recover using decoded bytes',async()=>{
 const compressed=gzipSync(binary);const packed={...manifest,binary:{...manifest.binary,gzip:{file:manifest.binary.file+'.gz',sha256:digest(compressed)}}};
 const home=await mkdtemp(join(tmpdir(),'afbin-update-gzip-')),exe=join(home,'afbin');
 try{
  await writeFile(exe,'old binary');let downloads=0;
  const fetcher=async(input:unknown)=>{const path=String(input);if(path.endsWith('.manifest.json'))return Response.json(packed);if(path.endsWith('.gz')){downloads++;return new Response(compressed);}if(path.endsWith('/afbin-darwin-arm64'))assert.fail('must prefer gzip');return transport()(input);};
  await updateCli({home,server:'https://artifactbin.dev',env:{},installation:{kind:'standalone',path:exe},platform:'darwin',arch:'arm64',version:'1.0.0',harnesses:[],verifyExecutable:async p=>{assert.deepEqual(await readFile(p),binary);},fetch:fetcher});
  assert.equal(downloads,1);assert.deepEqual(await readFile(exe),binary);
 }finally{await rm(home,{recursive:true,force:true});}
});

describe('update --dry-run', () => {
  const harness=(prefix:string)=>cliHarness(prefix,{flags:[],token:null,account:null});

  test('update --dry-run resolves the compatible release and reports binary and skill changes without installing',async()=>{
   const h=await harness('afbin-seed-update-dry-');
   try{
    const code=await h.invoke(['update','--dry-run','--harness','pi','--json','--server','https://example.com'],({path})=>Response.json(path.includes('release')?{version:'9.9.9',protocol:2,assets:{}}:{error:'not_found'},{status:path.includes('release')?200:404}));
    assert.equal(code,0,h.out.join(''));
    const result=h.last();assert.equal(result.dry_run,true);assert.ok(result.binary);assert.ok(Array.isArray(result.skills));
    assert.deepEqual((await readdir(h.root)).filter(name=>name!=='.artifactbin'),[],'dry-run writes nothing to the home directory');
   }finally{await h.cleanup();}
  });
});

test('background update replaces only the executable and recovers without rewriting skills',async()=>{
 const home=await mkdtemp(join(tmpdir(),'afbin-update-background-')),exe=join(home,'afbin');
 try {
  await writeFile(exe,'old binary',{mode:0o755});
  const options={home,server:'https://artifactbin.dev',env:{},installation:{kind:'standalone' as const,path:exe},platform:'darwin',arch:'arm64',version:'1.0.0',harnesses:['pi' as const],background:true,verifyExecutable:async()=>{},fetch:transport()};
  await assert.rejects(updateCli({...options,afterReplace:()=>{throw new Error('crashed');}}),/crashed/);
  await updateCli({...options,fetch:async()=>assert.fail('recover offline')});
  assert.equal(await readFile(exe,'utf8'),'new binary');
  await assert.rejects(stat(skillTargets(home,{}).pi),{code:'ENOENT'});
 }finally{await rm(home,{recursive:true,force:true});}
});
test('an executable changed during discovery is never overwritten by the older worker',async()=>{
 const home=await mkdtemp(join(tmpdir(),'afbin-update-raced-')),exe=join(home,'afbin');
 try {
  await writeFile(exe,'old binary',{mode:0o755});
  const fetcher=transport();
  await assert.rejects(updateCli({home,server:'https://artifactbin.dev',env:{},installation:{kind:'standalone',path:exe},platform:'darwin',arch:'arm64',version:'1.0.0',harnesses:[],verifyExecutable:async()=>{},fetch:async(input)=>{
   if(String(input).endsWith('/chat/release.json'))await writeFile(exe,'newer binary');
   return fetcher(input);
  }}),/changed/i);
  assert.equal(await readFile(exe,'utf8'),'newer binary');
 }finally{await rm(home,{recursive:true,force:true});}
});

test('background downloads do not hold the normal CLI state lock',async()=>{
 const home=await mkdtemp(join(tmpdir(),'afbin-update-lock-')),exe=join(home,'afbin');let release!:()=>void;
 try {
  await writeFile(exe,'old binary',{mode:0o755});const fetcher=transport();
  const task=updateCli({home,server:'https://artifactbin.dev',env:{},installation:{kind:'standalone',path:exe},platform:'darwin',arch:'arm64',version:'1.0.0',harnesses:[],background:true,verifyExecutable:async()=>{},fetch:async(input)=>{
   if(String(input).endsWith('/chat/release.json'))await new Promise<void>(r=>{release=r;});return fetcher(input);
  }});
  for(let i=0;!release&&i<100;i++)await new Promise(r=>setTimeout(r,5));assert.ok(release);
  assert.equal(await withLock(home,HOME_SCOPE,async()=>true,{waitMs:0,reentrant:false},{}),true);
  release();await task;
 }finally{release?.();await rm(home,{recursive:true,force:true});}
});

test('superseded recovery journals cannot block a newer installation forever',async()=>{
 const home=await mkdtemp(join(tmpdir(),'afbin-update-superseded-')),exe=join(home,'afbin');
 try{
  await writeFile(exe,'old binary',{mode:0o755});
  const options={home,server:'https://artifactbin.dev',env:{},installation:{kind:'standalone' as const,path:exe},platform:'darwin',arch:'arm64',version:'1.0.0',harnesses:[],background:true,verifyExecutable:async()=>{},fetch:transport()};
  await assert.rejects(updateCli({...options,afterReplace:()=>{throw new Error('crashed');}}),/crashed/);
  await writeFile(exe,'newer installation');
  const result=await updateCli({...options,version:'10.0.0',fetch:async()=>assert.fail('recovery is local')});
  assert.ok('version' in result);assert.equal(result.version,'10.0.0');assert.equal(await readFile(exe,'utf8'),'newer installation');
  await assert.rejects(stat(join(home,'.artifactbin','pending-update.json')),{code:'ENOENT'});
 }finally{await rm(home,{recursive:true,force:true});}
});

/** Each release serves its own executable, so consecutive updates can be told apart by their bytes. */
function releaseTransport(version:string,payload:string,options:{corrupt?:boolean}={}){
 const bundle=Buffer.from(JSON.stringify({version,protocol:2,files:{'SKILL.md':'---\nname: artifactbin\ndescription: Publish.\n---\nNew skill'}}));
 const executable=Buffer.from(payload);
 const released={version,protocol:2,platform:'darwin',arch:'arm64',binary:{file:'afbin-darwin-arm64',sha256:digest(executable)},skills:{file:'afbin-skills.json',sha256:digest(bundle)}};
 return async(input:unknown)=>{
  const path=String(input);
  if(path.endsWith('/chat/release.json'))return Response.json({version,protocol:2});
  if(path.endsWith('.manifest.json'))return Response.json(released);
  if(path.endsWith('/afbin-skills.json'))return new Response(bundle);
  if(path.endsWith('/afbin-darwin-arm64'))return new Response(options.corrupt?'corrupt':executable);
  return assert.fail(path);
 };
}
const standalone=(home:string,exe:string)=>({home,server:'https://artifactbin.dev',env:{},installation:{kind:'standalone' as const,path:exe},platform:'darwin',arch:'arm64',harnesses:[],verifyExecutable:async()=>{}});

test('consecutive updates keep exactly one backup, named for the version it holds',async()=>{
 const home=await mkdtemp(join(tmpdir(),'afbin-update-prune-')),exe=join(home,'afbin'),backups=join(home,'.artifactbin','binary-backups');
 try{
  await writeFile(exe,'binary 1',{mode:0o755});
  const first=await updateCli({...standalone(home,exe),version:'1.0.0',fetch:releaseTransport('9.0.0','binary 9')}) as any;
  assert.equal(first.backup,join(backups,'afbin-1.0.0'));
  assert.deepEqual(await readdir(backups),['afbin-1.0.0']);
  const second=await updateCli({...standalone(home,exe),version:'9.0.0',fetch:releaseTransport('10.0.0','binary 10')}) as any;
  assert.equal(second.backup,join(backups,'afbin-9.0.0'));
  assert.deepEqual(await readdir(backups),['afbin-9.0.0'],'only the executable replaced by the most recent update is kept');
  assert.equal(await readFile(second.backup,'utf8'),'binary 9');
  assert.equal(await readFile(exe,'utf8'),'binary 10');
  assert.equal((await stat(second.backup)).mode&0o777,0o755);
 }finally{await rm(home,{recursive:true,force:true});}
});

test('pruning removes stale regular backups and never follows a symlink',async()=>{
 const home=await mkdtemp(join(tmpdir(),'afbin-update-prune-links-')),exe=join(home,'afbin'),backups=join(home,'.artifactbin','binary-backups');
 try{
  await writeFile(exe,'binary 1',{mode:0o755});
  await mkdir(backups,{recursive:true,mode:0o700});
  await writeFile(join(backups,'afbin-0.9.0'),'ancient');
  await writeFile(join(backups,'stray.txt'),'unrelated');
  const outside=join(home,'precious');await writeFile(outside,'not ours');
  await symlink(outside,join(backups,'link'));
  const result=await updateCli({...standalone(home,exe),version:'1.0.0',fetch:releaseTransport('9.0.0','binary 9')}) as any;
  assert.deepEqual((await readdir(backups)).sort(),['afbin-1.0.0','link'],'regular stale files are pruned; the symlink is left alone');
  assert.equal(result.backup,join(backups,'afbin-1.0.0'));
  assert.equal((await lstat(join(backups,'link'))).isSymbolicLink(),true);
  assert.equal(await readFile(outside,'utf8'),'not ours','a symlink target outside the directory is never touched');
 }finally{await rm(home,{recursive:true,force:true});}
});

test('a failed update leaves the existing backup untouched',async()=>{
 const home=await mkdtemp(join(tmpdir(),'afbin-update-prune-failed-')),exe=join(home,'afbin'),backups=join(home,'.artifactbin','binary-backups');
 try{
  await writeFile(exe,'binary 1',{mode:0o755});
  await updateCli({...standalone(home,exe),version:'1.0.0',fetch:releaseTransport('9.0.0','binary 9')});
  await assert.rejects(updateCli({...standalone(home,exe),version:'9.0.0',fetch:releaseTransport('10.0.0','binary 10',{corrupt:true})}),/checksum/i);
  assert.deepEqual(await readdir(backups),['afbin-1.0.0'],'the only recoverable executable survives a failed update');
  assert.equal(await readFile(join(backups,'afbin-1.0.0'),'utf8'),'binary 1');
  assert.equal(await readFile(exe,'utf8'),'binary 9');
 }finally{await rm(home,{recursive:true,force:true});}
});
