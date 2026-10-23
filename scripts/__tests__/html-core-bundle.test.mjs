import {afterEach,expect,it} from 'vitest';
import {build} from 'esbuild';
import {createServer} from 'node:http';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {prebuiltHtmlCore} from '../build/html-core.mjs';
const cleanup=[];afterEach(async()=>{for(const close of cleanup.splice(0).reverse())await close();});
it('a relocated bundled HTTP server serves the exact native core without the source TypeScript tree',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'af-core-bundle-'));cleanup.push(()=>rm(root,{recursive:true,force:true}));const source=path.join(root,'services/app/lib/html-runtime/build.server.ts');await mkdir(path.dirname(source),{recursive:true});await writeFile(source,'export async function buildHtmlCore(){throw Error("source builder must not execute after bundling")}');
 const expected='/* immutable HTML core */ globalThis.coreReady=true;';const output=path.join(root,'relocated/server.mjs');
 await build({stdin:{contents:`export {buildHtmlCore} from ${JSON.stringify(source)};`,resolveDir:root,loader:'ts'},bundle:true,format:'esm',platform:'node',outfile:output,plugins:[prebuiltHtmlCore(root,()=>expected)]});
 await rm(path.join(root,'services'),{recursive:true,force:true});const {buildHtmlCore}=await import(pathToFileURL(output).href);const server=createServer(async(_request,response)=>{try{response.setHeader('content-type','application/javascript');response.end(await buildHtmlCore());}catch{response.statusCode=500;response.end('core unavailable');}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));cleanup.push(()=>new Promise(resolve=>server.close(resolve)));const address=server.address();const response=await fetch(`http://127.0.0.1:${address.port}/af/v1/core.js`);expect(response.status).toBe(200);expect(await response.text()).toBe(expected);
});
it('refuses to emit an empty immutable runtime',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'af-core-empty-'));cleanup.push(()=>rm(root,{recursive:true,force:true}));const source=path.join(root,'services/app/lib/html-runtime/build.server.ts');await mkdir(path.dirname(source),{recursive:true});await writeFile(source,'export function buildHtmlCore(){}');
 await expect(build({entryPoints:[source],bundle:true,write:false,plugins:[prebuiltHtmlCore(root,()=> '')]})).rejects.toThrow('HTML core is empty');
});
