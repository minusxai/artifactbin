/**
 * Internal: file helpers for the private preview server: content types, platform font lookup,
 * root containment and the per-request autofix of served pages.
 * Used by: preview.mjs, preview-source-routes.mjs.
 */
import {readFile,readdir} from 'node:fs/promises';
import {statSync} from 'node:fs';
import {resolve,relative,sep,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {autofixHtml} from './preview-html.mjs';

export const types={'.html':'text/html; charset=utf-8','.htm':'text/html; charset=utf-8',
  '.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml',
  '.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif',
  '.webp':'image/webp','.avif':'image/avif','.woff2':'font/woff2','.woff':'font/woff',
  '.mp4':'video/mp4','.csv':'text/csv; charset=utf-8','.txt':'text/plain; charset=utf-8'};
/**
 * The platform stylesheet's font files: /af/fonts/<name>.woff2 (and the legacy
 * /fonts/<name>.<hash8>.woff2). A source checkout reads the app's public/fonts; otherwise each
 * file is fetched once from the selected server's /af/fonts/ (the skill archive packages no fonts)
 * and served from this origin, so the private CSP keeps font-src 'self'.
 */
const PLATFORM_FONT=
  /^\/(?:af\/fonts\/([a-z0-9-]+)\.woff2|fonts\/([a-z0-9-]+)\.[a-f0-9]{8}\.woff2)$/;
let checkoutFonts;
async function checkoutFont(name){
 // Resolved from this file: scripts/ -> services/app/public/fonts in a source checkout.
 const dir=new URL('../../../public/fonts/',import.meta.url);
checkoutFonts??=readdir(fileURLToPath(dir)).catch(error=>{if(error.code==='ENOENT'||
   error.code==='ENOTDIR')return [];throw error;});
const file=(await checkoutFonts).find(entry=>entry.startsWith(name+'.')&&
   /^\.[a-f0-9]{8}\.woff2$/.test(entry.slice(name.length)));
 return file?await readFile(fileURLToPath(new URL(file,dir))):null;
}
/** pathname -> font bytes (or null); remote fetches are shared and retried after a failure. */
export function platformFonts(origin){
 const fetched=new Map();
 return async pathname=>{
  const match=PLATFORM_FONT.exec(pathname);if(!match)return null;
  const name=match[1]??match[2],local=await checkoutFont(name);if(local)return local;
  if(!origin)return null;
  if(!fetched.has(name))fetched.set(name,(async()=>{
const response=await fetch(new URL(`/af/fonts/${name}.woff2`,origin),{redirect:'error',signal:
     AbortSignal.timeout(10000)});
   if(!response.ok)return null;
   const bytes=Buffer.from(await response.arrayBuffer());
   // Only a bounded WOFF2 body is served from this origin.
if(bytes.length>4_000_000||bytes.subarray(0,4).toString('latin1')!=='wOF2')throw Error(
     'Unexpected platform font response');
   return bytes;
  })().catch(error=>{fetched.delete(name);throw error;}));
  return fetched.get(name);
 };
}
export const inside=(root,path)=>{const tail=relative(root,path);return tail===''||(
  !tail.startsWith('..'+sep)&&tail!=='..'&&!tail.startsWith(sep));};
/** Autofix (lib/html-autofix) on the bytes a page is served with; the file changes only when
 * `write` is chosen. */
export function previewAutofix(base,file,html){
return autofixHtml(html,{exists:relative=>{const full=resolve(dirname(file),relative);if(!inside(
   base,full))return false;try{return statSync(full).isFile();}catch{return false;}}});
}
