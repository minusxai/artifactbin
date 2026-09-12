import {it,expect} from 'vitest';
import {mkdtemp,readFile,writeFile,rm,readdir,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {parse} from 'yaml';
import {gzipSync} from 'node:zlib';
import {verifyLinuxRuntime} from '../../services/cli/scripts/runtime-compatibility.mjs';
import {runtimePin} from '../../services/cli/scripts/runtime.mjs';
import {downloadRuntime,packageRuntime} from '../../services/cli/scripts/runtime-package.mjs';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const node=Buffer.from('prepared runtime fixture'),gzip=gzipSync(node,{level:9});
const pin={url:'https://github.com/minusxai/artifactbin/releases/download/cli-runtime-test/node.gz',sha256:digest(node),gzipSha256:digest(gzip),size:node.length};
async function withRoot(run){const root=await mkdtemp(join(tmpdir(),'afbin-runtime-'));try{await run(root);}finally{await rm(root,{recursive:true,force:true});}}
it('downloads verified runtime bytes and reuses them without a network request',()=>withRoot(async root=>{
 const path=await downloadRuntime(pin,{root,fetch:async()=>new Response(gzip)});
 expect(await readFile(path)).toEqual(node);expect((await stat(path)).mode&0o777).toBe(0o755);
 expect(await downloadRuntime(pin,{root,fetch:async()=>{throw new Error('offline');}})).toBe(path);
 expect(await readdir(root)).toEqual(['node']);
}));
it('packages the exact prepared runtime with independently verifiable pins',()=>withRoot(async root=>{
 const binary=join(root,'node'),output=join(root,'node.gz');await writeFile(binary,node);
 const metadata=await packageRuntime(binary,output);
 expect(metadata).toEqual({sha256:pin.sha256,gzipSha256:pin.gzipSha256,size:pin.size});
 expect(await readFile(output)).toEqual(gzip);
}));
for(const [name,entry,body] of [
 ['transport hash',pin,Buffer.from('bad')],
 ['decoded hash',{...pin,sha256:'0'.repeat(64)},gzip],
 ['decoded size',{...pin,size:1},gzip],
])it(`rejects ${name} before installing a runtime`,()=>withRoot(async root=>{
 await expect(downloadRuntime(entry,{root,fetch:async()=>new Response(body)})).rejects.toThrow();
 expect(await readdir(root)).toEqual([]);
}));
it('repairs an untrusted local cache from verified release bytes',()=>withRoot(async root=>{
 await writeFile(join(root,'node'),'tampered');
 const path=await downloadRuntime(pin,{root,fetch:async()=>new Response(gzip)});
 expect(await readFile(path)).toEqual(node);
}));
it('a missing release fails promptly and never falls back to source compilation',()=>withRoot(async root=>{
 await expect(downloadRuntime(pin,{root,fetch:async()=>new Response('',{status:404})})).rejects.toThrow(/prebuilt runtime.*404.*runtime workflow/i);
 expect(await readdir(root)).toEqual([]);
}));

it('runtime selection binds the release to its exact platform and recipe',()=>{
 const entry={...pin,recipe:{platform:'darwin',arch:'arm64',version:'22.22.3',intl:'small-icu'}};
 const lock={schema:1,release:'cli-node-v22.22.3-r1',version:'22.22.3',platforms:{'darwin-arm64':entry}};
 expect(runtimePin(lock,'darwin','arm64').url).toBe('https://github.com/minusxai/artifactbin/releases/download/cli-node-v22.22.3-r1/afbin-node-darwin-arm64.gz');
 expect(()=>runtimePin(lock,'linux','x64')).toThrow(/No pinned prebuilt runtime/);
 expect(()=>runtimePin({...lock,version:'24.0.0'},'darwin','arm64')).toThrow(/recipe/);
});

for(const scenario of ['new','corrupt','existing'])it(`runtime producer handles ${scenario} assets without executing downloaded code`,()=>withRoot(async root=>{
 const workflow=parse(await readFile(new URL('../../.github/workflows/cli-runtime.yml',import.meta.url),'utf8'));
 const fakeGh=`#!${process.execPath}
const fs=require('node:fs'),zlib=require('node:zlib'),crypto=require('node:crypto');
const args=process.argv.slice(2),all=args.join(' '),digest=b=>crypto.createHash('sha256').update(b).digest('hex');
fs.appendFileSync('calls',all+'\\n');
if(all.startsWith('release view')){if(process.env.SCENARIO==='existing')process.exit(0);console.error('HTTP 404');process.exit(1);}
if(all.startsWith('run download')){
 const dir=args[args.indexOf('--dir')+1],runner=args[args.indexOf('--name')+1].replace('cli-node-','');
 const target={'macos-14':'darwin-arm64','macos-15-intel':'darwin-x64','ubuntu-24.04':'linux-x64','ubuntu-24.04-arm':'linux-arm64'}[runner];
 const bytes=Buffer.from('runtime fixture'),gzip=zlib.gzipSync(bytes),name='afbin-node-'+target,license=Buffer.from('Node license fixture');
 fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(dir+'/'+name+'.gz',gzip);fs.writeFileSync(dir+'/NODE-LICENSE',license);
 fs.writeFileSync(dir+'/'+name+'.pin.json',JSON.stringify({size:bytes.length,sha256:digest(bytes),licenseSha256:digest(license),gzipSha256:process.env.SCENARIO==='corrupt'?'0'.repeat(64):digest(gzip)}));
}else if(!all.startsWith('release create'))process.exit(2);
`;
 await writeFile(join(root,'gh'),fakeGh,{mode:0o755});
 const env={...process.env,PATH:`${root}:${process.env.PATH}`,SCENARIO:scenario,RUNTIME_TAG:'cli-node-v22.22.3-r1',GITHUB_SHA:'a'.repeat(40),GITHUB_RUN_ID:'123',GITHUB_REPOSITORY:'minusxai/artifactbin'};
 const run=script=>spawnSync('bash',['-c',script],{cwd:root,env,encoding:'utf8'});
 const planned=run(workflow.jobs.plan.steps[0].run);
 if(scenario==='existing'){expect(planned.status).not.toBe(0);expect(await readFile(join(root,'calls'),'utf8')).not.toContain('run download');return;}
 expect(planned.status,planned.stderr).toBe(0);
 const published=run(workflow.jobs.publish.steps[0].run);
 if(scenario==='corrupt'){expect(published.status).not.toBe(0);expect(await readFile(join(root,'calls'),'utf8')).not.toContain('release create');}
 else{expect(published.status,published.stderr).toBe(0);expect(await readdir(join(root,'bundle'))).toHaveLength(9);expect(await readFile(join(root,'bundle/NODE-LICENSE'),'utf8')).toBe('Node license fixture');expect(await readFile(join(root,'calls'),'utf8')).toContain('release create cli-node-v22.22.3-r1');}
}));

for(const requirement of ['GLIBC_2.28','GLIBC_2.29','GLIBCXX_3.4'])it(`checks large ELF version tables against ${requirement}`,()=>withRoot(async root=>{
 const readelf=join(root,'readelf');
 await writeFile(readelf,`#!${process.execPath}\nprocess.stdout.write(process.argv[2]==='-h'?'Type: EXEC (Executable file)':'x'.repeat(1100000)+'\\nName: ${requirement}\\n');`,{mode:0o755});
 const verify=()=>verifyLinuxRuntime('/unused-fixture',{readelf});
 if(requirement==='GLIBC_2.28')expect(verify).not.toThrow();else expect(verify).toThrow(/Runtime requires|statically linked/);
}));
it('verify-only fails without compiling when no runtime candidate exists',()=>withRoot(async root=>{
 const script=new URL('../../services/cli/scripts/small-node.mjs',import.meta.url);
 const result=spawnSync(process.execPath,[script.pathname,'--verify-only'],{cwd:root,env:{...process.env,CI:'1'},encoding:'utf8',timeout:3000});
 expect(result.error).toBeUndefined();expect(result.status).not.toBe(0);
 expect(result.stderr).toContain('Verification never compiles');
}));
