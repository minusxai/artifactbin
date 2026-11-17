/**
 * THE PREBUILT-ASSET PLUGINS (scripts/build/html-core.mjs) with stub assets: a bundled server answers the immutable core
 * and the preview helpers it was handed, with the source tree gone, and refuses empty or drifted assets. Small builds of
 * stub sources only; the real runtime and the shipped scripts are compiled in html-core-bundle.test.mjs.
 */
import {afterEach,expect,it} from 'vitest';
import {build} from 'esbuild';
import {createServer} from 'node:http';
import {mkdtemp,mkdir,writeFile,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {prebuiltHtmlCore,prebuiltPreviewAssets} from '../build/html-core.mjs';
const cleanup=[];afterEach(async()=>{for(const close of cleanup.splice(0).reverse())await close();});
it('a relocated bundled HTTP server serves the exact native core without the source TypeScript tree',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'af-core-bundle-'));cleanup.push(()=>rm(root,{recursive:true,force:true}));const source=path.join(root,'services/app/lib/html-runtime/build.server.ts');await mkdir(path.dirname(source),{recursive:true});await writeFile(source,'export async function buildHtmlCore(){throw Error("source builder must not execute after bundling")}');
 const expected='/* immutable HTML core */ globalThis.coreReady=true;';const output=path.join(root,'relocated/server.mjs');
 await build({stdin:{contents:`export {buildHtmlCore,buildHtmlAssets} from ${JSON.stringify(source)};`,resolveDir:root,loader:'ts'},bundle:true,format:'esm',platform:'node',outfile:output,plugins:[prebuiltHtmlCore(root,()=>({core:expected,apollo:"export const client={}",apolloPath:"/af/v1/apollo/test"}))]});
 await rm(path.join(root,'services'),{recursive:true,force:true});const {buildHtmlCore,buildHtmlAssets}=await import(pathToFileURL(output).href);expect(await buildHtmlAssets()).toEqual({core:expected,apollo:"export const client={}",apolloPath:"/af/v1/apollo/test"});const server=createServer(async(_request,response)=>{try{response.setHeader('content-type','application/javascript');response.end(await buildHtmlCore());}catch{response.statusCode=500;response.end('core unavailable');}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));cleanup.push(()=>new Promise(resolve=>server.close(resolve)));const address=server.address();const response=await fetch(`http://127.0.0.1:${address.port}/af/core.js`);expect(response.status).toBe(200);expect(await response.text()).toBe(expected);
});
it('refuses to emit an empty immutable runtime',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'af-core-empty-'));cleanup.push(()=>rm(root,{recursive:true,force:true}));const source=path.join(root,'services/app/lib/html-runtime/build.server.ts');await mkdir(path.dirname(source),{recursive:true});await writeFile(source,'export function buildHtmlCore(){}');
 await expect(build({entryPoints:[source],bundle:true,write:false,plugins:[prebuiltHtmlCore(root,()=> '')]})).rejects.toThrow('HTML core assets are empty');
});

it('relocates installed preview helpers and rejects skill-source/build drift',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'af-preview-bundle-'));cleanup.push(()=>rm(root,{recursive:true,force:true}));
 const source=path.join(root,'services/app/lib/skills/preview-assets.server.ts');await mkdir(path.dirname(source),{recursive:true});await writeFile(source,'throw Error("source compiler must not execute in deployed server")');
 const output=path.join(root,'relocated/preview.mjs'),expected={parser:'export function previewHtml(){}',toolbox:'export const identity="prebuilt-toolbox";',parserSource:'authored parser source',compactedScripts:{'export const value = 42;\n':'export const value=42;\n','export const DESCRIPTION = `Installed help`;\n':'export const DESCRIPTION = `Installed help`;\n'}};
 await build({stdin:{contents:`export {buildPreviewParser,buildToolboxPlatform,compactSkillScript} from ${JSON.stringify(source)};`,resolveDir:root,loader:'ts'},bundle:true,format:'esm',platform:'node',outfile:output,plugins:[prebuiltPreviewAssets(root,()=>expected)]});
 await expect(build({entryPoints:[source],bundle:true,write:false,platform:'node',logLevel:'silent',plugins:[prebuiltPreviewAssets(root,()=>({...expected,toolbox:''}))]})).rejects.toThrow('Preview helper assets are empty');
 await rm(path.join(root,'services'),{recursive:true,force:true});const helpers=await import(pathToFileURL(output).href);
 expect(await helpers.buildPreviewParser(expected.parserSource)).toBe(expected.parser);
 const toolbox=await helpers.buildToolboxPlatform();expect(toolbox).toBe(expected.toolbox);const installed=path.join(root,'relocated/toolbox.mjs');await writeFile(installed,toolbox);expect((await import(pathToFileURL(installed).href)).identity).toBe('prebuilt-toolbox');
 await expect(helpers.buildPreviewParser('different source')).rejects.toThrow('source differs');
 for(const [source,expectedScript] of Object.entries(expected.compactedScripts)){
  const compact=await helpers.compactSkillScript(source);expect(compact).toBe(expectedScript);
  const installedScript=path.join(root,'relocated',source.includes('DESCRIPTION')?'command.mjs':'helper.mjs');await writeFile(installedScript,compact);
  const exports=await import(pathToFileURL(installedScript).href);if(source.includes('DESCRIPTION'))expect(exports.DESCRIPTION).toBe('Installed help');else expect(exports.value).toBe(42);
 }
 await expect(helpers.compactSkillScript('unknown source')).rejects.toThrow('source differs');
 expect(await readFile(output,'utf8')).not.toMatch(/from ["'](?:esbuild|.*preview-assets\.server)/);
});
