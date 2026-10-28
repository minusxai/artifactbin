import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFile,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtemp,readFile,readdir,rm,stat,writeFile,cp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {isAbsolute,join,resolve} from 'node:path';
import {promisify} from 'node:util';
import {CLI_PROTOCOL_VERSION} from '../../contracts/src/cli-auth';

/** The release files the 0.3.x self-updater downloads, built and verified by the release tooling. */
const cli=resolve(import.meta.dirname,'..');
const tool=join(cli,'scripts/transition-assets.mjs');
const script=join(cli,'transition/afbin');
const {version}=JSON.parse(await readFile(join(cli,'package.json'),'utf8')) as {version:string};
const targets=['darwin-arm64','darwin-x64','linux-arm64','linux-x64'];
const names=[...targets.map(t=>`afbin-${t}`),...targets.map(t=>`afbin-${t}.manifest.json`),'afbin-skills.json'].sort();
const sha=(bytes:Buffer|string)=>createHash('sha256').update(bytes).digest('hex');
const run=(...args:string[])=>spawnSync(process.execPath,[tool,...args],{encoding:'utf8'});

async function built():Promise<string>{
 const dir=await mkdtemp(join(tmpdir(),'afbin-transition-'));
 const result=run('build',dir);
 assert.equal(result.status,0,result.stderr);
 return dir;
}

test('build writes exactly the nine files the old updater downloads, hashed and addressed to this release',async()=>{
 const dir=await built();
 try{
  assert.deepEqual((await readdir(dir)).sort(),names);
  const source=await readFile(script);
  const skillsBytes=await readFile(join(dir,'afbin-skills.json'));
  for(const target of targets){
   const [platform,arch]=target.split('-');
   const binary=join(dir,`afbin-${target}`);
   assert.ok((await readFile(binary)).equals(source),`${target} is the transition script byte for byte`);
   if(process.platform!=='win32')assert.equal((await stat(binary)).mode&0o111,0o111,`${target} is executable`);
   const manifest=JSON.parse(await readFile(join(dir,`afbin-${target}.manifest.json`),'utf8'));
   // Exactly these keys: no `gzip` entry, the asset is served as is.
   assert.deepEqual(manifest,{version,protocol:CLI_PROTOCOL_VERSION,platform,arch,
    binary:{file:`afbin-${target}`,sha256:sha(source)},skills:{file:'afbin-skills.json',sha256:sha(skillsBytes)}});
  }
  const skills=JSON.parse(skillsBytes.toString());
  assert.equal(skills.version,version);
  assert.equal(skills.protocol,CLI_PROTOCOL_VERSION);
  assert.deepEqual(Object.keys(skills).sort(),['files','protocol','version']);
  assert.equal(typeof skills.files['SKILL.md'],'string');
  assert.ok(Object.keys(skills.files).length>1,'references ship with the skill');
  for(const [path,content] of Object.entries(skills.files)){
   assert.equal(typeof content,'string',path);
   assert.ok(!isAbsolute(path)&&!path.includes('\\')&&path.split('/').every(part=>part&&part!=='.'&&part!=='..'),path);
  }
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('verify passes a fresh build and names the file when a hash, the pin or SKILL.md is wrong',async()=>{
 const dir=await built();
 try{
  const ok=run('verify',dir);
  assert.equal(ok.status,0,ok.stderr);
  const broken=async(alter:(copy:string)=>Promise<void>,file:string)=>{
   const copy=await mkdtemp(join(tmpdir(),'afbin-transition-broken-'));
   try{
    await cp(dir,copy,{recursive:true});await alter(copy);
    const result=run('verify',copy);
    assert.equal(result.status,1,`${file}: ${result.stdout}${result.stderr}`);
    const reason=result.stderr.trim();
    assert.equal(reason.split('\n').length,1,reason);
    assert.ok(reason.includes(file),`${reason} names ${file}`);
   }finally{await rm(copy,{recursive:true,force:true});}
  };
  await broken(async copy=>{
   const path=join(copy,'afbin-linux-x64.manifest.json');const manifest=JSON.parse(await readFile(path,'utf8'));
   manifest.binary.sha256='0'.repeat(64);await writeFile(path,JSON.stringify(manifest));
  },'afbin-linux-x64.manifest.json');
  await broken(async copy=>{
   const path=join(copy,'afbin-darwin-arm64');
   await writeFile(path,(await readFile(path,'utf8')).replace(`AFBIN_VERSION=${version}\n`,'AFBIN_VERSION=0.0.1\n'),{mode:0o755});
  },'afbin-darwin-arm64');
  await broken(async copy=>{
   // Re-hash every manifest so the only fault left is the missing skill entry point.
   const path=join(copy,'afbin-skills.json');const skills=JSON.parse(await readFile(path,'utf8'));
   delete skills.files['SKILL.md'];const bytes=JSON.stringify(skills);await writeFile(path,bytes);
   for(const target of targets){
    const file=join(copy,`afbin-${target}.manifest.json`);const manifest=JSON.parse(await readFile(file,'utf8'));
    manifest.skills.sha256=sha(bytes);await writeFile(file,JSON.stringify(manifest));
   }
  },'afbin-skills.json');
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('the script answers the updater\'s empty-environment version check and ignores a background update',{skip:process.platform==='win32'},async()=>{
 const exec=promisify(execFile);
 const versionCheck=await exec(script,['--version','--json'],{env:{}});
 assert.equal(versionCheck.stdout,`${JSON.stringify({version,protocol:CLI_PROTOCOL_VERSION})}\n`);
 assert.equal(versionCheck.stderr,'');
 const background=await exec(script,['--internal-background-update','a','b','c'],{env:{}});
 assert.equal(background.stdout,'');
 assert.equal(background.stderr,'');
});
