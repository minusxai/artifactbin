import {expect,it} from 'vitest';
import {build} from 'esbuild';
import path from 'node:path';
import {componentImports,libraryImports,libraryPathForSpecifier,libraryUrls,libraryVersions,resolveLibraryUrl} from '../index';
import hosted from '../../html-components/hosted.json';
const hostedComponents=hosted.components;
import registry from '../registry.json';
import {assembleHtmlPage,downloadableHtml} from '../../html-runtime';
import {referencedLibraryResources} from '../assets.server';
import {packOfflineDependencies} from '../../offline-dependencies';
import {platformModules} from '../../../skills/artifactbin/scripts/preview-platform.mjs';
import {packPreviewExport} from '../../../skills/artifactbin/scripts/preview-export.mjs';

const names=Object.keys(registry);
const runtime=(html:string)=>JSON.parse(/<script type="application\/json" data-af="runtime">([\s\S]*?)<\/script>/.exec(html)![1]!);
const base={pageId:'P',revision:'1',backends:[]};
it('maps every hosted library, highlight included, and every hosted component to @afbin/<name> at its current URL',()=>{
 expect(names).toContain('highlight');
 const imports=libraryImports(undefined);
 expect(Object.keys(imports).sort()).toEqual([...names,...hostedComponents].map(n=>'@afbin/'+n).sort());
 for(const name of hostedComponents)expect(imports['@afbin/'+name]).toBe(`/af/components/${name}.js`);
 expect(componentImports()['@afbin/tabs']).toBe('/af/components/tabs.js');expect(libraryPathForSpecifier('@afbin/tabs')).toBe('/af/components/tabs.js');
 // A library name wins: the legacy deck.gl and Mermaid wrapper elements are not hosted components.
 expect(libraryPathForSpecifier('@afbin/deck-gl')).toBe(libraryUrls()['deck-gl']);expect(libraryPathForSpecifier('@afbin/mermaid')).toBeUndefined();expect(libraryPathForSpecifier('@afbin/register-component')).toBeUndefined();
 for(const name of names)expect(imports['@afbin/'+name]).toBe(libraryUrls()[name]);
 expect(imports['@afbin/highlight']).toBe('/libraries/highlight-11.12.0/index.js');
 expect(libraryVersions().vega).toBe('6.3.1');
});
it('resolves through one seam that ignores recorded pins until retained builds exist',()=>{
 expect(resolveLibraryUrl('vega','1.0.0')).toBe(resolveLibraryUrl('vega'));
 expect(libraryImports({vega:'1.0.0',unknown:'9'})['@afbin/vega']).toBe('/libraries/vega-6.3.1/index.js');
 expect(libraryPathForSpecifier('@afbin/vega')).toBe('/libraries/vega-6.3.1/index.js');
 for(const bad of ['vega','@afbin/apollo','@afbin/nope','@afbin/__proto__','@afbin/vega/x'])expect(libraryPathForSpecifier(bad)).toBeUndefined();
});
it('exposes library URLs in the runtime JSON, never overriding an author import map key, and omits them offline',()=>{
 const libraries=libraryImports(undefined);
 const hosted=assembleHtmlPage({html:'<html><head></head><body></body></html>',core:'/*c*/',config:{...base,libraries}});
 expect(runtime(hosted).libraries).toEqual(libraries);
 const own='<html><head><script type="importmap">{"imports":{"@afbin/vega":"/mine/vega.js"}}</script></head><body></body></html>';
 const claimed=runtime(assembleHtmlPage({html:own,core:'/*c*/',config:{...base,libraries}})).libraries;
 expect(claimed['@afbin/vega']).toBeUndefined();expect(claimed['@afbin/three']).toBe(libraries['@afbin/three']);
 expect(runtime(downloadableHtml({html:'<html><head></head><body></body></html>',core:'/*c*/',apollo:'export {};',reader:'export {};',config:{...base,libraries}})).libraries).toBeUndefined();
});
it('has the core add validated library entries to the import map, skipped for portable copies',async()=>{
 const {buildHtmlCore}=await import('../../html-runtime/build.server');
 const core=await buildHtmlCore();
 expect(core).toMatch(/\b\w+\.libraries\?\?\{\}/);
 expect(core).toContain('@afbin\\/[a-z][a-z0-9-]*$');
 // Hosted component entries (/af/components/<name>.js) pass the same value check as the versioned libraries.
 expect(core).toContain('af\\/components\\/[a-z][a-z0-9-]*');
 expect(core).toMatch(/if\(!\w+\)for\(let\[\w+,\w+\]of Object\.entries\(\w+\.libraries/);
 expect(core.indexOf('.libraries')).toBeLessThan(core.indexOf('"@afbin/apollo"'));
});
it('packs a bare @afbin/vega import into the offline copy',async()=>{
 const html='<script type="module">import * as vega from "@afbin/vega";console.log(vega);</script>';
 const baseUrl='https://page.example/a/PAGE12/download';
 const resources=await referencedLibraryResources(html,[],baseUrl);
 expect(resources.map(r=>r.url)).toEqual(['/libraries/vega-6.3.1/index.js']);
 const packed=await packOfflineDependencies({html,baseUrl,resources});
 expect(packed.embeddedUrls).toHaveLength(1);expect(packed.html).not.toContain('@afbin/vega');
});
it('local preview resolves and exports a bare @afbin/vega import',async()=>{
 const platform=platformModules({libraryAssets:{'/libraries/vega-6.3.1/index.js':'export const marker=1;','/libraries/pele-flowchart-1.12.0/index.js':'export {};'}});
 const map=await platform.importMap();
 expect(map).toEqual({'@afbin/vega':'/libraries/vega-6.3.1/index.js','@afbin/pele-flowchart':'/libraries/pele-flowchart-1.12.0/index.js'});
 const html='<!doctype html><html><head></head><body><script type="module">import {marker} from "@afbin/vega";console.log(marker);</script></body></html>';
 const out=await packPreviewExport({html,pathname:'/index.html',libraries:map,load:async(name:string)=>{const bytes=await platform.module(name);if(bytes)return {contentType:'text/javascript',bytes};throw Error('missing '+name);}});
 expect(out).not.toContain('"@afbin/vega"');expect(out).toContain('importmap');
});
it('builds the highlight library with the web language set and tok- classes',async()=>{
 const result=await build({entryPoints:[path.resolve('lib/libraries/highlight.js')],bundle:true,minify:true,write:false,format:'esm',platform:'browser',target:'es2022',logLevel:'silent'});
 const module=await import(/* @vite-ignore */`data:text/javascript;base64,${Buffer.from(result.outputFiles[0]!.contents).toString('base64')}`);
 for(const language of ['xml','css','javascript','typescript','json','bash','python','sql','html','svg','js','jsx','mjs','ts','tsx','sh','shell','zsh','py'])expect(module.hljs.getLanguage(language),language).toBeTruthy();
 const out=module.hljs.highlight('const a = "x";',{language:'js'}).value;
 expect(out).toContain('class="tok-keyword"');expect(out).toContain('tok-string');
 expect(typeof module.highlightAll).toBe('function');
});
it('changes the script fingerprint when a versioned path becomes @afbin/<name>, but import-map entries never enter it',async()=>{
 const {scriptFingerprint}=await import('../../html-autofix');
 const page=(spec:string)=>`<html><head></head><body><script type="module">import * as vega from "${spec}";console.log(vega);</script></body></html>`;
 const versioned=scriptFingerprint(page('/libraries/vega-6.3.1/index.js')),bare=scriptFingerprint(page('@afbin/vega'));
 expect(versioned).not.toBe(bare);
 // The fingerprint reads the authored source only; the generated map and runtime JSON are added at assembly.
 expect(scriptFingerprint(page('@afbin/vega'))).toBe(bare);
 const assembled=assembleHtmlPage({html:page('@afbin/vega'),core:'/*c*/',config:{...base,libraries:libraryImports(undefined)}});
 expect(runtime(assembled).libraries['@afbin/vega']).toBeDefined();
 expect(scriptFingerprint(page('@afbin/vega'))).toBe(bare);
});
