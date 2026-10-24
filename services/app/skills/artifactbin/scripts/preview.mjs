#!/usr/bin/env node
import {createServer} from 'node:http';
import {realpath,stat,readFile} from 'node:fs/promises';
import {resolve,relative,sep,extname} from 'node:path';
import {pathToFileURL} from 'node:url';

// No remote sources, frames, forms, workers or popup permissions. This is a
// browser resource policy, not an OS/network sandbox for hostile JavaScript.
export const PRIVATE_CSP = "default-src 'none'; script-src 'self' 'unsafe-inline' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' data: blob:; connect-src 'self'; frame-src 'none'; object-src 'none'; worker-src 'none'; base-uri 'self'; form-action 'none'; frame-ancestors 'none'; sandbox allow-scripts allow-same-origin";
const types={'.html':'text/html; charset=utf-8','.htm':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.webp':'image/webp','.avif':'image/avif','.woff2':'font/woff2','.woff':'font/woff','.mp4':'video/mp4','.csv':'text/csv; charset=utf-8','.txt':'text/plain; charset=utf-8'};
const inside=(root,path)=>{const tail=relative(root,path);return tail===''||(!tail.startsWith('..'+sep)&&tail!=='..'&&!tail.startsWith(sep));};
/** Start a read-only server; contract: scripts/preview-contract.d.ts. */
export async function startPreview({root,port=0,runtimeDir}) {
 if(!Number.isInteger(port)||port<0||port>65535)throw Error('Port must be an integer from 0 to 65535');
 const base=await realpath(resolve(root));if(!(await stat(base)).isDirectory())throw Error('Root must be a directory');
 // Generated only in the downloadable archive; optional in a source checkout.
 const runtimeModule=new URL('./preview-runtime.mjs',import.meta.url).href;
 let bundled;try{bundled=(await import(runtimeModule)).default;}catch(error){if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;}
 const runtime=runtimeDir?await realpath(resolve(runtimeDir)):undefined;
 const server=createServer(async(req,res)=>{
  res.setHeader('Content-Security-Policy',PRIVATE_CSP);res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Cross-Origin-Resource-Policy','same-origin');
  const end=(status,body)=>{res.statusCode=status;res.end(req.method==='HEAD'?undefined:body);};
  if(req.headers.host!==`127.0.0.1:${server.address().port}`)return end(403,'Forbidden');
  if(req.headers.origin&&req.headers.origin!==`http://${req.headers.host}`)return end(403,'Forbidden');
  if(req.method!=='GET'&&req.method!=='HEAD'){res.setHeader('Allow','GET, HEAD');return end(405,'Read-only preview');}
  try {
   const pathname=decodeURIComponent((req.url||'/').split('?')[0]);
   if(!pathname.startsWith('/')||pathname.includes('\\')||pathname.includes('\0'))return end(404,'Not found');
   const source=bundled&&(pathname==='/af/v1/core.js'?bundled.core:pathname===bundled.readerPath?bundled.reader:pathname===bundled.apolloPath?bundled.apollo:undefined);
   if(source!==undefined){res.setHeader('Content-Type','text/javascript; charset=utf-8');res.setHeader('Content-Length',Buffer.byteLength(source));return end(200,source);}
   const segments=pathname.split('/');if(segments.some(part=>part.startsWith('.')))return end(404,'Not found');
   const isRuntime=runtime&&pathname.startsWith('/af/v1/');const selected=isRuntime?runtime:base;
   const requested=isRuntime?pathname.slice('/af/v1/'.length):pathname.slice(1);
   let file=resolve(selected,requested||'index.html');if(!inside(selected,file))return end(404,'Not found');
   file=await realpath(file);if(!inside(selected,file)||relative(selected,file).split(sep).some(part=>part.startsWith('.')))return end(404,'Not found');
   const info=await stat(file);if(!info.isFile())return end(404,'Not found');
   const type=types[extname(file).toLowerCase()]||(isRuntime?'text/javascript; charset=utf-8':'application/octet-stream');
   res.setHeader('Content-Type',type);res.setHeader('Content-Length',info.size);
   if(req.method==='HEAD')return end(200);
   end(200,await readFile(file));
  }catch{return end(404,'Not found');}
 });
 await new Promise((done,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',done);});
 return {server,url:`http://127.0.0.1:${server.address().port}/`,close:()=>new Promise((done,reject)=>server.close(error=>error?reject(error):done()))};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const args=process.argv.slice(2);const root=args.shift();let port=0,runtimeDir;
 try {
  if(!root||root.startsWith('--'))throw Error('Usage: node preview.mjs ROOT [--port PORT] [--runtime-dir DIR]');
  while(args.length){const flag=args.shift(),value=args.shift();if(!value)throw Error('Missing option value');if(flag==='--port')port=Number(value);else if(flag==='--runtime-dir')runtimeDir=value;else throw Error('Unknown option');}
  const session=await startPreview({root,port,runtimeDir});console.log(`Private local preview: ${session.url}\nStop with Ctrl-C. Only the selected directory is served; no files are uploaded.`);
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{void session.close();});
 }catch(error){console.error(error.message);process.exitCode=1;}
}
