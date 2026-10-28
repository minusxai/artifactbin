/**
 * Internal: the platform code a local preview runs, from the selected server: the core runtime and
 * its lazy modules (/af/*.js), the hosted libraries (/libraries/<name>-<version>/index.js), the
 * hosted components (/af/components/*.js) and the import map naming them (/af/import-map.json)
 * and one design system's platform stylesheet (/af/styles.css?system=NAME). Each file is fetched
 * once and served from the preview's own origin, so the private CSP keeps script-src 'self'. A
 * source checkout serves its own built libraries and components first. Nothing here resolves a
 * page-selected disk path or a URL outside these closed patterns.
 * Used by: preview.mjs (and the html-preview, native-author-skill and import-map tests).
 */
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

const RUNTIME=/^\/af\/(?:core|apollo|reader|chrome|portable|morph)\.js$/;
const LIBRARY=/^\/libraries\/[a-z][a-z0-9-]*-\d+\.\d+\.\d+\/index\.js$/;
const COMPONENT=/^\/af\/components\/[a-z][a-z0-9-]*\.js$/;
const MAX_BYTES=8_000_000;
/** The runtime modules Save HTML embeds (lib/html-runtime save-local), by HtmlRuntimeAssets key. */
const RUNTIME_MODULES={core:'/af/core.js',apollo:'/af/apollo.js',reader:'/af/reader.js',chrome:
  '/af/chrome.js',portableEngine:'/af/portable.js',morph:'/af/morph.js'};

/** True for a path this module may answer. `/af/v1/core.js` is the legacy alias of
 * `/af/core.js`. */
export const isPlatformModulePath=pathname=>pathname==='/af/v1/core.js'||RUNTIME.test(pathname)||
  LIBRARY.test(pathname)||COMPONENT.test(pathname);

/** A source checkout's own build outputs (absent in the installed archive). */
async function checkoutModule(pathname){
const file=LIBRARY.test(pathname)?new URL('../../../public'+pathname,import.meta.url):
   COMPONENT.test(pathname)?new URL('../../../lib/build-assets/components/'+pathname.slice(
   '/af/components/'.length),import.meta.url):null;
 if(!file)return null;
return readFile(fileURLToPath(file)).catch(error=>{if(error.code==='ENOENT'||
   error.code==='ENOTDIR')return null;throw error;});
}

/** @param {{origin?:string|null, libraryAssets?:Record<string,string>}} options
 * `libraryAssets`: explicit `/libraries/…` sources (tests). */
export function platformModules({origin=null,libraryAssets}={}){
if(origin!==null&&!/^https?:$/.test(new URL(origin).protocol))throw Error(
   'Platform origin must be http(s)');
 const explicit=new Map();
for(const [url,source] of Object.entries(libraryAssets??{})){if(!LIBRARY.test(url)||
   typeof source!=='string'||!source)throw Error('Invalid preview library asset');explicit.set(url,
   Buffer.from(source));}
 const fetched=new Map();
 const remote=(pathname,check)=>{
  if(!origin)return Promise.resolve(null);
  // One shared fetch per path; a failure is forgotten so the next request retries.
  if(!fetched.has(pathname))fetched.set(pathname,(async()=>{
const response=await fetch(new URL(pathname,origin),{redirect:'error',signal:AbortSignal.timeout(
     15000)});
   if(response.status===404)return null;
   if(!response.ok)throw Error(`Platform module ${pathname} answered ${response.status}`);
   const bytes=Buffer.from(await response.arrayBuffer());
if(bytes.length>MAX_BYTES||!check(response.headers.get('content-type')??''))throw Error(
     'Unexpected platform module response: '+pathname);
   return bytes;
  })().catch(error=>{fetched.delete(pathname);throw error;}));
  return fetched.get(pathname);
 };
 const javascript=type=>/^(?:text|application)\/javascript\b/i.test(type);
 /** The bytes of one platform module path, or null when the path is not one or neither source
  * has it. */
 async function module(pathname){
  if(pathname==='/af/v1/core.js')pathname='/af/core.js';
  if(!isPlatformModulePath(pathname))return null;
  return explicit.get(pathname)??await checkoutModule(pathname)??await remote(pathname,javascript);
 }
 let imports;
 /** `@afbin/<name>` -> path for every hosted library and component. Explicit assets alone when
  * given (tests). */
 async function importMap(){
if(explicit.size){const map={};for(const url of explicit.keys())map['@afbin/'+LIBRARY.exec(url)[
    0].slice(11).replace(/-\d+\.\d+\.\d+\/index\.js$/,'')]=url;return map;}
  imports??=remote('/af/import-map.json',type=>/^application\/json\b/i.test(type)).then(bytes=>{
   // Admit only @afbin/ names that point at a closed library or component path.
   const map=bytes?JSON.parse(bytes.toString('utf8')).imports:{};const admitted={};
for(const [key,value] of Object.entries(map??{}))if(/^@afbin\/[a-z][a-z0-9-]*$/.test(key)&&
     typeof value==='string'&&(LIBRARY.test(value)||COMPONENT.test(value)))admitted[key]=value;
   return admitted;
  }).catch(error=>{imports=undefined;throw error;});
  return imports;
 }
 const styles=new Map();
 /** The platform stylesheet of one design system: a source checkout's own (lib/html-systems),
  * else the selected server's. */
 function systemCss(name){
  if(!/^[a-z][a-z0-9-]{0,63}$/.test(name))return Promise.resolve(null);
  if(!styles.has(name))styles.set(name,(async()=>{
try{const {htmlSystemsCss,isHtmlSystem}=await import('../../../lib/html-systems/index.ts');
     return isHtmlSystem(name)?htmlSystemsCss([name]):null;}
catch(error){if(!['ERR_MODULE_NOT_FOUND','ERR_UNKNOWN_FILE_EXTENSION'].includes(
     error.code))throw error;}
   const bytes=await remote('/af/styles.css?system='+name,type=>/^text\/css\b/i.test(type));
   return bytes?bytes.toString('utf8'):null;
  })().catch(error=>{styles.delete(name);throw error;}));
  return styles.get(name);
 }
 /** The runtime modules Save HTML embeds, as HtmlRuntimeAssets (core plus each module and its
  * path). */
 async function runtimeAssets(){
  const assets={};
for(const [key,pathname] of Object.entries(RUNTIME_MODULES)){const bytes=await module(pathname);if(
    !bytes){if(key==='core'||key==='apollo'||key==='reader')throw Error(
    'Platform runtime unavailable: '+pathname);continue;}assets[key]=bytes.toString('utf8');if(
    key!=='core')assets[key+'Path']=pathname;}
  return assets;
 }
 return {module,importMap,runtimeAssets,systemCss};
}
