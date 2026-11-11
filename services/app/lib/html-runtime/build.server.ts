import {buildPortableChrome} from './build-portable-chrome.server';
import {build,type PluginBuild,type Plugin} from 'esbuild';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import type {HtmlRuntimeAssets} from './contract';
import {htmlSystemsCss} from '../html-systems';
import {RUNTIME_BUILD_KEY,RUNTIME_MODULE_PATHS} from './contract';
/**
 * Prepended to every lazily loaded runtime module. Core (inline in the page, or /af/core.js) records its build id
 * before any module runs; a module from another build reloads the page once (fresh HTML brings the matching core) and
 * refuses to run. Pages without a hosted core (offline copies embed their own modules) never set the id.
 */
const skewGuard=(id:string)=>`{const c=globalThis[Symbol.for(${JSON.stringify(RUNTIME_BUILD_KEY)})];if(c&&c!==${JSON.stringify(id)}){let r=!1;try{const n="afbin:runtime-reload";if(sessionStorage.getItem(n)!==${JSON.stringify(id)}){sessionStorage.setItem(n,${JSON.stringify(id)});r=!0}}catch{}if(r)location.reload();throw Error("Artifactbin runtime updated; reload the page")}}\n`;
let assets:Promise<HtmlRuntimeAssets>|undefined;
/** Build immutable code once. Page configuration is supplied only by assembly. */
export function buildHtmlAssets():Promise<HtmlRuntimeAssets>{return assets??=compile().catch(error=>{assets=undefined;throw error;});}
export async function buildHtmlCore():Promise<string>{return (await buildHtmlAssets()).core;}
async function compile():Promise<HtmlRuntimeAssets>{
 const options={bundle:true,minify:true,write:false,platform:'browser' as const,target:'es2022'};
 const reader=await build({...options,entryPoints:[fileURLToPath(new URL('./browser-reader.ts',import.meta.url))],format:'esm',external:['@afbin/chrome','@afbin/portable','@afbin/morph','@afbin/regions'],banner:{js:`const __AF_RUNTIME_CONFIG__=(()=>{const supplied=document.querySelector('[data-af="runtime"]');return supplied?JSON.parse(supplied.textContent):{pageId:'local:'+location.pathname,revision:'local',backends:[],offline:true};})();`}});
 // `@afbin/state` owns the page's one local-state document; `@afbin/apollo` imports it rather than carrying a second copy.
 const sharedState={name:'shared-state',setup(builder:PluginBuild){builder.onResolve({filter:/^\.\/browser-state$/},()=>({path:'@afbin/state',external:true}));}};
 const sharedReader={name:'shared-reader',setup(builder:PluginBuild){builder.onResolve({filter:/^\.\/browser-reader$/},()=>({path:'@afbin/reader',external:true}));}};
 const author=await build({...options,entryPoints:[fileURLToPath(new URL('./browser-client.ts',import.meta.url))],format:'esm',plugins:[sharedReader,sharedState]});
 // Zustand and the viewer's document (./browser-state): loaded only when a page imports `@afbin/state` or `@afbin/apollo`.
 const stateBuild=await build({...options,entryPoints:[fileURLToPath(new URL('./browser-state.ts',import.meta.url))],format:'esm',plugins:[sharedReader]});
 const readerSource=reader.outputFiles?.[0]?.text,apollo=author.outputFiles?.[0]?.text;
 if(!readerSource||!apollo)throw Error('HTML runtime build produced no module');
 const portableBuild=await build({...options,entryPoints:[fileURLToPath(new URL('./portable-session.ts',import.meta.url))],format:'esm',external:['@afbin/chrome']});
 // The live morph (./live-morph) loads only when a new version reaches an open framed page.
 const morphBuild=await build({...options,entryPoints:[fileURLToPath(new URL('./live-morph.ts',import.meta.url))],format:'esm'});
 // The native region editor (./native-region-editor: Tiptap and Yjs) loads only when the parent opens a region session for an editor.
 const regionPlugins:Plugin[]=[{
  name:'pure-lib0-dom-schemas',
  setup(builder){builder.onLoad({filter:/[/\\]lib0[/\\]dom\.js$/},async({path})=>({
   // lib0 0.2.119's four unused DOM schemas otherwise retain its entire schema library via Yjs logging.
   // $custom only allocates a schema (its constructor stores the predicate); annotate those allocations,
   // preserving any schema that is actually used and all logging/editor behavior. No dependency source is changed.
   contents:(await readFile(path,'utf8')).replaceAll('= $.$custom(', '= /* @__PURE__ */ $.$custom('),loader:'js',
  }));},
 }];
 // Keep the public name for existing import maps without shipping the retired engine.
 const regionsSource='export {mountRegionEditor} from "@afbin/native-regions";';
 // Live dataset text cells (./collab: Yjs, no ProseMirror) load only when a page imports `@afbin/collab`; the frame's cell port is the reader's.
 const nativeMarkdownBuild=await build({...options,entryPoints:[fileURLToPath(new URL('./native-region-markdown.ts',import.meta.url))],format:'esm'});
 const nativeRegionsBuild=await build({...options,entryPoints:[fileURLToPath(new URL('./native-region-editor.ts',import.meta.url))],format:'esm',conditions:['production'],define:{'process.env.NODE_ENV':'"production"'},plugins:regionPlugins});
 const collabBuild=await build({...options,entryPoints:[fileURLToPath(new URL('./collab.ts',import.meta.url))],format:'esm',plugins:[sharedReader]});
 // An export's `sql` engine (./offline-sql): embedded only in a downloaded copy that carries its reader's rows, never served.
 // Its wasm is the SQL service's own (resolved where services/sql declares it), inlined: a copy fetches nothing.
 const sqliteWasm=await readFile(createRequire(fileURLToPath(new URL('../../../sql/package.json',import.meta.url))).resolve('@sqlite.org/sqlite-wasm/sqlite3.wasm'));
 const offlineSqlBuild=await build({...options,entryPoints:[fileURLToPath(new URL('./offline-sql.ts',import.meta.url))],format:'esm',define:{__AF_SQLITE_WASM__:JSON.stringify(sqliteWasm.toString('base64'))}});
 // The document host module (lib/html-reader/host-shell, /af/host.js): loaded by another shell on the app's origin, never by
 // a page, so it has no import-map entry and no skew guard (no core runs beside it); the manifest pins it by digest.
 const hostBuild=await build({...options,entryPoints:[fileURLToPath(new URL('../html-reader/host-shell.ts',import.meta.url))],format:'esm'});
 const chrome=await buildPortableChrome();
 // D17: flat platform addresses, revalidated by ETag (no version or hash). A page open across a deploy can load a newer
 // lazy module against its older core, so every lazy module carries this build's id and refuses another core's (skewGuard).
 const unguarded={apollo,reader:readerSource,chrome,portableEngine:portableBuild.outputFiles![0]!.text,morph:morphBuild.outputFiles![0]!.text,regions:regionsSource,nativeRegions:nativeRegionsBuild.outputFiles![0]!.text,nativeMarkdown:nativeMarkdownBuild.outputFiles![0]!.text,collab:collabBuild.outputFiles![0]!.text,state:stateBuild.outputFiles![0]!.text,offlineSql:offlineSqlBuild.outputFiles![0]!.text};
 const buildId=createHash('sha256').update(JSON.stringify(unguarded)).digest('hex').slice(0,16);
 const guarded=Object.fromEntries(Object.entries(unguarded).map(([key,source])=>[key,skewGuard(buildId)+source])) as typeof unguarded;
 const {apolloPath,readerPath,chromePath,portableEnginePath,morphPath,regionsPath,nativeRegionsPath,nativeMarkdownPath,collabPath,statePath}=RUNTIME_MODULE_PATHS;
 const entry=`import {installHtmlReaderCommands} from ${JSON.stringify(fileURLToPath(new URL('../html-bridge/reader.ts',import.meta.url)))};
import {openFrameDoor} from ${JSON.stringify(fileURLToPath(new URL('./frame-door.ts',import.meta.url)))};
import {installFunctionFetch} from ${JSON.stringify(fileURLToPath(new URL('./fn-fetch.ts',import.meta.url)))};
import {startNativeHtmlTableScroll} from ${JSON.stringify(fileURLToPath(new URL('./table-scroll.ts',import.meta.url)))};
import {restoreReadingPlace} from ${JSON.stringify(fileURLToPath(new URL('./reading-place.ts',import.meta.url)))};
import {noticeBlockedModals} from ${JSON.stringify(fileURLToPath(new URL('./modal-notice.ts',import.meta.url)))};
globalThis[Symbol.for(${JSON.stringify(RUNTIME_BUILD_KEY)})]=${JSON.stringify(buildId)};
const platformNonce=document.currentScript?.nonce;
const supplied=document.querySelector('[data-af="runtime"]');
const config=supplied?JSON.parse(supplied.textContent):{pageId:'local:'+location.pathname,revision:'local',backends:[],offline:true};
// D4: the platform owns <html data-af-design-system / data-af-dark>; set both before first paint. The viewer's choice
// arrives as ?mx-mode= (the reader adds it to the frame URL) and later as reader messages; page code only reads them.
const look=config.appearance;if(look&&typeof look==='object'){const root=document.documentElement;if(typeof look.designSystem==='string'&&/^[a-z][a-z0-9-]{0,63}$/.test(look.designSystem))root.setAttribute('data-af-design-system',look.designSystem);let mode=look.mode==='dark'?'dark':'light';try{const asked=new URLSearchParams(location.search).get('mx-mode');if(asked==='dark'||asked==='light')mode=asked;}catch{}root.setAttribute('data-af-dark',mode==='dark'?'true':'false');root.style.colorScheme=mode;}
startNativeHtmlTableScroll(document);
noticeBlockedModals(window);
const blob=source=>URL.createObjectURL(new Blob([source],{type:'text/javascript'}));
const portableReader=document.querySelector('[data-af="reader"]');
if(supplied&&config.offline&&!document.documentElement.hasAttribute('data-af-private-preview')&&!portableReader)throw Error('Portable HTML is missing its reader module');
const reader=portableReader?blob(JSON.parse(portableReader.textContent)):new URL(${JSON.stringify(readerPath)},document.currentScript.src||location.href).href;
const portable=document.querySelector('[data-af="apollo"]');
if(supplied&&config.offline&&!document.documentElement.hasAttribute('data-af-private-preview')&&!portable)throw Error('Portable HTML is missing its author module');
const apollo=portable?blob(JSON.parse(portable.textContent)):new URL(${JSON.stringify(apolloPath)},document.currentScript.src||location.href).href;
const stateBlock=document.querySelector('[data-af="state-module"]');
const state=stateBlock?blob(JSON.parse(stateBlock.textContent)):new URL(${JSON.stringify(statePath)},document.currentScript.src||location.href).href;
const engineBlock=document.querySelector('[data-af="portable-engine"]');
const portableEngine=engineBlock?blob(JSON.parse(engineBlock.textContent)):new URL(${JSON.stringify(portableEnginePath)},document.currentScript.src||location.href).href;
const chromeBlock=document.querySelector('[data-af="chrome"]');
const chrome=chromeBlock?blob(JSON.parse(chromeBlock.textContent)):new URL(${JSON.stringify(chromePath)},document.currentScript.src||location.href).href;
const live=config.appOrigin&&!config.offline&&window.parent!==window;
const sqlBlock=config.offline?document.querySelector('[data-af="offline-sql"]'):null;
const collabBlock=document.querySelector('[data-af="collab"]');
const collab=collabBlock?blob(JSON.parse(collabBlock.textContent)):config.offline?null:new URL(${JSON.stringify(collabPath)},document.currentScript.src||location.href).href;
// The source this document loaded, before its deferred and module scripts run: what a new version is compared against (./live-morph LOADED_SOURCE).
// A framed page rebuilt from a new version (./live-morph rebuild) puts the reader back where the previous document left them.
if(live)restoreReadingPlace(window,config.pageId);
if(live){const keep=()=>{if(document.readyState==='loading')return;document.removeEventListener('readystatechange',keep);window[Symbol.for('afbin.loaded-source')]='<!doctype html>'+document.documentElement.outerHTML;};document.addEventListener('readystatechange',keep);}
if(!config.publishOrigin&&document.currentScript.src)config.publishOrigin=new URL(document.currentScript.src,location.href).origin;
const sharedBlock=config.offline?document.querySelector('[data-af="offline-modules"]'):null;
const sharedImports={};if(sharedBlock)for(const [key,source]of Object.entries(JSON.parse(sharedBlock.textContent))){if(!(key.startsWith('@afbin/offline/')&&/^[a-f0-9]{64}$/.test(key.slice(15)))||typeof source!=='string')throw Error('Invalid embedded module table');sharedImports[key]=blob(source);}
if(Object.keys(sharedImports).length)addEventListener('pagehide',event=>{if(!event.persisted)for(const url of Object.values(sharedImports))URL.revokeObjectURL(url);});
const libraries={};if(!portable)for(const [key,value]of Object.entries(config.libraries??{}))if(/^@afbin\\/[a-z][a-z0-9-]*$/.test(key)&&/^\\/af\\/(?:lib\\/[a-z][a-z0-9-]*-\\d+\\.\\d+\\.\\d+\\/index|components\\/[a-z][a-z0-9-]*)\\.js$/.test(value))libraries[key]=new URL(value,document.currentScript.src||location.href).href;
const map=document.createElement('script');if(platformNonce)map.nonce=platformNonce;map.type='importmap';map.textContent=JSON.stringify({imports:{...libraries,...sharedImports,'@afbin/apollo':apollo,'@afbin/state':state,'@afbin/reader':reader,'@afbin/chrome':chrome,'@afbin/portable':portableEngine,...(collab?{'@afbin/collab':collab}:{}),...(sqlBlock?{'@afbin/offline-sql':blob(JSON.parse(sqlBlock.textContent))}:{}),...(live?{'@afbin/morph':new URL(${JSON.stringify(morphPath)},document.currentScript.src||location.href).href,'@afbin/native-markdown':new URL(${JSON.stringify(nativeMarkdownPath)},document.currentScript.src||location.href).href,'@afbin/native-regions':new URL(${JSON.stringify(nativeRegionsPath)},document.currentScript.src||location.href).href,'@afbin/regions':new URL(${JSON.stringify(regionsPath)},document.currentScript.src||location.href).href}:{})}});document.currentScript.after(map);
// fetch('/fn/<name>') calls the page's backend function through the reader (./fn-fetch), a fetch of a file the page
// published reads it wherever the page is (config.files), and a GET to a host it declares goes through its fetch door
// (config.connect), before any author script runs.
installFunctionFetch(window,()=>import(reader),config.files,!config.offline&&Array.isArray(config.connect)&&config.connect.length?{pageId:config.pageId,origins:config.connect}:undefined);
if(config.offline&&window.parent===window){void import(reader).then(module=>module.startPortableDocument(window,config.publishOrigin)).catch(()=>document.documentElement.setAttribute('data-af-connection','unavailable'));}
if(live){installHtmlReaderCommands(window,config.appOrigin);openFrameDoor(window,config.appOrigin,()=>import(reader));}`;
 const core=await build({...options,stdin:{contents:entry,resolveDir:process.cwd(),loader:'ts'},format:'iife'});
 if(!core.outputFiles?.[0]?.text)throw Error('HTML core is empty');
 return {core:core.outputFiles[0].text,systems:htmlSystemsCss(),apollo:guarded.apollo,apolloPath,reader:guarded.reader,readerPath,chrome:guarded.chrome,chromePath,portableEngine:guarded.portableEngine,portableEnginePath,morph:guarded.morph,morphPath,regions:guarded.regions,regionsPath,nativeRegions:guarded.nativeRegions,nativeRegionsPath,nativeMarkdown:guarded.nativeMarkdown,nativeMarkdownPath,collab:guarded.collab,collabPath,state:guarded.state,statePath,offlineSql:guarded.offlineSql,host:hostBuild.outputFiles![0]!.text};
}
