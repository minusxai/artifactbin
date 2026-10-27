import {buildPortableChrome} from './build-portable-chrome.server';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import type {HtmlRuntimeAssets} from './contract';
import {htmlSystemsCss} from '../html-systems';
let assets:Promise<HtmlRuntimeAssets>|undefined;
/** Build immutable code once. Page configuration is supplied only by assembly. */
export function buildHtmlAssets():Promise<HtmlRuntimeAssets>{return assets??=compile().catch(error=>{assets=undefined;throw error;});}
export async function buildHtmlCore():Promise<string>{return (await buildHtmlAssets()).core;}
async function compile():Promise<HtmlRuntimeAssets>{
 const options={bundle:true,minify:true,write:false,platform:'browser' as const,target:'es2022'};
 const reader=await build({...options,entryPoints:[fileURLToPath(new URL('./browser-reader.ts',import.meta.url))],format:'esm',external:['@afbin/chrome','@afbin/portable','@afbin/morph'],banner:{js:`const __AF_RUNTIME_CONFIG__=(()=>{const supplied=document.querySelector('[data-af="runtime"]');return supplied?JSON.parse(supplied.textContent):{pageId:'local:'+location.pathname,revision:'local',backends:[],offline:true};})();`}});
 const author=await build({...options,entryPoints:[fileURLToPath(new URL('./browser-client.ts',import.meta.url))],format:'esm',plugins:[{name:'shared-reader',setup(builder){builder.onResolve({filter:/^\.\/browser-reader$/},()=>({path:'@afbin/reader',external:true}));}}]});
 const readerSource=reader.outputFiles?.[0]?.text,apollo=author.outputFiles?.[0]?.text;
 if(!readerSource||!apollo)throw Error('HTML runtime build produced no module');
 const portableBuild=await build({...options,entryPoints:[fileURLToPath(new URL('./portable-session.ts',import.meta.url))],format:'esm',external:['@afbin/chrome']});
 const portableEngine=portableBuild.outputFiles![0]!.text;
 const portableEnginePath='/af/v1/reader/'+createHash('sha256').update(portableEngine).digest('hex');
 // The live morph (./live-morph) loads only when a new version reaches an open framed page.
 const morphBuild=await build({...options,entryPoints:[fileURLToPath(new URL('./live-morph.ts',import.meta.url))],format:'esm'});
 const morph=morphBuild.outputFiles![0]!.text;
 const morphPath='/af/v1/reader/'+createHash('sha256').update(morph).digest('hex');
 const chrome=await buildPortableChrome();
 const chromePath='/af/v1/reader/'+createHash('sha256').update(chrome).digest('hex');
 const readerPath='/af/v1/reader/'+createHash('sha256').update(readerSource).digest('hex');
 const apolloPath='/af/v1/apollo/'+createHash('sha256').update(apollo).digest('hex');
 const entry=`import {installHtmlReaderCommands} from ${JSON.stringify(fileURLToPath(new URL('../html-bridge/reader.ts',import.meta.url)))};
import {openFrameDoor} from ${JSON.stringify(fileURLToPath(new URL('../islands/frame-door.ts',import.meta.url)))};
import {startNativeHtmlTableScroll} from ${JSON.stringify(fileURLToPath(new URL('./table-scroll.ts',import.meta.url)))};
const platformNonce=document.currentScript?.nonce;
const supplied=document.querySelector('[data-af="runtime"]');
const config=supplied?JSON.parse(supplied.textContent):{pageId:'local:'+location.pathname,revision:'local',backends:[],offline:true};
// D4: the platform owns <html data-af-design-system / data-af-dark>; set both before first paint. The viewer's choice
// arrives as ?mx-mode= (the reader adds it to the frame URL) and later as reader messages; page code only reads them.
const look=config.appearance;if(look&&typeof look==='object'){const root=document.documentElement;if(typeof look.designSystem==='string'&&/^[a-z][a-z0-9-]{0,63}$/.test(look.designSystem))root.setAttribute('data-af-design-system',look.designSystem);let mode=look.mode==='dark'?'dark':'light';try{const asked=new URLSearchParams(location.search).get('mx-mode');if(asked==='dark'||asked==='light')mode=asked;}catch{}root.setAttribute('data-af-dark',mode==='dark'?'true':'false');root.style.colorScheme=mode;}
startNativeHtmlTableScroll(document);
const blob=source=>URL.createObjectURL(new Blob([source],{type:'text/javascript'}));
const portableReader=document.querySelector('[data-af="reader"]');
if(supplied&&config.offline&&!document.documentElement.hasAttribute('data-af-private-preview')&&!portableReader)throw Error('Portable HTML is missing its reader module');
const reader=portableReader?blob(JSON.parse(portableReader.textContent)):new URL(${JSON.stringify(readerPath)},document.currentScript.src||location.href).href;
const portable=document.querySelector('[data-af="apollo"]');
if(supplied&&config.offline&&!document.documentElement.hasAttribute('data-af-private-preview')&&!portable)throw Error('Portable HTML is missing its author module');
const apollo=portable?blob(JSON.parse(portable.textContent)):new URL(${JSON.stringify(apolloPath)},document.currentScript.src||location.href).href;
const engineBlock=document.querySelector('[data-af="portable-engine"]');
const portableEngine=engineBlock?blob(JSON.parse(engineBlock.textContent)):new URL(${JSON.stringify(portableEnginePath)},document.currentScript.src||location.href).href;
const chromeBlock=document.querySelector('[data-af="chrome"]');
const chrome=chromeBlock?blob(JSON.parse(chromeBlock.textContent)):new URL(${JSON.stringify(chromePath)},document.currentScript.src||location.href).href;
const live=config.appOrigin&&!config.offline&&window.parent!==window;
// The source this document loaded, before its deferred and module scripts run: what a new version is compared against (./live-morph LOADED_SOURCE).
if(live){const keep=()=>{if(document.readyState==='loading')return;document.removeEventListener('readystatechange',keep);window[Symbol.for('afbin.loaded-source')]='<!doctype html>'+document.documentElement.outerHTML;};document.addEventListener('readystatechange',keep);}
if(!config.publishOrigin&&document.currentScript.src)config.publishOrigin=new URL(document.currentScript.src,location.href).origin;
const sharedBlock=config.offline?document.querySelector('[data-af="offline-modules"]'):null;
const sharedImports={};if(sharedBlock)for(const [key,source]of Object.entries(JSON.parse(sharedBlock.textContent))){if(!(key.startsWith('@afbin/offline/')&&/^[a-f0-9]{64}$/.test(key.slice(15)))||typeof source!=='string')throw Error('Invalid embedded module table');sharedImports[key]=blob(source);}
if(Object.keys(sharedImports).length)addEventListener('pagehide',event=>{if(!event.persisted)for(const url of Object.values(sharedImports))URL.revokeObjectURL(url);});
const libraries={};if(!portable)for(const [key,value]of Object.entries(config.libraries??{}))if(/^@afbin\\/[a-z][a-z0-9-]*$/.test(key)&&/^\\/libraries\\/[a-z][a-z0-9-]*-\\d+\\.\\d+\\.\\d+\\/index\\.js$/.test(value))libraries[key]=new URL(value,document.currentScript.src||location.href).href;
const map=document.createElement('script');if(platformNonce)map.nonce=platformNonce;map.type='importmap';map.textContent=JSON.stringify({imports:{...libraries,...sharedImports,'@afbin/apollo':apollo,'@afbin/reader':reader,'@afbin/chrome':chrome,'@afbin/portable':portableEngine,...(live?{'@afbin/morph':new URL(${JSON.stringify(morphPath)},document.currentScript.src||location.href).href}:{})}});document.currentScript.after(map);
if(config.offline&&window.parent===window){void import(reader).then(module=>module.startPortableDocument(window,config.publishOrigin)).catch(()=>document.documentElement.setAttribute('data-af-connection','unavailable'));}
if(live){installHtmlReaderCommands(window,config.appOrigin);openFrameDoor(window,config.appOrigin,()=>import(reader));}`;
 const core=await build({...options,stdin:{contents:entry,resolveDir:process.cwd(),loader:'ts'},format:'iife'});
 if(!core.outputFiles?.[0]?.text)throw Error('HTML core is empty');
 return {core:core.outputFiles[0].text,systems:htmlSystemsCss(),apollo,apolloPath,reader:readerSource,readerPath,chrome,chromePath,portableEngine,portableEnginePath,morph,morphPath};
}
