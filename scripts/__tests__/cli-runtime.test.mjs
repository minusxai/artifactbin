import {it,expect} from 'vitest';
import {mkdtemp,readFile,writeFile,rm,readdir,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
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
