#!/usr/bin/env node
import {createServer} from 'node:http';
import {realpath,stat} from 'node:fs/promises';
import {resolve,relative,sep,extname} from 'node:path';
import {createRevisionSource,changeNotice} from './preview-changes.mjs';
import {createPreviewSessions} from './preview-sessions.mjs';
import {previewHtml} from './preview-html.mjs';
import {readPreviewFile,PREVIEW_LIMITS,PreviewLimitError} from './preview-files.mjs';
import {pathToFileURL} from 'node:url';

// No remote sources, frames, forms, workers or popup permissions. This is a
// browser resource policy, not an OS/network sandbox for hostile JavaScript.
export const PRIVATE_CSP = "default-src 'none'; script-src 'self' 'unsafe-inline' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' data: blob:; connect-src 'self'; frame-src 'none'; object-src 'none'; worker-src 'none'; base-uri 'self'; form-action 'none'; frame-ancestors 'none'; sandbox allow-scripts allow-same-origin allow-downloads";
const types={'.html':'text/html; charset=utf-8','.htm':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.webp':'image/webp','.avif':'image/avif','.woff2':'font/woff2','.woff':'font/woff','.mp4':'video/mp4','.csv':'text/csv; charset=utf-8','.txt':'text/plain; charset=utf-8'};
const inside=(root,path)=>{const tail=relative(root,path);return tail===''||(!tail.startsWith('..'+sep)&&tail!=='..'&&!tail.startsWith(sep));};
/** Start a read-only server; contract: scripts/preview-contract.d.ts. */
export async function startPreview({root,port=0,runtimeDir,revisionIntervalMs=1000,sessionOptions={},operationTimeoutMs=5000}) {
 if(!Number.isInteger(port)||port<0||port>65535)throw Error('Port must be an integer from 0 to 65535');
 const base=await realpath(resolve(root));if(!(await stat(base)).isDirectory())throw Error('Root must be a directory');
 // Generated only in the downloadable archive; optional in a source checkout.
 const runtimeModule=new URL('./preview-runtime.mjs',import.meta.url).href;
 let bundled;try{bundled=(await import(runtimeModule)).default;}catch(error){if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;}
 const runtime=runtimeDir?await realpath(resolve(runtimeDir)):undefined;
 const revisions=createRevisionSource(base,{intervalMs:revisionIntervalMs});
 const sessions=createPreviewSessions(base,sessionOptions);
 const server=createServer(async(req,res)=>{
  res.setHeader('Content-Security-Policy',PRIVATE_CSP);res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Cross-Origin-Resource-Policy','same-origin');
  const end=(status,body)=>{res.statusCode=status;res.end(req.method==='HEAD'?undefined:body);};
  if(req.headers.host!==`127.0.0.1:${server.address().port}`)return end(403,'Forbidden');
  if(req.headers.origin&&req.headers.origin!==`http://${req.headers.host}`)return end(403,'Forbidden');
  const datasetRoute=(req.url??'').split('?')[0].match(/^\/__af_preview\/datasets\/([A-Za-z0-9_-]+)(?:\/(export|status|discard)(?:\/([A-Za-z_][A-Za-z0-9_]*))?)?$/);
  if(datasetRoute){
   try {
    const session=sessions.get(datasetRoute[1],{allowObsolete:!!datasetRoute[2]});res.setHeader('Content-Type','application/json');
    if(datasetRoute[2]==='status'){if(req.method!=='GET')return end(405,'Status requires GET');return end(200,JSON.stringify(await sessions.status(datasetRoute[1])));}
    if(datasetRoute[2]==='export'){if(req.method!=='GET')return end(405,'Export requires GET');if(!session.names.has(datasetRoute[3]))return end(404,'Unknown local namespace');res.setHeader('Content-Disposition',`attachment; filename="local-${datasetRoute[3]}.json"`);return end(200,JSON.stringify(session.adapter.export(datasetRoute[3])));}
    if(datasetRoute[2]==='discard'){if(req.headers['transfer-encoding']||Number(req.headers['content-length']??0)>0)return end(413,'Discard does not accept a body');if(req.method!=='POST'||req.headers.origin!==`http://${req.headers.host}`)return end(403,'Same-origin POST required');sessions.discard(datasetRoute[1]);req.resume();return end(200,JSON.stringify({discarded:true}));}
    if(req.method!=='POST')return end(405,'Local operations require POST');
    if(req.headers.origin!==`http://${req.headers.host}`)return end(403,'Origin required');
    if((req.headers['content-type']??'').split(';')[0]!=='application/json')return end(415,'JSON required');
    if(session.active>=4)return end(429,JSON.stringify({error:'Too many local operations; retry shortly.'}));
    if(session.operations>=512)return end(429,JSON.stringify({error:'Local session operation limit reached; export edits and restart the preview.'}));
    session.active++;session.operations++;
    try {
     const request=await readJsonBody(req);const controller=new AbortController();const timer=setTimeout(()=>controller.abort(Error('Local operation timed out')),operationTimeoutMs);
     try {const result=await session.adapter.execute(request,controller.signal);return end(200,JSON.stringify(result));}finally{clearTimeout(timer);}
    }finally{session.active--;await sessions.status(datasetRoute[1]);}
   }catch(error){res.setHeader('Content-Type','application/json');return end(error.status??(error.code==='PREVIEW_LIMIT'?413:400),JSON.stringify({error:error.message}));}
  }
  if(req.method!=='GET'&&req.method!=='HEAD'){res.setHeader('Allow','GET, HEAD');return end(405,'Read-only preview');}
  try {
   const pathname=decodeURIComponent((req.url||'/').split('?')[0]);
   if(!pathname.startsWith('/')||pathname.includes('\\')||pathname.includes('\0'))return end(404,'Not found');
   if(pathname==='/__af_preview/export-runtime'){res.setHeader('Content-Type','application/json');return end(bundled?200:503,JSON.stringify(bundled??{error:'Use the downloaded HTTP author skill for bundled runtime export.'}));}
   if(pathname==='/__af_preview/source'){
    const requested=new URL(req.url,'http://preview.invalid').searchParams.get('path')??'/';
    if(!requested.startsWith('/')||requested.includes('\\')||requested.split('/').some(part=>part.startsWith('.'))||!(requested==='/'||/\.html?$/i.test(requested)))return end(400,'A local HTML page path is required');
    const file=resolve(base,requested==='/'?'index.html':requested.slice(1));const html=(await readPreviewFile(base,file)).toString('utf8');res.setHeader('Content-Type','application/json');return end(200,JSON.stringify({html,pathname:requested}));
   }
   if(pathname==='/__af_preview/revision'){res.setHeader('Content-Type','application/json');return end(200,JSON.stringify({revision:await revisions.current()}));}
   const source=bundled&&(pathname==='/af/v1/core.js'?bundled.core:pathname===bundled.readerPath?bundled.reader:pathname===bundled.apolloPath?bundled.apollo:undefined);
   if(source!==undefined){res.setHeader('Content-Type','text/javascript; charset=utf-8');res.setHeader('Content-Length',Buffer.byteLength(source));return end(200,source);}
   const segments=pathname.split('/');if(segments.some(part=>part.startsWith('.')))return end(404,'Not found');
   const isRuntime=runtime&&pathname.startsWith('/af/v1/');const selected=isRuntime?runtime:base;
   const requested=isRuntime?pathname.slice('/af/v1/'.length):pathname.slice(1);
   let file=resolve(selected,requested||'index.html');if(!inside(selected,file))return end(404,'Not found');
   file=await realpath(file);if(!inside(selected,file)||relative(selected,file).split(sep).some(part=>part.startsWith('.')))return end(404,'Not found');
   const info=await stat(file);if(!info.isFile())return end(404,'Not found');if(info.size>PREVIEW_LIMITS.maxFileBytes)throw new PreviewLimitError('Preview file exceeds 32 MiB; reduce the file or select a smaller project.');
   const type=types[extname(file).toLowerCase()]||(isRuntime?'text/javascript; charset=utf-8':'application/octet-stream');
   res.setHeader('Content-Type',type);
   if(type.startsWith('text/html')){const html=(await readPreviewFile(selected,file)).toString('utf8');const revision=await revisions.current({fresh:true});const local=await sessions.prepare(html,pathname,revision);const config=local?{pageId:'local:'+pathname,revision,backends:local.names,offline:true,localPreview:{endpoint:'/__af_preview/datasets/'+local.id,schema:local.schema}}:undefined;const body=previewHtml(html,changeNotice(revision,local?{endpoint:'/__af_preview/datasets/'+local.id,names:local.names}:undefined),config);res.setHeader('Content-Length',Buffer.byteLength(body));return end(200,body);}
   const bytes=await readPreviewFile(selected,file);res.setHeader('Content-Length',bytes.length);
   if(req.method==='HEAD')return end(200);
   end(200,bytes);
  }catch(error){res.removeHeader('Content-Length');if(error.code==='ENOENT'){const recovery=sessions.recover(decodeURIComponent((req.url??'/').split('?')[0]));if(recovery){res.setHeader('Content-Type','text/html; charset=utf-8');return end(409,previewHtml('<!doctype html><html><head><title>Local preview recovery</title></head><body><h1>Source file is unavailable</h1><p>Your local dataset edits are retained in this running helper. Export them before discarding this session.</p></body></html>',changeNotice('missing',{endpoint:'/__af_preview/datasets/'+recovery.id,names:recovery.names})));}}if(error.status){res.setHeader('Content-Type','application/json');return end(error.status,JSON.stringify({error:error.message}));}if(error.code==='PREVIEW_LIMIT'){res.removeHeader('Content-Length');res.setHeader('Content-Type','application/json');return end(413,JSON.stringify({error:error.message}));}if(req.url?.split('?')[0]==='/__af_preview/revision'){res.setHeader('Content-Type','application/json');return end(503,JSON.stringify({error:'Preview project is unavailable or changing; restore the selected directory and retry.'}));}return end(404,'Not found');}
 });
 server.maxConnections=16;server.requestTimeout=10000;server.headersTimeout=10000;server.on('close',()=>sessions.close());
 await new Promise((done,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',done);});
 return {server,url:`http://127.0.0.1:${server.address().port}/`,close:()=>new Promise((done,reject)=>server.close(error=>error?reject(error):done()))};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const args=process.argv.slice(2);const root=args.shift();let port=0,runtimeDir;
 try {
  if(!root||root.startsWith('--'))throw Error('Usage: node preview.mjs ROOT [--port PORT] [--runtime-dir DIR]');
  while(args.length){const flag=args.shift(),value=args.shift();if(!value)throw Error('Missing option value');if(flag==='--port')port=Number(value);else if(flag==='--runtime-dir')runtimeDir=value;else throw Error('Unknown option');}
  const session=await startPreview({root,port,runtimeDir});console.log(`Private local preview: ${session.url}\nStop with Ctrl-C. Only the selected directory is served; dataset edits stay in memory. No files are uploaded or written.`);
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{void session.close();});
 }catch(error){console.error(error.message);process.exitCode=1;}
}

async function readJsonBody(request){
 return await new Promise((done,reject)=>{
  const chunks=[];let size=0,finished=false;
  const timer=setTimeout(()=>finish(Object.assign(Error('Local request body timed out'),{status:408})),5000);
  function finish(error){if(finished)return;finished=true;clearTimeout(timer);request.removeListener('data',data);request.removeListener('end',end);request.removeListener('aborted',aborted);if(error){request.resume();reject(error);}else{try{const value=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!value||typeof value.query!=='string')throw Error('A GraphQL query string is required');done(value);}catch(error){reject(Object.assign(error,{status:400}));}}}
  function data(chunk){size+=chunk.length;if(size>65536)return finish(Object.assign(Error('Local request exceeds 64 KiB'),{status:413}));chunks.push(chunk);}
  function end(){finish();}function aborted(){finish(Object.assign(Error('Local request aborted'),{status:400}));}
  request.on('data',data);request.once('end',end);request.once('aborted',aborted);request.once('error',error=>finish(Object.assign(error,{status:400})));
 });
}
