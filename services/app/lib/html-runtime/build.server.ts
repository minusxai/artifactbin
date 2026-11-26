import {buildHostComments,buildPortableChrome} from './build-portable-chrome.server';
import {slimEntities} from './slim-entities.server';
import {suppliedOrCompiled} from './assets-supply.server';
import {hostModulePath} from './host-comments-address.server';
import {build,type PluginBuild,type Plugin} from 'esbuild';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import type {HtmlRuntimeAssets} from './contract';
import {HTML_SYSTEM_NAMES,htmlSystemsCss} from '../html-systems';
import {DRAFT_SQL_ENGINE_PATH,RUNTIME_BUILD_KEY,RUNTIME_MODULE_PATHS} from './contract';
/**
 * Prepended to every lazily loaded runtime module. Core (inline in the page, or /af/core.js) records its build id
 * before any module runs; a module from another build reloads the page once (fresh HTML brings the matching core) and
 * refuses to run. Pages without a hosted core (offline copies embed their own modules) never set the id.
 */
const skewGuard=(id:string)=>`{const c=globalThis[Symbol.for(${JSON.stringify(RUNTIME_BUILD_KEY)})];if(c&&c!==${JSON.stringify(id)}){let r=!1;try{const n="afbin:runtime-reload";if(sessionStorage.getItem(n)!==${JSON.stringify(id)}){sessionStorage.setItem(n,${JSON.stringify(id)});r=!0}}catch{}if(r)location.reload();throw Error("Artifactbin runtime updated; reload the page")}}\n`;
let assets:Promise<HtmlRuntimeAssets>|undefined;
/** Build immutable code once, or read the build a composition supplies (./assets-supply.server). Page configuration is supplied only by assembly. */
export function buildHtmlAssets():Promise<HtmlRuntimeAssets>{return assets??=suppliedOrCompiled(compile).catch(error=>{assets=undefined;throw error;});}
export async function buildHtmlCore():Promise<string>{return (await buildHtmlAssets()).core;}
const options={bundle:true,minify:true,write:false,platform:'browser' as const,target:'es2022'};
/** One bundle's minified source; an empty build is an error (`empty` says which). */
const bundled=async(extra:Parameters<typeof build>[0],empty='HTML runtime build produced no module')=>{
 const text=(await build({...options,...extra})).outputFiles?.[0]?.text;
 if(!text)throw Error(empty);
 return text;
};
/** One runtime module: `file` bundled as an ES module. */
const esm=(file:URL,extra:Parameters<typeof build>[0]={})=>bundled({entryPoints:[fileURLToPath(file)],format:'esm',...extra});
/** Resolve the bare `filter` import as the external `path`: a module the page's import map supplies. */
const external=(name:string,filter:RegExp,path:string):Plugin=>({name,setup(builder:PluginBuild){builder.onResolve({filter},()=>({path,external:true}));}});
async function compile():Promise<HtmlRuntimeAssets>{
 const readerSource=await esm(new URL('./browser-reader.ts',import.meta.url),{external:['@afbin/chrome','@afbin/portable','@afbin/morph'],banner:{js:`const __AF_RUNTIME_CONFIG__=(()=>{const supplied=document.querySelector('[data-af="runtime"]');return supplied?JSON.parse(supplied.textContent):{pageId:'local:'+location.pathname,revision:'local',backends:[],offline:true};})();`}});
 // `@afbin/state` owns the page's one local-state document; `@afbin/apollo` imports it rather than carrying a second copy.
 const sharedState=external('shared-state',/^\.\/browser-state$/,'@afbin/state');
 const sharedReader=external('shared-reader',/^\.\/browser-reader$/,'@afbin/reader');
 const apollo=await esm(new URL('./browser-client.ts',import.meta.url),{plugins:[sharedReader,sharedState]});
 // Zustand and the viewer's document (./browser-state): loaded only when a page imports `@afbin/state` or `@afbin/apollo`.
 const state=await esm(new URL('./browser-state.ts',import.meta.url),{plugins:[sharedReader]});
 const portableEngine=await esm(new URL('./portable-session.ts',import.meta.url),{external:['@afbin/chrome']});
 // The live morph (./live-morph) loads only when a new version reaches an open framed page.
 const morph=await esm(new URL('./live-morph.ts',import.meta.url));
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
 // Live dataset text cells (./collab: Yjs, no ProseMirror) load only when a page imports `@afbin/collab`; the frame's cell port is the reader's.
 // The paste parser (lib/markdown's display parse, fitted to the document schema), with lib/markdown's slim entity decoder.
 const nativeMarkdown=await esm(new URL('./native-region-markdown.ts',import.meta.url),{plugins:[slimEntities]});
 const nativeRegions=await esm(new URL('./native-region-editor.ts',import.meta.url),{conditions:['production'],define:{'process.env.NODE_ENV':'"production"'},plugins:regionPlugins});
 const collab=await esm(new URL('./collab.ts',import.meta.url),{plugins:[sharedReader]});
 // The `sql` engine (./offline-sql): embedded in a downloaded copy that carries its reader's rows, and served once at
 // /af/offline-sql.js for drafts (lib/page-drafts), which share it instead of carrying ~600 KB each. Never a published page's.
 // Its wasm is the SQL service's own (resolved where services/sql declares it), inlined: a copy fetches nothing.
 const sqliteWasm=await readFile(createRequire(fileURLToPath(new URL('../../../sql/package.json',import.meta.url))).resolve('@sqlite.org/sqlite-wasm/sqlite3.wasm'));
 const offlineSql=await esm(new URL('./offline-sql.ts',import.meta.url),{define:{__AF_SQLITE_WASM__:JSON.stringify(sqliteWasm.toString('base64'))}});
 // The document host module (lib/html-reader/host-shell, /af/host.js): loaded by another shell on the app's origin, never by
 // a page, so it has no import-map entry and no skew guard (no core runs beside it); the manifest pins it by digest.
 // Its discussion (the host comments module, ./build-portable-chrome) is a module of its own the host module imports only
 // when a shell asks for comments; the host module names that build's pinned address (/af/v1/host/<sha256>.js, kept by
 // the same retention), so a pinned host module always loads the comments it was built with. The comments import their
 // code highlighter (lib/markdown/code-block, the host code module) by its pinned address the same way.
 const hostCode=await esm(new URL('../markdown/code-block.ts',import.meta.url));
 const hostComments=await buildHostComments(hostModulePath(hostCode));
 const host=await esm(new URL('../html-reader/host-shell.ts',import.meta.url),{define:{__AF_HOST_COMMENTS__:JSON.stringify(hostModulePath(hostComments))}});
 const chrome=await buildPortableChrome();
 // D17: a served page names each module at this build's content address (config.modules), others at the flat address
 // revalidated by ETag. A page open across a deploy can load a newer lazy module against its older core (an old content
 // address redirects to the flat one), so every lazy module carries this build's id and refuses another core's (skewGuard).
 const unguarded={apollo,reader:readerSource,chrome,portableEngine,morph,nativeRegions,nativeMarkdown,collab,state,offlineSql};
 const buildId=createHash('sha256').update(JSON.stringify(unguarded)).digest('hex').slice(0,16);
 const guarded=Object.fromEntries(Object.entries(unguarded).map(([key,source])=>[key,skewGuard(buildId)+source])) as typeof unguarded;
 const {apolloPath,readerPath,chromePath,portableEnginePath,morphPath,nativeRegionsPath,nativeMarkdownPath,collabPath,statePath}=RUNTIME_MODULE_PATHS;
 const entry=`import {installHtmlReaderCommands} from ${JSON.stringify(fileURLToPath(new URL('./bridge/reader.ts',import.meta.url)))};
import {openFrameDoor} from ${JSON.stringify(fileURLToPath(new URL('./frame-door.ts',import.meta.url)))};
import {installPageFetch} from ${JSON.stringify(fileURLToPath(new URL('./page-fetch.ts',import.meta.url)))};
import {startNativeHtmlTableScroll} from ${JSON.stringify(fileURLToPath(new URL('./table-scroll.ts',import.meta.url)))};
import {restoreReadingPlace} from ${JSON.stringify(fileURLToPath(new URL('./reading-place.ts',import.meta.url)))};
import {noticeBlockedModals} from ${JSON.stringify(fileURLToPath(new URL('./modal-notice.ts',import.meta.url)))};
globalThis[Symbol.for(${JSON.stringify(RUNTIME_BUILD_KEY)})]=${JSON.stringify(buildId)};
const platformNonce=document.currentScript?.nonce;
const supplied=document.querySelector('[data-af="runtime"]');
const config=supplied?JSON.parse(supplied.textContent):{pageId:'local:'+location.pathname,revision:'local',backends:[],offline:true};
// D4: the platform owns <html data-af-design-system / data-af-dark>; set both before first paint. The viewer's choice
// arrives as ?mx-mode= (the reader adds it to the frame URL) and later as reader messages; page code only reads them.
const look=config.appearance;if(look&&typeof look==='object'){const root=document.documentElement;if(typeof look.designSystem==='string'&&/^[a-z][a-z0-9-]{0,63}$/.test(look.designSystem))root.setAttribute('data-af-design-system',look.designSystem);let mode=look.mode==='dark'?'dark':'light';try{const asked=new URLSearchParams(location.search).get('mx-mode');if(asked==='dark'||asked==='light')mode=asked;}catch{}if(look.lightOnly===true)mode='light';root.setAttribute('data-af-dark',mode==='dark'?'true':'false');root.style.colorScheme=mode;
// A light-only system (the server's installation system without dark values) stays light whoever sets data-af-dark later.
if(look.lightOnly===true)new MutationObserver(()=>{if(root.getAttribute('data-af-design-system')===look.designSystem&&root.getAttribute('data-af-dark')!=='false'){root.setAttribute('data-af-dark','false');root.style.colorScheme='light';}}).observe(root,{attributes:true,attributeFilter:['data-af-dark','data-af-design-system']});}
startNativeHtmlTableScroll(document);
noticeBlockedModals(window);
const blob=source=>URL.createObjectURL(new Blob([source],{type:'text/javascript'}));
const base=document.currentScript.src||location.href;
// A module a portable copy embeds (as a blob URL), else the platform's; a copy must embed reader and author.
const moduleUrl=(block,url)=>block?blob(JSON.parse(block.textContent)):url.href;
// A served page names this build's content address of each module (config.modules); anything else is the flat address.
const pinned=config.modules&&typeof config.modules==='object'?config.modules:{};
const at=(key,flat)=>{const value=pinned[key];return new URL(typeof value==='string'&&/^\\/af\\/v1\\/runtime\\/[a-f0-9]{64}\\/[a-z][a-z-]*\\.js$/.test(value)?value:flat,base);};
const required=(block,what,url)=>{if(supplied&&config.offline&&!document.documentElement.hasAttribute('data-af-private-preview')&&!block)throw Error('Portable HTML is missing its '+what+' module');return moduleUrl(block,url);};
const reader=required(document.querySelector('[data-af="reader"]'),'reader',at('reader',${JSON.stringify(readerPath)}));
const portable=document.querySelector('[data-af="apollo"]');
const apollo=required(portable,'author',at('apollo',${JSON.stringify(apolloPath)}));
const state=moduleUrl(document.querySelector('[data-af="state-module"]'),at('state',${JSON.stringify(statePath)}));
const portableEngine=moduleUrl(document.querySelector('[data-af="portable-engine"]'),at('portableEngine',${JSON.stringify(portableEnginePath)}));
const chrome=moduleUrl(document.querySelector('[data-af="chrome"]'),at('chrome',${JSON.stringify(chromePath)}));
const live=config.appOrigin&&!config.offline&&window.parent!==window;
const sqlBlock=config.offline?document.querySelector('[data-af="offline-sql"]'):null;
const collabBlock=document.querySelector('[data-af="collab"]');
const collab=collabBlock||!config.offline?moduleUrl(collabBlock,at('collab',${JSON.stringify(collabPath)})):null;
// The source this document loaded, before its deferred and module scripts run: what a new version is compared against (./live-morph LOADED_SOURCE).
// A framed page rebuilt from a new version (./live-morph rebuild) puts the reader back where the previous document left them.
if(live)restoreReadingPlace(window,config.pageId);
if(live){const keep=()=>{if(document.readyState==='loading')return;document.removeEventListener('readystatechange',keep);window[Symbol.for('afbin.loaded-source')]='<!doctype html>'+document.documentElement.outerHTML;};document.addEventListener('readystatechange',keep);}
if(!config.publishOrigin&&document.currentScript.src)config.publishOrigin=new URL(document.currentScript.src,location.href).origin;
const sharedBlock=config.offline?document.querySelector('[data-af="offline-modules"]'):null;
const sharedImports={};if(sharedBlock)for(const [key,source]of Object.entries(JSON.parse(sharedBlock.textContent))){if(!(key.startsWith('@afbin/offline/')&&/^[a-f0-9]{64}$/.test(key.slice(15)))||typeof source!=='string')throw Error('Invalid embedded module table');sharedImports[key]=blob(source);}
if(Object.keys(sharedImports).length)addEventListener('pagehide',event=>{if(!event.persisted)for(const url of Object.values(sharedImports))URL.revokeObjectURL(url);});
const libraries={};if(!portable)for(const [key,value]of Object.entries(config.libraries??{}))if(/^@afbin\\/[a-z][a-z0-9-]*$/.test(key)&&/^\\/af\\/(?:lib\\/[a-z][a-z0-9-]*-\\d+\\.\\d+\\.\\d+\\/index|components\\/[a-z][a-z0-9-]*)\\.js$/.test(value))libraries[key]=new URL(value,base).href;
const map=document.createElement('script');if(platformNonce)map.nonce=platformNonce;map.type='importmap';map.textContent=JSON.stringify({imports:{...libraries,...sharedImports,'@afbin/apollo':apollo,'@afbin/state':state,'@afbin/reader':reader,'@afbin/chrome':chrome,'@afbin/portable':portableEngine,...(collab?{'@afbin/collab':collab}:{}),...(sqlBlock?{'@afbin/offline-sql':blob(JSON.parse(sqlBlock.textContent))}:config.draft&&!config.offline?{'@afbin/offline-sql':new URL(${JSON.stringify(DRAFT_SQL_ENGINE_PATH)},document.currentScript.src||location.href).href}:{}),...(live?{'@afbin/morph':at('morph',${JSON.stringify(morphPath)}).href,'@afbin/native-markdown':at('nativeMarkdown',${JSON.stringify(nativeMarkdownPath)}).href,'@afbin/native-regions':at('nativeRegions',${JSON.stringify(nativeRegionsPath)}).href}:{})}});document.currentScript.after(map);
// A fetch of a file the page published reads it wherever the page is (config.files), and a GET to a host it declares
// goes through its fetch door (config.connect), before any author script runs (./page-fetch).
installPageFetch(window,config.files,!config.offline&&Array.isArray(config.connect)&&config.connect.length?{pageId:config.pageId,origins:config.connect}:undefined);
if(config.offline&&window.parent===window){void import(reader).then(module=>module.startPortableDocument(window,config.publishOrigin)).catch(()=>document.documentElement.setAttribute('data-af-connection','unavailable'));}
if(live){installHtmlReaderCommands(window,config.appOrigin);openFrameDoor(window,config.appOrigin,()=>import(reader));}`;
 const core=await bundled({stdin:{contents:entry,resolveDir:process.cwd(),loader:'ts'},format:'iife'},'HTML core is empty');
 return {core,systems:htmlSystemsCss(HTML_SYSTEM_NAMES),...guarded,...RUNTIME_MODULE_PATHS,host,hostComments,hostCode};
}
