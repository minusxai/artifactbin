/** Native project snapshot helper. Does not change local author source or store credentials. */
import {readFile,realpath,lstat,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {realpathSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {publicationLocalReferences,previewBackendLinks} from './preview-html.mjs';
import {fileURLToPath} from 'node:url';
const types={'.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg',
  '.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif','.csv':'text/csv','.json':
  'application/json','.js':'text/javascript','.mjs':'text/javascript','.woff2':'font/woff2'};
/** @typedef {{root:string,entry:string,server:string,entryHtml?:string,manifest?:string[],
  mappings?:import('../../../lib/html-publication-bundle/contracts').PublicationBundle['mappings'],
  retainedBackends?:{name:string,href:string}[]}} BundlePreparationOptions */
/** entryHtml replaces only selected entry bytes after filesystem admission, before snapshot limits/discovery.
 * @param {BundlePreparationOptions} options */
export async function prepareBundle({root,entry,server,entryHtml,manifest=[],mappings={},
  retainedBackends=[]}){
const origin=new URL(server);if(!['http:','https:'].includes(origin.protocol)||origin.username||
   origin.password||origin.pathname!=='/'||origin.search||origin.hash)throw Error(
   'Select a server origin');
if(entryHtml!==undefined&&typeof entryHtml!=='string')throw Error(
   'Entry HTML override must be a string');
 const project=await realpath(root),files=new Map(),retainedPaths=new Set();let size=0;
 async function load(name){
if(typeof name!=='string'||!name||name.includes('\\')||path.isAbsolute(name))throw Error(
    'Invalid project path');
name=path.posix.normalize(name);if(name==='..'||name.startsWith('../'))throw Error(
    'Dependency escapes project root: '+name);
  const full=path.join(project,name),parts=name.split('/');let parent=project;
for(const part of parts){parent=path.join(parent,part);let info;try{info=await lstat(parent);}catch(
    error){if(error.code==='ENOENT'&&(mappings[name]||retainedPaths.has(name)))return;throw error;
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
if(name===entry)for(const link of previewBackendLinks(source)){if(retainedBackends.some(saved=>
     saved.name===link.name&&saved.href===link.href)&&! /^(?:[a-z][a-z\d+.-]*:|\/|#)/i.test(
     link.href))retainedPaths.add(path.posix.normalize(path.posix.join(path.posix.dirname(entry),
     link.href)));}
   const urls=publicationLocalReferences(source,contentType);
for(const url of urls){if(!url||/^(?:[a-z][a-z\d+.-]*:|\/|#)/i.test(url))continue;const dep=
     path.posix.normalize(path.posix.join(path.posix.dirname(name),decodeURIComponent(url.split(
     /[?#]/)[0])));await load(dep);}
  }
 }
 entry=path.posix.normalize(entry);await load(entry);for(const name of manifest)await load(name);
 const html=Buffer.from(files.get(entry).base64,'base64').toString('utf8');files.delete(entry);
return {server:origin.origin,method:'POST',idempotencyKey:randomUUID(),body:{html,visibility:
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
export async function sendBundleFile(requestFile,env=process.env,fetcher=fetch){
 const saved=JSON.parse(await readFile(requestFile,'utf8'));
 const receiptFile=requestFile+'.receipt.json';
 try{
const {sendPublication}=await import('./publish.mjs');const receipt=await sendPublication(saved,env,
    fetcher);
await writeFile(receiptFile,JSON.stringify({receipt,mappings:Object.fromEntries((
    receipt.dependencyReceipts??[]).map(({path,...mapping})=>[path,mapping]))},null,2)+'\n',{mode:
    0o600});return receipt;
}catch(error){if(error.receipt)await writeFile(receiptFile,JSON.stringify({receipt:error.receipt,
   mappings:Object.fromEntries((error.receipt.dependencyReceipts??[]).map(({path,...mapping})=>[
   path,mapping]))},null,2)+'\n',{mode:0o600});throw error;}
}
const help=
  `Usage: node publication-bundle.mjs PROJECT_ROOT ENTRY.html SERVER_ORIGIN REQUEST.json [MANIFEST.json]
       node publication-bundle.mjs --send REQUEST.json
       node publication-bundle.mjs --help
MANIFEST.json: {manifest:[paths],mappings:{path:receipt}}.
Send uses origin-matched ARTIFACTBIN_URL and ARTIFACTBIN_TOKEN; saves REQUEST.json.receipt.json.
Reuse unchanged REQUEST.json and key on uncertain outcomes. A new update gets a new key. Never run from stdin.`;
async function main(args){
 if(args.length===1&&args[0]==='--help'){console.log(help);return;}
if(args[0]==='--send'){if(args.length!==2)throw Error(help);console.log(JSON.stringify(
   await sendBundleFile(args[1]),null,2));return;}
 const [root,entry,server,output,manifestFile]=args;
 if(args.length<4||args.length>5||!root||root.startsWith('--'))throw Error(help);
 const extra=manifestFile?JSON.parse(await readFile(manifestFile,'utf8')):{};
 // Manifest input cannot replace the selected project, server or observed page head.
if(!extra||typeof extra!=='object'||Object.keys(extra).some(key=>!['manifest','mappings'].includes(
   key)))throw Error('Manifest supports only manifest and mappings.');
 const options={root,entry,server,...extra};
 const prepared=await prepareBundle(options);
 await writeFile(output,JSON.stringify(prepared,null,2)+'\n',{flag:'wx',mode:0o600});
console.log(
   'Saved immutable publication request. Send with publication-bundle.mjs --send; preserve its receipt mappings for updates.');
}
if(process.argv[1]&&realpathSync(process.argv[1])===fileURLToPath(import.meta.url)){console.error(
  'Deprecated publication-bundle.mjs; prefer publish.mjs FILE.');main(process.argv.slice(2)).catch(
  error=>{console.error(error.message);process.exitCode=1;});}
