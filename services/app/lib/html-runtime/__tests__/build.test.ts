import {parse,type DefaultTreeAdapterMap} from 'parse5';
import {gzipSync} from 'node:zlib';
import {fileURLToPath} from 'node:url';
import { expect, it } from 'vitest';
import { buildHtmlCore,buildHtmlAssets } from '../build.server';
import { downloadableHtml,assembleHtmlPage } from '../index';
import { PLATFORM_STYLES_PATH } from '../../html-systems';
/** `@afbin/offline-sql` gzipped: the SQLite engine and its wasm, carried only by an export with rows (594,406 B measured 2026-11-10). */
const OFFLINE_SQL_GZIP_BUDGET=600*1024;
it('builds a classic bootstrap and a self-contained downloadable page', async () => {
  const {core,apollo,reader} = await buildHtmlAssets();
  expect(() => new Function(core)).not.toThrow();
  const html = downloadableHtml({ html: '<html><body><h1 data-af-id="n1">Hello</h1></body></html>', core, apollo, reader, config: { pageId: 'p1', revision: '1', backends: [] } });
  expect(html).toContain('@afbin/apollo');
  expect(html).toContain('"offline":true');
  expect(html).not.toContain('src="');
});

it('keeps executable inline JavaScript in assembled static HTML under the 10 KiB budget',async()=>{
 const html=assembleHtmlPage({html:'<html><body><h1>Static report</h1></body></html>',core:await buildHtmlCore(),config:{pageId:'p',revision:'1',backends:[]}});
 const scripts:string[]=[];
 const visit=(node:DefaultTreeAdapterMap['node'])=>{
  if('attrs' in node&&node.nodeName==='script'&&!node.attrs.some(attr=>attr.name==='type'&&['application/json','importmap'].includes(attr.value)))scripts.push(node.childNodes.map(child=>'value' in child?child.value:'').join(''));
  if('childNodes' in node)for(const child of node.childNodes)visit(child);
 };
 for(const node of parse(html).childNodes)visit(node);
 expect(gzipSync(scripts.join('\n')).byteLength).toBeLessThan(10*1024);
});

it('hosted readers omit the author engine, while downloads carry the same module without network dependencies',async()=>{
 const assets=await buildHtmlAssets();
 expect(assets.apolloPath).toBe("/af/apollo.js");
 expect(assets.core).not.toContain(assets.apollo);
 const html=downloadableHtml({html:'<html><body></body></html>',core:assets.core,apollo:assets.apollo,reader:assets.reader,config:{pageId:'p',revision:'1',backends:[]}});
 expect(html).toContain('data-af="apollo"');
 expect(JSON.parse(/data-af="apollo">([\s\S]*?)<\/script>/.exec(html)![1]!)).toBe(assets.apollo);
 expect(html).not.toContain('src="');
});

it('keeps reader code out of the bootstrap and embeds exact portable reader bytes',async()=>{
 const assets=await buildHtmlAssets();
 expect(assets.readerPath).toBe("/af/reader.js");
 expect(assets.core).not.toContain(assets.reader);
 const hosted=assembleHtmlPage({html:'<html><body></body></html>',core:assets.core,config:{pageId:'p',revision:'1',backends:[]}});
 expect(hosted).not.toContain('<script type="application/json" data-af="reader">');
 const portable=downloadableHtml({html:'<html><body></body></html>',core:assets.core,apollo:assets.apollo,reader:assets.reader,config:{pageId:'p',revision:'1',backends:[]}});
 expect(JSON.parse(/data-af="reader">([\s\S]*?)<\/script>/.exec(portable)![1]!)).toBe(assets.reader);
});

import {runInNewContext} from 'node:vm';
it('marks overflowing tables in the native HTML core and updates the fade at the scroll end',async()=>{
 const core=await buildHtmlCore();
 const makeTable=(scrollWidth:number,clientWidth:number)=>{
  const attributes=new Map<string,string>(),listeners=new Map<string,(event:Event)=>void>();
  const table={scrollWidth,clientWidth,scrollLeft:0,attributes,listeners,
   hasAttribute(name:string){return attributes.has(name);},
   setAttribute(name:string,value:string){attributes.set(name,value);},
   removeAttribute(name:string){attributes.delete(name);},
   addEventListener(name:string,listener:(event:Event)=>void){listeners.set(name,listener);},
   removeEventListener(name:string){listeners.delete(name);},
  };
  return table;
 };
 const wide=makeTable(900,340),fits=makeTable(300,340),late=makeTable(900,340),tables:Array<ReturnType<typeof makeTable>>=[];
 const resizeListeners=new Map<string,(event:Event)=>void>();let resizeAdds=0,resizeRemoves=0;
 let mutationCallback:MutationCallback|undefined,disconnectedObservers=0;
 const timers=new Map<number,()=>void>();let nextTimer=1;
 class Observer{constructor(readonly callback:MutationCallback){mutationCallback=callback;}observe(){}disconnect(){disconnectedObservers++;}}
 const win={setTimeout:(callback:()=>void)=>{const id=nextTimer++;timers.set(id,callback);return id;},clearTimeout(id:number){timers.delete(id);},addEventListener(name:string,listener:(event:Event)=>void){if(name==='resize')resizeAdds++;resizeListeners.set(name,listener);},removeEventListener(name:string){if(name==='resize')resizeRemoves++;resizeListeners.delete(name);},MutationObserver:Observer};
 (win as {parent?:unknown}).parent=win;
 let ready:((event:Event)=>void)|undefined;
 const doc={defaultView:win,readyState:'loading',body:{},addEventListener(name:string,listener:(event:Event)=>void){if(name==='DOMContentLoaded')ready=listener;},removeEventListener(name:string){if(name==='DOMContentLoaded')ready=undefined;},documentElement:{hasAttribute:()=>false},
  querySelector(selector:string){if(selector==='table')return wide;return selector==='[data-af="runtime"]'?{textContent:JSON.stringify({pageId:'p',revision:'1',backends:[],offline:false})}:null;},
  querySelectorAll(selector:string){return selector.startsWith('table')?tables:[];},
  createElement(){return {type:'',textContent:''};},currentScript:{src:'',after(){}},
 };
 runInNewContext(core,{document:doc,window:win,location:{href:'https://page.example/report'},URL,Blob});
 expect(wide.attributes.has('data-mx-scrollable')).toBe(false);
 // The core is in <head>; it waits for parsing, then observes an empty body
 // so the first table inserted after startup receives the affordance.
 ready?.(new Event('DOMContentLoaded'));
 tables.push(wide,fits);
 mutationCallback?.([] as unknown as MutationRecord[],{} as MutationObserver);
 const initialInsert=[...timers.entries()].find(([id])=>id!==1);
 if(initialInsert){timers.delete(initialInsert[0]);initialInsert[1]();}
 expect(wide.attributes.get('data-mx-scrollable')).toBe('');
 expect(fits.attributes.has('data-mx-scrollable')).toBe(false);
 wide.scrollLeft=560;wide.listeners.get('scroll')?.({currentTarget:wide} as unknown as Event);
 expect(wide.attributes.get('data-mx-scrollable')).toBe('end');
 wide.scrollLeft=0;wide.listeners.get('scroll')?.({currentTarget:wide} as unknown as Event);
 expect(wide.attributes.get('data-mx-scrollable')).toBe('');
 wide.clientWidth=1000;resizeListeners.get('resize')?.(new Event('resize'));
 expect(wide.attributes.has('data-mx-scrollable')).toBe(false);
 tables.push(late);
 mutationCallback?.([] as unknown as MutationRecord[],{} as MutationObserver);
 const queued=[...timers.entries()].find(([id])=>id!==1);
 if(queued){timers.delete(queued[0]);queued[1]();}
 expect(late.attributes.get('data-mx-scrollable')).toBe('');
 // Re-running the core replaces its document owner and tears down the prior
 // observer/listeners before the replacement starts.
 runInNewContext(core,{document:doc,window:win,location:{href:'https://page.example/report'},URL,Blob});
 expect(disconnectedObservers).toBe(1);
 ready?.(new Event('DOMContentLoaded'));
 expect(resizeAdds-resizeRemoves).toBe(1);
 resizeListeners.get('pagehide')?.(new Event('pagehide'));
 expect(disconnectedObservers).toBe(2);
 resizeListeners.get('pageshow')?.(new Event('pageshow'));
 expect(resizeAdds-resizeRemoves).toBe(1);
});
it('leaves hosted top-level captures untouched and boots portable and raw local pages',async()=>{
 const assets=await buildHtmlAssets();
 for(const {offline,privatePreview} of [{offline:false,privatePreview:false},{offline:true,privatePreview:false},{offline:undefined,privatePreview:false},{offline:true,privatePreview:true}]) {
  const blobs:string[]=[];let imports:Record<string,string>|undefined,mapNonce:string|undefined;const listeners:string[]=[];
  const blocks:Record<string,string>={...(offline===undefined?{}:{runtime:JSON.stringify({pageId:'p',revision:'1',backends:[],offline})}),...(offline?{reader:JSON.stringify(assets.reader),apollo:JSON.stringify(assets.apollo)}:{})};
  const win={};const location={href:'https://page.example/report',pathname:'/report'};
  const document={readyState:'loading',addEventListener(event:string){listeners.push(event);},documentElement:{setAttribute(){},hasAttribute(name:string){return privatePreview&&name==='data-af-private-preview';}},querySelector(selector:string){const name=/data-af="([^"]+)"/.exec(selector)?.[1];return name&&blocks[name]?{textContent:blocks[name]}:null;},createElement(){return {type:'',textContent:''};},currentScript:{src:'',nonce:'platform-render-nonce',after(node:{textContent:string;nonce?:string}){imports=JSON.parse(node.textContent).imports;mapNonce=node.nonce;}}};
  const LocalURL=class extends URL {static createObjectURL(blob:Blob){const value=URL.createObjectURL(blob);blobs.push(value);return value;}};
  try {
   runInNewContext(assets.core,{document,location,window:Object.assign(win,{parent:win}),URL:LocalURL,Blob});
   expect(listeners).toEqual(['DOMContentLoaded']);expect(mapNonce).toBe('platform-render-nonce');
   expect(imports?.['@afbin/reader']).toMatch(offline?/^blob:/:/^https:\/\/page\.example\/af\/reader\.js$/);
   expect(imports?.['@afbin/apollo']).toMatch(offline?/^blob:/:/^https:\/\/page\.example\/af\/apollo\.js$/);
   if(offline){expect(await (await fetch(imports!['@afbin/reader']!)).text()).toBe(assets.reader);expect(await (await fetch(imports!['@afbin/apollo']!)).text()).toBe(assets.apollo);}
  }finally{for(const url of blobs)URL.revokeObjectURL(url);}
 }
});
it('hands the core\'s fetch the files the page published (config.files), before any author script runs',async()=>{
 const {core}=await buildHtmlAssets();
 const sent:unknown[]=[];const location={href:'https://abc123.pages.example/',pathname:'/'};
 const blocks:Record<string,string>={runtime:JSON.stringify({pageId:'p',revision:'1',backends:[],files:{'data.json':'/a/p/assets?dependency=d&revision=1&version=1'}})};
 const document={readyState:'loading',baseURI:location.href,addEventListener(){},documentElement:{setAttribute(){},hasAttribute(){return false;}},querySelector(selector:string){const name=/data-af="([^"]+)"/.exec(selector)?.[1];return name&&blocks[name]?{textContent:blocks[name]}:null;},createElement(){return {type:'',textContent:''};},currentScript:{src:'',after(){}}};
 const win:Record<string,unknown>={fetch:async(input:unknown)=>{sent.push(input);return new Response('{}');},Request,Response,URL,location,document};win.parent=win;
 runInNewContext(core,{document,location,window:win,URL,Blob});
 await (win.fetch as typeof fetch)('./data.json');await (win.fetch as typeof fetch)('./other.json');
 expect(sent).toEqual(['https://abc123.pages.example/a/p/assets?dependency=d&revision=1&version=1','./other.json']);
});
it('ships shared offline chrome within explicit code and style byte budgets',async()=>{
 const assets=await buildHtmlAssets();
 expect(assets.chrome).toContain('data-af-local-chrome');
 expect(gzipSync(assets.core).byteLength).toBeLessThan(10*1024);
 expect(gzipSync(assets.reader).byteLength).toBeLessThan(20*1024);
 expect(gzipSync(assets.chrome!).byteLength).toBeLessThan(180*1024);
 const html=downloadableHtml({html:'<html><body>Offline</body></html>',...assets,config:{pageId:'local',revision:'local',backends:[]}});
 expect(JSON.parse(/data-af="chrome">([^<]*)<\/script>/.exec(html)![1]!)).toBe(assets.chrome);
 expect(JSON.parse(/data-af="portable-engine">([^<]*)<\/script>/.exec(html)![1]!)).toBe(assets.portableEngine);
 expect(assets.core).toContain('@afbin/portable');
});

it('ships the offline sql engine only inside an export that carries rows, never in a served module or page',async()=>{
 const assets=await buildHtmlAssets();
 // The SQLite engine with its wasm inlined: an export's cost, measured, never a hosted page's.
 expect(gzipSync(assets.offlineSql!).byteLength).toBeLessThanOrEqual(OFFLINE_SQL_GZIP_BUDGET);
 for(const [name,served] of Object.entries(assets))if(name!=='offlineSql'&&typeof served==='string')expect(served,name).not.toMatch(/sqlite3|__AF_SQLITE_WASM__/);
 expect(assets.apollo).toContain('@afbin/offline-sql');
 const offlineData={tables:[{schema:'main',name:'sales',columns:[{name:'region',type:'string'}],rows:[{region:'Northwind-7'}]}]};
 const page={html:'<html><body>Sales</body></html>',...assets,config:{pageId:'p1',revision:'1',backends:['sales']},offlineData};
 const hosted=assembleHtmlPage(page);
 const block=(name:string)=>new RegExp(`<script[^>]*data-af="${name}"`);
 expect(hosted).not.toMatch(block('offline-sql'));expect(hosted).not.toContain('Northwind-7');
 const exported=downloadableHtml(page);
 expect(JSON.parse(/data-af="offline-sql">([^<]*)<\/script>/.exec(exported)![1]!)).toBe(assets.offlineSql);
 expect(JSON.parse(/data-af="offline-data">([^<]*)<\/script>/.exec(exported)![1]!)).toEqual(offlineData);
 const empty=downloadableHtml({...page,offlineData:undefined});
 expect(empty).not.toMatch(block('offline-sql'));expect(empty).not.toMatch(block('offline-data'));
});

it('installs shared offline modules in the core single import map and preserves portable source',async()=>{
 const {JSDOM}=await import('jsdom');const {packOfflineDependencies}=await import('../../offline-dependencies');const {recoverPortableSource}=await import('../portable-source');
 const source='<script type="module">import value from "./shared.js";console.log(value);</script>',library='export default {};';
 const packed=await packOfflineDependencies({html:source,baseUrl:'https://example.test/',resources:[{url:'./shared.js',contentType:'text/javascript',bytes:new TextEncoder().encode(library)}]});
 const core=await buildHtmlCore(),html=downloadableHtml({html:packed.html,core,apollo:'export {};',reader:'export {};',platformScriptNonce:'test-nonce-1234567890',portable:{version:1,source},config:{pageId:'p',revision:'1',backends:[]}});
 expect(recoverPortableSource(html)).toBe(source);const dom=new JSDOM(html,{runScripts:'outside-only',url:'https://example.test/'}),win=dom.window,blobs:string[]=[],revoked:string[]=[];
 win.URL.createObjectURL=()=>{const url='blob:module-'+blobs.length;blobs.push(url);return url;};win.URL.revokeObjectURL=url=>revoked.push(url);
 Object.defineProperty(win,'parent',{value:{}});const coreElement=win.document.querySelector('script[data-af="core"]')!;Object.defineProperty(win.document,'currentScript',{value:coreElement});win.eval(core);
 const maps=win.document.querySelectorAll('script[type="importmap"]');expect(maps).toHaveLength(1);expect(maps[0]!.getAttribute('nonce')).toBe('test-nonce-1234567890');const imports=JSON.parse(maps[0]!.textContent!).imports;
 expect(imports['@afbin/apollo']).toMatch(/^blob:/);expect(imports['@afbin/reader']).toMatch(/^blob:/);const shared=Object.entries(imports).filter(([key])=>key.startsWith('@afbin/offline/'));expect(shared).toHaveLength(1);
 win.dispatchEvent(new win.PageTransitionEvent('pagehide',{persisted:true}));expect(revoked).toEqual([]);win.dispatchEvent(new win.PageTransitionEvent('pagehide',{persisted:false}));expect(revoked).toEqual([shared[0]![1]]);dom.window.close();
});

it('links the platform stylesheet after the core and before authored styles, and tells the core the appearance (D3/D4)',async()=>{
 const assets=await buildHtmlAssets();
 expect(assets.systems).toContain(':root[data-af-design-system="redline"]');
 const hosted=assembleHtmlPage({html:'<html data-af-dark="false"><head><meta name="artifactbin:design-system" content="nocturne"><style>h1{color:red}</style></head><body></body></html>',core:assets.core,systemsHref:PLATFORM_STYLES_PATH,config:{pageId:'p',revision:'1',backends:[]}});
 const head=/<head>([\s\S]*)<\/head>/.exec(hosted)![1]!;
 expect(head.indexOf('data-af="core"')).toBeLessThan(head.indexOf('data-af="platform-styles"'));
 expect(head.indexOf(`href="${PLATFORM_STYLES_PATH}"`)).toBeLessThan(head.indexOf('<style>'));
 expect(JSON.parse(/data-af="runtime">([\s\S]*?)<\/script>/.exec(hosted)![1]!).appearance).toEqual({designSystem:'nocturne',mode:'light'});
 const owner=assembleHtmlPage({html:'<html><head><meta name="artifactbin:design-system" content="redline"></head><body></body></html>',core:assets.core,systemsHref:PLATFORM_STYLES_PATH,designSystem:'phosphor',config:{pageId:'p',revision:'1',backends:[]}});
 expect(JSON.parse(/data-af="runtime">([\s\S]*?)<\/script>/.exec(owner)![1]!).appearance).toEqual({designSystem:'phosphor',mode:'dark'});
 expect(assembleHtmlPage({html:'<html><head></head><body></body></html>',core:assets.core,systemsHref:PLATFORM_STYLES_PATH,config:{pageId:'p',revision:'1',backends:[]}})).not.toContain('platform-styles');
 expect(downloadableHtml({html:'<html><body></body></html>',core:assets.core,apollo:assets.apollo,reader:assets.reader,systemsHref:PLATFORM_STYLES_PATH,config:{pageId:'p',revision:'1',backends:[]}})).not.toContain('platform-styles');
});

it('the core sets the platform attributes before authored code, with the viewer mode from ?mx-mode= winning',async()=>{
 const {core}=await buildHtmlAssets();
 const {JSDOM}=await import('jsdom');
 const run=(url:string,appearance:unknown)=>{
  const dom=new JSDOM(`<html data-af-design-system="old"><head><script type="application/json" data-af="runtime">${JSON.stringify({pageId:'p',revision:'1',backends:[],offline:true,appearance})}</script></head><body></body></html>`,{url,runScripts:'outside-only'});
  try{dom.window.eval(core);}catch{/* later portable checks need a reader block; the attributes are set first */}
  return dom.window.document.documentElement;
 };
 const root=run('https://p.example/',{designSystem:'nocturne',mode:'dark'});
 expect(root.getAttribute('data-af-design-system')).toBe('nocturne');expect(root.getAttribute('data-af-dark')).toBe('true');
 const viewer=run('https://p.example/?mx-mode=light',{designSystem:'nocturne',mode:'dark'});
 expect(viewer.getAttribute('data-af-dark')).toBe('false');expect(viewer.style.colorScheme).toBe('light');
});

it('ships the region editor only as its own lazily loaded module, at most 100 KiB gzipped, without the server\'s parsers',async()=>{
 const assets=await buildHtmlAssets();
 expect(assets.regionsPath).toBe('/af/regions.js');
 const regions=assets.regions!;
 // Production conditions, minified, gzipped as served: the budget the brief sets (100 KiB = 102,400 bytes).
 expect(gzipSync(regions).byteLength).toBeLessThanOrEqual(100*1024);
 expect(regions).not.toContain('ProseMirror');
 // Readers never carry editor bytes: neither the core nor the reader module holds ProseMirror or Yjs.
 for(const source of [assets.core,assets.reader,assets.morph!])expect(source).not.toContain('ProseMirror');
 expect(assets.reader).toContain('@afbin/native-regions');
 // Only framed live pages map the module (it is loaded after a region session only).
 expect(assets.core).toMatch(/"@afbin\/regions":new URL\("\/af\/regions\.js"/);
 const {build}=await import('esbuild');
 const graph=await build({entryPoints:[fileURLToPath(new URL('../native-region-editor.ts',import.meta.url))],bundle:true,write:false,minify:true,format:'esm',platform:'browser',conditions:['production'],metafile:true,logLevel:'silent'});
 const inputs=Object.keys(graph.metafile.inputs);
 expect(inputs.some(input=>input.includes('prosemirror-view'))).toBe(true);
 expect(inputs.filter(input=>/parse5|prosemirror-markdown|markdown-it|lib\/html-page\/|live-regions\/(?:compaction|source-html|state)\.ts/.test(input))).toEqual([]);
});

it('ships one native editor without the retired rich editor or binding',async()=>{
 const assets=await buildHtmlAssets();
 expect(assets.regions?.includes('export {mountRegionEditor} from "@afbin/native-regions"')).toBe(true);
 const {build}=await import('esbuild');
 const graph=await build({entryPoints:[fileURLToPath(new URL('../native-region-editor.ts',import.meta.url))],bundle:true,write:false,format:'esm',platform:'browser',metafile:true,logLevel:'silent'});
 expect(Object.keys(graph.metafile.inputs).filter(input=>/live-regions\/(?:editor|binding|browser)\.ts$/.test(input))).toEqual([]);
});

it('ships @afbin/collab as its own small module over the page reader: Yjs, no ProseMirror, mapped for every hosted page',async()=>{
 const assets=await buildHtmlAssets();
 expect(assets.collabPath).toBe('/af/collab.js');
 const collab=assets.collab!;
 // Small: Yjs and the binding, gzipped as served.
 expect(gzipSync(collab).byteLength).toBeLessThanOrEqual(40*1024);
 expect(collab).not.toContain('ProseMirror');
 // The frame's cell port is the reader's own (one bridge), imported, never bundled twice.
 expect(collab).toMatch(/from\s*"@afbin\/reader"/);
 expect(assets.reader).not.toMatch(/yjs|Y\.Doc/);
 // Mapped for every hosted page (not only framed live ones), so an author's import always resolves; a page the app
 // does not frame answers readonly. Offline, only from the copy's own embedded block (no network).
 expect(assets.core).toMatch(/new URL\("\/af\/collab\.js"/);
 expect(assets.core).toContain('[data-af="collab"]');
 expect(assets.core).toMatch(/"@afbin\/collab":\w+/);
});

it('ships @afbin/state as its own small module that @afbin/apollo imports: Zustand over the one viewer document, no graphql, never in the reader',async()=>{
 const assets=await buildHtmlAssets();
 expect(assets.statePath).toBe('/af/state.js');
 const state=assets.state!;
 expect(gzipSync(state).byteLength).toBeLessThanOrEqual(8*1024);
 expect(state).not.toMatch(/GraphQL|Syntax Error:/);
 expect(state).toMatch(/from\s*"@afbin\/reader"/);
 // One document per page: apollo takes its StatePort from @afbin/state, never a second copy of the viewer state, and
 // imports it dynamically so an older core's import map (no @afbin/state) still links apollo and reaches its skew guard.
 expect(assets.apollo).toMatch(/import\(\s*"@afbin\/state"\s*\)/);
 expect(assets.apollo).not.toMatch(/from\s*"@afbin\/state"/);
 expect(assets.apollo).not.toContain('af:viewer:');
 expect(state).toContain('af:viewer:');
 expect(assets.reader).not.toContain('af:viewer:');
 expect(assets.reader).not.toContain('zustand');
 // Mapped for every page; offline, only from the copy's own embedded block.
 expect(assets.core).toMatch(/new URL\("\/af\/state\.js"/);
 expect(assets.core).toContain('[data-af="state-module"]');
 expect(assets.core).toMatch(/"@afbin\/state":\w+/);
});

it('review: a pre-deploy import map can reach the skew guard and reload on a late apollo import', async () => {
 const { spawnSync } = await import('node:child_process');
 const assets = await buildHtmlAssets();
 const result = spawnSync(process.execPath, ['--experimental-vm-modules', '--input-type=module', '-e', `
  import { SourceTextModule, SyntheticModule } from 'node:vm';
  let reloaded = false;
  globalThis[Symbol.for('afbin.runtime-build')] = 'pre-deploy-build';
  globalThis.sessionStorage = { getItem: () => null, setItem() {} };
  globalThis.location = { reload() { reloaded = true; } };
  const reader = new SyntheticModule(['config','remote','onResolverChange','startFrameBridge','remoteReadOnly','uploadFile','watchUploadContext','bindFileUpload'], function() {});
  try {
   const apollo = new SourceTextModule(${JSON.stringify(assets.apollo)});
   await apollo.link(specifier => {
    // The old core maps reader and apollo, but does not map @afbin/state.
    if (specifier === '@afbin/reader') return reader;
    throw Error('Unmapped bare specifier: ' + specifier);
   });
   await apollo.evaluate();
  } catch (error) { console.log(error.message); }
  console.log('reloaded=' + reloaded);
 `], { encoding: 'utf8' });
 expect(result.status).toBe(0);
 expect(result.stdout).toContain('reloaded=true');
});

it('loads the native trial in a separate module without server HTML parsers',async()=>{
 const assets=await buildHtmlAssets();
 expect(assets.nativeRegionsPath).toBe('/af/native-regions.js');
 expect(assets.nativeRegions).toContain('ProseMirror');
 // Opt-in Tiptap + CommonMark chunk; legacy reader/editor budgets remain unchanged.
 expect(gzipSync(assets.nativeRegions!).byteLength).toBeLessThanOrEqual(200*1024);
 expect(gzipSync(assets.nativeMarkdown!).byteLength).toBeLessThanOrEqual(100*1024);
 expect(assets.nativeMarkdownPath).toBe('/af/native-markdown.js');
 expect(assets.reader).toContain('@afbin/native-regions');
 const {build}=await import('esbuild');
 const graph=await build({entryPoints:[fileURLToPath(new URL('../native-region-editor.ts',import.meta.url))],bundle:true,write:false,minify:true,format:'esm',platform:'browser',conditions:['production'],metafile:true,logLevel:'silent'});
 expect(Object.keys(graph.metafile.inputs).filter(input=>/parse5|lib\/html-page\/|live-regions\/(?:compaction|native-state|native-html)\.ts/.test(input))).toEqual([]);
});

it('ships the document host module (/af/host.js) as its own small module: no app framework, no page runtime, no credential',async()=>{
 const assets=await buildHtmlAssets();
 const host=assets.host!;
 // The parent half of the bridge and its relays, gzipped as served (8,012 B measured 2026-11-11).
 expect(gzipSync(host).byteLength).toBeLessThanOrEqual(10*1024);
 expect(host).toMatch(/export\s*\{[^}]*mountDocument/);
 expect(host).not.toMatch(/solid-js|@afbin\//);
 // Loaded by another shell, never by a page: not in the core's import map, and no skew guard tied to a core.
 expect(assets.core).not.toContain('/af/host.js');
 expect(host).not.toContain('afbin:runtime-reload');
});
