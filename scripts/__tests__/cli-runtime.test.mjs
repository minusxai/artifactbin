import {it,expect} from 'vitest';
import {mkdtemp,readFile,writeFile,rm,readdir,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
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
