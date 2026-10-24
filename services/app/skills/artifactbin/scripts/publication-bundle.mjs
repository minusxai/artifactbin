/** Native project snapshot helper. Does not change local author source or store credentials. */
import {readFile,realpath,lstat,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {realpathSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {sendPublication} from './publish.mjs';
import {publicationLocalReferences} from './preview-html.mjs';
import {fileURLToPath} from 'node:url';
const types={'.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif','.csv':'text/csv','.json':'application/json','.js':'text/javascript','.mjs':'text/javascript','.woff2':'font/woff2'};
export async function prepareBundle({root,entry,server,manifest=[],mappings={}}){
 const origin=new URL(server);if(!['http:','https:'].includes(origin.protocol)||origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash)throw Error('Select a server origin');
 const project=await realpath(root),files=new Map();let size=0;
 async function load(name){
  if(typeof name!=='string'||!name||name.includes('\\')||path.isAbsolute(name))throw Error('Invalid project path');
  name=path.posix.normalize(name);if(name==='..'||name.startsWith('../'))throw Error('Dependency escapes project root: '+name);
  const full=path.join(project,name),parts=name.split('/');let parent=project;
  for(const part of parts){parent=path.join(parent,part);if((await lstat(parent)).isSymbolicLink())throw Error('Symlink dependencies are refused: '+name);}
  const canonical=await realpath(full);if(!canonical.startsWith(project+path.sep))throw Error('Dependency escapes project root');
  if(files.has(name))return;const bytes=await readFile(canonical);if(bytes.length>4_000_000||(size+=bytes.length)>16_000_000||files.size>=100)throw Error('Publication bundle limit exceeded');
  const contentType=types[path.extname(name).toLowerCase()]??'application/octet-stream';files.set(name,{path:name,contentType,base64:bytes.toString('base64')});
  if(name===entry||contentType==='text/css'||contentType==='text/javascript'){
   const source=bytes.toString('utf8');
   const urls=contentType==='text/css'?[...source.matchAll(/\/\*[\s\S]*?\*\/|url\(\s*["']?([^"'\s)]+)|@import\s+["']([^"']+)|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/gi)].map(match=>match[1]??match[2]):publicationLocalReferences(source,contentType);
   for(const url of urls){if(!url||/^(?:[a-z][a-z\d+.-]*:|\/|#)/i.test(url))continue;const dep=path.posix.normalize(path.posix.join(path.posix.dirname(name),decodeURIComponent(url.split(/[?#]/)[0])));if(!mappings[dep])await load(dep);}
  }
 }
 entry=path.posix.normalize(entry);await load(entry);for(const name of manifest)await load(name);
 const html=Buffer.from(files.get(entry).base64,'base64').toString('utf8');files.delete(entry);
 return {server:origin.origin,method:'POST',idempotencyKey:randomUUID(),body:{html,visibility:'unlisted',publicationBundle:{entryPath:entry,files:[...files.values()],mappings}}};
}
export async function sendBundleFile(requestFile,env=process.env,fetcher=fetch){
 const saved=JSON.parse(await readFile(requestFile,'utf8'));
 const receiptFile=requestFile+'.receipt.json';
 try{
  const receipt=await sendPublication(saved,env,fetcher);
  await writeFile(receiptFile,JSON.stringify({receipt,mappings:Object.fromEntries((receipt.dependencyReceipts??[]).map(({path,...mapping})=>[path,mapping]))},null,2)+'\n',{mode:0o600});return receipt;
 }catch(error){if(error.receipt)await writeFile(receiptFile,JSON.stringify({receipt:error.receipt,mappings:Object.fromEntries((error.receipt.dependencyReceipts??[]).map(({path,...mapping})=>[path,mapping]))},null,2)+'\n',{mode:0o600});throw error;}
}
if(process.argv[1]&&realpathSync(process.argv[1])===fileURLToPath(import.meta.url)&&process.argv[2]==='--send'){
 sendBundleFile(process.argv[3]).then(receipt=>process.stdout.write(JSON.stringify(receipt,null,2)+'\n')).catch(error=>{process.stderr.write(error.message+'\n');process.exitCode=1;});
}else if(process.argv[1]&&realpathSync(process.argv[1])===fileURLToPath(import.meta.url)){
 const [root,entry,server,output,manifestFile]=process.argv.slice(2);
 if(!root||!entry||!server||!output)throw Error('Usage: node publication-bundle.mjs PROJECT_ROOT ENTRY.html SERVER_ORIGIN REQUEST.json [MANIFEST.json]');
 const extra=manifestFile?JSON.parse(await readFile(manifestFile,'utf8')):{};
 const prepared=await prepareBundle({root,entry,server,...extra});await writeFile(output,JSON.stringify(prepared,null,2)+'\n',{flag:'wx',mode:0o600});
 process.stdout.write('Saved immutable publication request. Send with publish.mjs --send; preserve dependencyReceipts as path mappings for later updates.\n');
}
