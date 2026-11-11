/** Internal: canonical project snapshot mechanics.
 * Used by: toolbox-publish.mjs. */
import {readFile,realpath,lstat} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {publicationLocalReferences,publicationScriptFetches} from
  './preview-html.mjs';
import {serverOrigin} from './toolbox-client.mjs';
const types={'.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg',
  '.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif','.csv':'text/csv','.json':
  'application/json','.js':'text/javascript','.mjs':'text/javascript','.woff2':'font/woff2'};
/** @typedef {{root:string,entry:string,server:string,entryHtml?:string,
  mappings?:import('../../../lib/html-publication-bundle/contracts').PublicationBundle['mappings']}}
  BundlePreparationOptions */
/** entryHtml replaces only selected entry bytes after filesystem admission, before snapshot
 * limits/discovery.
 * @param {BundlePreparationOptions} options */
export async function prepareBundle({root,entry,server,entryHtml,mappings={}}){
const origin=serverOrigin(server);
if(entryHtml!==undefined&&typeof entryHtml!=='string')throw Error(
   'Entry HTML override must be a string');
 const project=await realpath(root),files=new Map();let size=0;
 async function load(name){
if(typeof name!=='string'||!name||name.includes('\\')||path.isAbsolute(name))throw Error(
    'Invalid project path');
name=path.posix.normalize(name);if(name==='..'||name.startsWith('../'))throw Error(
    'Dependency escapes project root: '+name);
  const full=path.join(project,name),parts=name.split('/');let parent=project;
for(const part of parts){parent=path.join(parent,part);let info;try{info=await lstat(parent);}catch(
    error){if(error.code==='ENOENT'&&mappings[name])return;
    // A missing local components/<name>.js: point at the hosted @afbin/<name> import instead.
    const component=error.code==='ENOENT'&&
      /^(?:.*\/)?components\/([a-z][a-z0-9-]*)\.js$/.exec(name);
    if(component)error.message=`Missing ${name}: components are hosted; `+
      `import '@afbin/${component[1]}' instead of a local copy.`;
    throw error;
    }if(info.isSymbolicLink())throw Error('Symlink dependencies are refused: '+name);}
const canonical=await realpath(full);if(!canonical.startsWith(project+path.sep))throw Error(
    'Dependency escapes project root');
if(files.has(name))return;if(name===entry&&entryHtml!==undefined&&!(await lstat(canonical)).isFile(
    ))throw Error('Entry must be a regular file');const bytes=name===entry&&
    entryHtml!==undefined?Buffer.from(entryHtml):await readFile(canonical);if(
    bytes.length>4_000_000||(size+=bytes.length)>16_000_000||files.size>=100)throw Error(
    'Publication bundle limit exceeded');
const contentType=types[path.extname(name).toLowerCase()]??'application/octet-stream';files.set(
    name,{path:name,contentType,base64:bytes.toString('base64')});
  if(name===entry||contentType==='text/css'||contentType==='text/javascript'){
   const source=bytes.toString('utf8');
   const urls=publicationLocalReferences(source,contentType);
for(const url of urls){if(/^\/(?!\/)/.test(url)){await loadRooted(url);continue;}
    if(!url||/^(?:[a-z][a-z\d+.-]*:|\/|#)/i.test(url))continue;const dep=
     path.posix.normalize(path.posix.join(path.posix.dirname(name),decodeURIComponent(url.split(
     /[?#]/)[0])));await load(dep);}
   // A script's literal fetch names a file beside the page, from whichever file holds it; one
   // the project lacks (or that leaves it) is the script's own address, never a refusal.
for(const url of publicationScriptFetches(source,contentType)){if(!url||
    /^(?:[a-z][a-z\d+.-]*:|\/|#)/i.test(url))continue;let dep;try{dep=path.posix.normalize(
    path.posix.join(path.posix.dirname(entry),decodeURIComponent(url.split(/[?#]/)[0])));}catch{
    continue;}
if(dep==='..'||dep.startsWith('../')||dep===entry||!(await lstat(path.join(project,dep)).catch(
    ()=>null))?.isFile())continue;await load(dep);}
  }
 }
 // A root-relative reference names the project's own file when it has one; publish refuses one
 // that names none (lib/html-publication-bundle plan).
 async function loadRooted(url){let dep;try{dep=path.posix.normalize(decodeURIComponent(url.split(
  /[?#]/)[0]).slice(1));}catch{return;}if(!dep||dep==='.'||dep.startsWith('..'))return;
  if((await lstat(path.join(project,dep)).catch(()=>null))?.isFile())await load(dep);}
 entry=path.posix.normalize(entry);await load(entry);
 const html=Buffer.from(files.get(entry).base64,'base64').toString('utf8');files.delete(entry);
return {server:origin,method:'POST',idempotencyKey:randomUUID(),body:{html,visibility:
   'unlisted',publicationBundle:{entryPath:entry,files:[...files.values()],mappings}}};
}
/** @param {BundlePreparationOptions & {head:{id:string,version:number,state:string}}} options */
export async function prepareBundleUpdate(options){
 const {head}=options;
if(!head||!/^[A-Za-z0-9]{6,}$/.test(head.id)||!Number.isInteger(head.version)||head.version<1||
   typeof head.state!=='string'||!head.state)throw Error(
   'An update requires the canonical page id, version and state.');
 const saved=await prepareBundle(options);
const body={...saved.body,expectedVersion:head.version,expectedState:head.state};
   delete body.visibility;
 return {...saved,method:'PUT',artifactId:head.id,body};
}
