import {withLock,HOME_SCOPE} from '../src/state';
import {test,describe} from 'node:test';
import {gzipSync} from 'node:zlib';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm,stat,lstat,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {updateCli,type UpdateProgress} from '../src/update';
import {progressRenderer} from '../src/update-progress';
import {runCli} from '../src/dispatch';
import {CliError} from '../src/commands';
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
  // Recovery installs the selection the interrupted run journaled; it neither downloads nor asks again.
  const result=await updateCli({...options,fetch:async()=>assert.fail('recovery must stay offline'),chooseHarnesses:async()=>assert.fail('recovery must not ask for harnesses')}) as any;assert.equal(result.recovered,true);assert.match(await readFile(join(skillTargets(home,{}).pi,'SKILL.md'),'utf8'),/New skill/);
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

/** The executable arrives in several chunks with its length declared, as GitHub serves a release asset. */
function chunkedTransport(chunks=4){return async(input:unknown)=>{
 const path=String(input);
 if(path.endsWith('/afbin-darwin-arm64')){
  const size=Math.ceil(binary.length/chunks);
  return new Response(new ReadableStream({start(controller){for(let at=0;at<binary.length;at+=size)controller.enqueue(new Uint8Array(binary.subarray(at,at+size)));controller.close();}}),{headers:{'content-length':String(binary.length)}});
 }
 return transport()(input);
};}

describe('foreground update ordering and progress',()=>{
 test('the release is named, the download reports progress, and the harness menu comes after the download',async()=>{
  const home=await mkdtemp(join(tmpdir(),'afbin-update-order-')),exe=join(home,'afbin');
  try{
   await writeFile(exe,'old binary',{mode:0o755});
   const timeline:string[]=[];const events:UpdateProgress[]=[];
   const result=await updateCli({home,server:'https://artifactbin.dev',env:{},installation:{kind:'standalone',path:exe},platform:'darwin',arch:'arm64',version:'1.0.0',harnesses:[],verifyExecutable:async()=>{},fetch:chunkedTransport(),
    report:event=>{events.push(event);timeline.push(event.stage);},
    chooseHarnesses:async()=>{timeline.push('choose');assert.equal(await readFile(exe,'utf8'),'old binary','the menu is shown before anything is installed');return ['pi'];}}) as any;
   const stages=timeline.filter((x,i)=>x!==timeline[i-1]);
   assert.deepEqual(stages,['release','download','downloaded','choose','install']);
   assert.deepEqual(events[0],{stage:'release',current:'1.0.0',available:'9.0.0'});
   const downloads=events.filter(x=>x.stage==='download') as Extract<UpdateProgress,{stage:'download'}>[];
   assert.ok(downloads.length>1,'every chunk is reported');
   assert.ok(downloads.every((x,i)=>x.total===binary.length&&(i===0||x.received>downloads[i-1]!.received)),'progress is monotonic against the declared length');
   assert.equal(downloads.at(-1)!.received,binary.length);
   assert.equal(await readFile(exe,'utf8'),'new binary');
   assert.deepEqual(result.harnesses??result.installations.flatMap((x:any)=>x.harnesses),['pi'],'the answer given after the download is the one installed');
   assert.match(await readFile(join(skillTargets(home,{}).pi,'SKILL.md'),'utf8'),/New skill/);
  }finally{await rm(home,{recursive:true,force:true});}
 });

 test('a download without a declared length still reports the bytes received',async()=>{
  const home=await mkdtemp(join(tmpdir(),'afbin-update-nolength-')),exe=join(home,'afbin');
  try{
   await writeFile(exe,'old binary',{mode:0o755});const events:UpdateProgress[]=[];
   await updateCli({home,server:'https://artifactbin.dev',env:{},installation:{kind:'standalone',path:exe},platform:'darwin',arch:'arm64',version:'1.0.0',harnesses:[],verifyExecutable:async()=>{},fetch:transport(),report:event=>events.push(event)});
   const downloads=events.filter(x=>x.stage==='download') as Extract<UpdateProgress,{stage:'download'}>[];
   assert.ok(downloads.length>0);assert.equal(downloads.at(-1)!.received,binary.length);assert.ok(downloads.every(x=>x.total===undefined));
  }finally{await rm(home,{recursive:true,force:true});}
 });

 test('cancelling the harness menu after the download installs and stages nothing',async()=>{
  const home=await mkdtemp(join(tmpdir(),'afbin-update-cancel-')),exe=join(home,'afbin');
  try{
   await writeFile(exe,'old binary',{mode:0o755});
   await assert.rejects(updateCli({home,server:'https://artifactbin.dev',env:{},installation:{kind:'standalone',path:exe},platform:'darwin',arch:'arm64',version:'1.0.0',harnesses:[],verifyExecutable:async()=>{},fetch:transport(),
    chooseHarnesses:async()=>{throw new CliError('cancelled','Skill installation cancelled.');}}),{code:'cancelled'});
   assert.equal(await readFile(exe,'utf8'),'old binary');
   await assert.rejects(stat(skillTargets(home,{}).pi),{code:'ENOENT'});
   for(const leftover of ['pending-update.json','update-download','binary-backups'])await assert.rejects(stat(join(home,'.artifactbin',leftover)),{code:'ENOENT'},leftover);
  }finally{await rm(home,{recursive:true,force:true});}
 });

 test('an installation that is already current skips the executable and still asks which skills to refresh',async()=>{
  const home=await mkdtemp(join(tmpdir(),'afbin-update-current-')),exe=join(home,'afbin');
  try{
   await writeFile(exe,'new binary',{mode:0o755});const events:UpdateProgress[]=[];let asked=0;
   const current=async(input:unknown)=>String(input).endsWith('/afbin-darwin-arm64')?assert.fail('a current executable is not downloaded'):transport()(input);
   await updateCli({home,server:'https://artifactbin.dev',env:{},installation:{kind:'standalone',path:exe},platform:'darwin',arch:'arm64',version:'9.0.0',harnesses:[],fetch:current,report:event=>events.push(event),chooseHarnesses:async()=>{asked++;return ['pi'];}});
   assert.deepEqual(events.map(x=>x.stage),['release','install']);
   assert.deepEqual(events[0],{stage:'release',current:'9.0.0',available:'9.0.0'});
   assert.equal(asked,1);assert.match(await readFile(join(skillTargets(home,{}).pi,'SKILL.md'),'utf8'),/New skill/);
  }finally{await rm(home,{recursive:true,force:true});}
 });

 test('dry-run asks for harnesses once the release is known, so its skill plan is not empty',async()=>{
  const home=await mkdtemp(join(tmpdir(),'afbin-update-dry-choose-')),exe=join(home,'afbin');
  try{
   await writeFile(exe,'old binary',{mode:0o755});let requests=0;
   const result=await updateCli({home,server:'https://artifactbin.dev',env:{},installation:{kind:'standalone',path:exe},platform:'darwin',arch:'arm64',version:'1.0.0',harnesses:[],dryRun:true,
    fetch:async(input:unknown)=>{requests++;return String(input).endsWith('/chat/release.json')?Response.json({version:'9.0.0',protocol:2}):assert.fail('dry-run downloads nothing');},
    chooseHarnesses:async()=>{assert.equal(requests,1,'the release resolves before the menu');return ['pi'];}});
   assert.deepEqual(result.skills.map(x=>x.harness),['pi']);
  }finally{await rm(home,{recursive:true,force:true});}
 });
});

describe('update progress rendering',()=>{
 const render=(events:UpdateProgress[])=>{let out='';const draw=progressRenderer(text=>{out+=text;});for(const event of events)draw(event);return out;};
 test('a declared length draws a bar that redraws only when the percentage moves, then ends its line',()=>{
  const MB=1024*1024;
  const out=render([{stage:'release',current:'0.1.46',available:'0.1.47'},...[0,1,2,3].map(x=>({stage:'download' as const,received:x,total:10*MB})),{stage:'download',received:5*MB,total:10*MB},{stage:'download',received:10*MB,total:10*MB},{stage:'downloaded',bytes:10*MB},{stage:'install',version:'0.1.47',recovered:false}]);
  assert.match(out,/0\.1\.46 → 0\.1\.47/);
  assert.equal(out.split('\r').length-1,3,'0%, 50% and 100%: tiny increments do not redraw');
  assert.match(out,/50%/);assert.match(out,/100%\s+10\.0\/10\.0 MB\n/);
  assert.match(out,/Installing afbin 0\.1\.47/);
  assert.ok(out.endsWith('\n'));
 });
 test('an unknown length shows the bytes received and never divides by it',()=>{
  const out=render([{stage:'download',received:3*1024*1024},{stage:'downloaded',bytes:3*1024*1024}]);
  assert.match(out,/3\.0 MB/);assert.doesNotMatch(out,/NaN|Infinity|%/);assert.ok(out.endsWith('\n'));
 });
 test('a current installation says so instead of drawing an arrow',()=>{
  assert.match(render([{stage:'release',current:'0.1.47',available:'0.1.47'}]),/0\.1\.47 is already current/);
 });
 test('resuming an interrupted update names it as such',()=>{
  assert.match(render([{stage:'install',version:'0.1.47',recovered:true}]),/Resuming the interrupted update to afbin 0\.1\.47/);
 });
});

describe('afbin update command',()=>{
 /** The real update, with the standalone installation and release fixtures a test cannot get from `isSea()`. */
 const fixture=async(prefix:string)=>{
  const home=await mkdtemp(join(tmpdir(),prefix)),exe=join(home,'afbin');await writeFile(exe,'old binary',{mode:0o755});
  const out:string[]=[],err:string[]=[];
  const context={home,cwd:home,env:{PATH:''},stdout:(x:string)=>out.push(x),stderr:(x:string)=>err.push(x),fetch:async()=>assert.fail('only the update fixture may use the network'),
   update:(options:Parameters<typeof updateCli>[0])=>updateCli({...options,installation:{kind:'standalone',path:exe},platform:'darwin',arch:'arm64',version:'1.0.0',verifyExecutable:async()=>{},fetch:options.dryRun?options.fetch!:chunkedTransport()})};
  return {home,exe,out,err,context,cleanup:()=>rm(home,{recursive:true,force:true})};
 };
 test('--json in a terminal never prompts and never draws progress',async()=>{
  const f=await fixture('afbin-update-json-');
  try{
   const code=await runCli(['update','--json','--server','https://artifactbin.dev'],{...f.context,interactive:true,progress:true,chooseSkills:async()=>assert.fail('--json must not prompt')});
   assert.equal(code,0,f.out.join('')+f.err.join(''));
   assert.equal(JSON.parse(f.out.join('')).version,'9.0.0');assert.equal(f.err.join(''),'');
   assert.equal(await readFile(f.exe,'utf8'),'new binary');
  }finally{await f.cleanup();}
 });
 test('without a terminal the update neither prompts nor writes progress',async()=>{
  const f=await fixture('afbin-update-pipe-');
  try{
   const code=await runCli(['update','--server','https://artifactbin.dev'],{...f.context,interactive:false,chooseSkills:async()=>assert.fail('no terminal, no prompt')});
   assert.equal(code,0,f.err.join(''));assert.equal(f.err.join(''),'');assert.equal(await readFile(f.exe,'utf8'),'new binary');
  }finally{await f.cleanup();}
 });
 test('in a terminal the download is drawn first, then the menu, then the installation',async()=>{
  const f=await fixture('afbin-update-tty-');
  try{
   let atMenu='';
   const code=await runCli(['update','--server','https://artifactbin.dev'],{...f.context,interactive:true,progress:true,chooseSkills:async choices=>{atMenu=f.err.join('');return choices.filter(x=>x.name==='pi').map(x=>x.name);}});
   assert.equal(code,0,f.err.join(''));
   assert.match(atMenu,/1\.0\.0 → 9\.0\.0/);assert.match(atMenu,/100%/);assert.doesNotMatch(atMenu,/Installing/);
   assert.match(f.err.join('').slice(atMenu.length),/Installing afbin 9\.0\.0/);
   assert.match(await readFile(join(skillTargets(f.home,{PATH:''}).pi,'SKILL.md'),'utf8'),/New skill/);
  }finally{await f.cleanup();}
 });
 test('--harness answers the menu, so a terminal update does not show it',async()=>{
  const f=await fixture('afbin-update-harness-');
  try{
   const code=await runCli(['update','--harness','pi','--server','https://artifactbin.dev'],{...f.context,interactive:true,chooseSkills:async()=>assert.fail('--harness must not prompt')});
   assert.equal(code,0,f.err.join(''));assert.match(await readFile(join(skillTargets(f.home,{PATH:''}).pi,'SKILL.md'),'utf8'),/New skill/);
  }finally{await f.cleanup();}
 });
 test('an interactive --dry-run plans the skills chosen in the menu',async()=>{
  const f=await fixture('afbin-update-dry-tty-');
  try{
   const code=await runCli(['update','--dry-run','--server','https://artifactbin.dev'],{...f.context,interactive:true,
    fetch:async(input:unknown)=>String(input).endsWith('/chat/release.json')?Response.json({version:'9.0.0',protocol:2}):assert.fail(String(input)),
    chooseSkills:async choices=>choices.filter(x=>x.name==='pi').map(x=>x.name)});
   assert.equal(code,0,f.err.join(''));
   assert.deepEqual(JSON.parse(f.out.join('').replace(/\x1b\[[0-9;]*m/g,'')).skills.map((x:any)=>x.harness),['pi']);
  }finally{await f.cleanup();}
 });
});
