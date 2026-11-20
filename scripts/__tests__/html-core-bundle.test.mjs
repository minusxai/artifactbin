/**
 * THE REAL BUILDS behind the deployed server: the actual immutable runtime relocated with the server bundle and served
 * through the installed preview, the installed parser compiled from a relocated bundle, and every shipped script's
 * prebuilt compaction. Each compiles real sources, so this file is slow; the plugins' contracts on stub assets are
 * html-core-prebuilt.test.mjs.
 */
import {FLAT_RUNTIME_ASSET_PATH} from '../lib/runtime-asset-paths.mjs';
import {afterEach,expect,it,onTestFinished} from 'vitest';
import {build,transform} from 'esbuild';
import {mkdir,writeFile,rm,readdir,copyFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {buildPreviewParser} from '../../services/app/lib/skills/index.ts';
import {buildHtmlAssets as compileActualRuntime} from '../../services/app/lib/html-runtime/server.ts';
import {prebuiltHtmlCore,prebuiltPreviewAssets} from '../build/html-core.mjs';
import {tempDir} from '../../services/test-support/src/temp-dir.ts';
const cleanup=[];afterEach(async()=>{for(const close of cleanup.splice(0).reverse())await close();});
it('serves every actual immutable runtime asset after relocating the server bundle',async()=>{
 const assets=await compileActualRuntime(),root=await tempDir('af-actual-runtime-',onTestFinished);
 const source=path.join(root,'services/app/lib/html-runtime/build.server.ts');await mkdir(path.dirname(source),{recursive:true});await writeFile(source,'throw Error("source tree must not execute")');
 const output=path.join(root,'relocated/server.mjs');await build({entryPoints:[source],bundle:true,format:'esm',platform:'node',outfile:output,plugins:[prebuiltHtmlCore(root,()=>assets)]});
 await rm(path.join(root,'services'),{recursive:true,force:true});const {buildHtmlAssets}=await import(pathToFileURL(output).href);const relocated=await buildHtmlAssets();
 expect(relocated).toEqual(assets);expect(relocated.portableEnginePath).toBe('/af/portable.js');
 for(const [key,assetPath] of Object.entries(relocated))if(key.endsWith('Path'))expect(assetPath).toMatch(FLAT_RUNTIME_ASSET_PATH);
 const installed=path.join(root,'installed'),project=path.join(root,'project'),skillSource=new URL('../../services/app/skills/artifactbin/scripts/',import.meta.url);await mkdir(installed);await mkdir(project);await writeFile(path.join(project,'index.html'),'<h1>Relocated runtime</h1>');
 for(const name of await readdir(skillSource))if(name.endsWith('.mjs'))await copyFile(new URL(name,skillSource),path.join(installed,name));
 await writeFile(path.join(installed,'preview-html.mjs'),await buildPreviewParser(await readFile(new URL('preview-html.mjs',skillSource),'utf8')));
 // The selected server answers the relocated runtime at its flat /af/ addresses; the preview fetches it from there.
 const served=new Map([['/af/core.js',relocated.core],...Object.entries(relocated).filter(([key])=>key.endsWith('Path')).map(([key,value])=>[value,relocated[key.slice(0,-4)]])]);
 const {withHttpServer}=await import('../../services/test-support/src/net.ts');
 const platform=await withHttpServer((request,reply)=>{const body=served.get(request.url);reply.writeHead(body===undefined?404:200,{'content-type':'text/javascript'});reply.end(body??'');});cleanup.push(()=>platform.close());
 const {startPreview}=await import(pathToFileURL(path.join(installed,'preview-server.mjs')).href);const preview=await startPreview({root:project,platformOrigin:platform.base});cleanup.push(()=>preview.close());
 for(const [resource,source] of [['/af/core.js',relocated.core],...Object.entries(relocated).filter(([key])=>key.endsWith('Path')).map(([key,value])=>[value,relocated[key.slice(0,-4)]])]){const response=await fetch(new URL(resource,preview.url));expect(response.status,resource).toBe(200);expect(await response.text(),resource).toBe(source);}

});

it('compiles the installed parser from deployed package cwd after actual server bundling relocates it',async()=>{
 const {createRequire}=await import('node:module');const directory=await tempDir('preview-parser-server-bundle-',onTestFinished);
 const outfile=path.join(directory,'server.mjs'),engine=createRequire(import.meta.url).resolve('esbuild');
 await build({entryPoints:[path.resolve('lib/skills/preview-assets.server.ts')],outfile,bundle:true,platform:'node',format:'esm',target:'node22',plugins:[{name:'external-installed-build-engine',setup(builder){builder.onResolve({filter:/^esbuild$/},()=>({path:engine,external:true}));}}]});
 const relocated=await import(pathToFileURL(outfile).href),source=await readFile(path.resolve('skills/artifactbin/scripts/preview-html.mjs'),'utf8');
 const parser=await relocated.buildPreviewParser(source);await writeFile(path.join(directory,'parser.mjs'),parser);const installed=await import(pathToFileURL(path.join(directory,'parser.mjs')).href);
 const packed=await installed.packPreviewExport({html:'<script type="module" src="./main.js"></script>',pathname:'/index.html',load:async()=>({contentType:'text/javascript',bytes:Buffer.from('export const value=42;')})});expect(packed).toContain('data:text/javascript;base64,');
});

it('prebuilds real shipped script compactions without deploying the source compiler',async()=>{
 const root=path.resolve('../..'),directory=await tempDir('af-script-compactions-',onTestFinished);
 const output=path.join(directory,'helpers.mjs'),source=path.join(root,'services/app/lib/skills/preview-assets.server.ts');
 const result=await build({entryPoints:[source],bundle:true,format:'esm',platform:'node',outfile:output,metafile:true,plugins:[prebuiltPreviewAssets(root)]});
 expect(Object.keys(result.metafile.inputs)).toEqual([path.relative(process.cwd(),source)]);
 expect(result.metafile.outputs[output]?.imports??Object.values(result.metafile.outputs)[0].imports).toEqual([]);
 const helpers=await import(pathToFileURL(output).href),scripts=path.join(root,'services/app/skills/artifactbin/scripts');
 for(const name of await readdir(scripts))if(name.endsWith('.mjs')){
  const authored=await readFile(path.join(scripts,name),'utf8');
  const expected=/^export const DESCRIPTION = `/m.test(authored)?authored:(await transform(authored,{loader:'js',minifyWhitespace:true,legalComments:'none',target:'node22'})).code;
  expect(await helpers.compactSkillScript(authored),name).toBe(expected);
 }
});

// pr fast budget probe: an edit of many node test files (closed unmerged)
