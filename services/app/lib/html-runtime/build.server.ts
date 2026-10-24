import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import type {HtmlRuntimeAssets} from './contract';
let assets:Promise<HtmlRuntimeAssets>|undefined;
/** Build immutable code once. Page configuration is supplied only by assembly. */
export function buildHtmlAssets():Promise<HtmlRuntimeAssets>{return assets??=compile().catch(error=>{assets=undefined;throw error;});}
export async function buildHtmlCore():Promise<string>{return (await buildHtmlAssets()).core;}
async function compile():Promise<HtmlRuntimeAssets>{
 const options={bundle:true,minify:true,write:false,platform:'browser' as const,target:'es2022'};
 const reader=await build({...options,entryPoints:[fileURLToPath(new URL('./browser-reader.ts',import.meta.url))],format:'esm',banner:{js:`const __AF_RUNTIME_CONFIG__=(()=>{const supplied=document.querySelector('[data-af="runtime"]');return supplied?JSON.parse(supplied.textContent):{pageId:'local:'+location.pathname,revision:'local',backends:[],offline:true};})();`}});
 const author=await build({...options,entryPoints:[fileURLToPath(new URL('./browser-client.ts',import.meta.url))],format:'esm',plugins:[{name:'shared-reader',setup(builder){builder.onResolve({filter:/^\.\/browser-reader$/},()=>({path:'@afbin/reader',external:true}));}}]});
 const readerSource=reader.outputFiles?.[0]?.text,apollo=author.outputFiles?.[0]?.text;
 if(!readerSource||!apollo)throw Error('HTML runtime build produced no module');
 const readerPath='/af/v1/reader/'+createHash('sha256').update(readerSource).digest('hex');
 const apolloPath='/af/v1/apollo/'+createHash('sha256').update(apollo).digest('hex');
 const entry=`import {installHtmlReaderCommands} from ${JSON.stringify(fileURLToPath(new URL('../html-bridge/reader.ts',import.meta.url)))};
import {openFrameDoor} from ${JSON.stringify(fileURLToPath(new URL('../islands/frame-door.ts',import.meta.url)))};
const supplied=document.querySelector('[data-af="runtime"]');
const config=supplied?JSON.parse(supplied.textContent):{pageId:'local:'+location.pathname,revision:'local',backends:[],offline:true};
const blob=source=>URL.createObjectURL(new Blob([source],{type:'text/javascript'}));
const portableReader=document.querySelector('[data-af="reader"]');
if(supplied&&config.offline&&!document.documentElement.hasAttribute('data-af-private-preview')&&!portableReader)throw Error('Portable HTML is missing its reader module');
const reader=portableReader?blob(JSON.parse(portableReader.textContent)):new URL(${JSON.stringify(readerPath)},document.currentScript.src||location.href).href;
const portable=document.querySelector('[data-af="apollo"]');
if(supplied&&config.offline&&!document.documentElement.hasAttribute('data-af-private-preview')&&!portable)throw Error('Portable HTML is missing its author module');
const apollo=portable?blob(JSON.parse(portable.textContent)):new URL(${JSON.stringify(apolloPath)},document.currentScript.src||location.href).href;
const map=document.createElement('script');map.type='importmap';map.textContent=JSON.stringify({imports:{'@afbin/apollo':apollo,'@afbin/reader':reader}});document.currentScript.after(map);
if(document.querySelector('[data-af="portable"]')&&!document.documentElement.hasAttribute('data-af-private-preview'))import(reader).then(module=>module.startPortableDocument());
if(config.appOrigin&&!config.offline&&window.parent!==window){installHtmlReaderCommands(window,config.appOrigin);openFrameDoor(window,config.appOrigin,()=>import(reader));}`;
 const core=await build({...options,stdin:{contents:entry,resolveDir:process.cwd(),loader:'ts'},format:'iife'});
 if(!core.outputFiles?.[0]?.text)throw Error('HTML core is empty');
 return {core:core.outputFiles[0].text,apollo,apolloPath,reader:readerSource,readerPath};
}
