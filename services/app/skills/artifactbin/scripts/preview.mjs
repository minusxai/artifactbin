#!/usr/bin/env node
import {realpathSync} from 'node:fs';
import {runtimeAssetManifest} from './preview-runtime-assets.mjs';
import {libraryAssetManifest,libraryImportMap} from './preview-library-assets.mjs';
import {createServer} from 'node:http';
import {realpath,stat,lstat} from 'node:fs/promises';
import {resolve,relative,sep,extname} from 'node:path';
import {createRevisionSource,changeNotice} from './preview-changes.mjs';
import {createPreviewSessions} from './preview-sessions.mjs';
import {previewHtml,packPreviewExport,autofixHtml,formatAutofixReport,withPlatformStyles} from './preview-html.mjs';
import {statSync} from 'node:fs';
import {writeFile,rename} from 'node:fs/promises';
import {dirname,basename} from 'node:path';
import {readPreviewFile,PREVIEW_LIMITS,PreviewLimitError} from './preview-files.mjs';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {readFile,readdir} from 'node:fs/promises';
import configuredServer from './toolbox-config.mjs';

// No remote sources, frames, forms, workers or popup permissions. This is a
// browser resource policy, not an OS/network sandbox for hostile JavaScript.
export const PRIVATE_CSP = "default-src 'none'; script-src 'self' 'unsafe-inline' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' data: blob:; connect-src 'self'; frame-src 'none'; object-src 'none'; worker-src 'none'; base-uri 'self'; form-action 'none'; frame-ancestors 'none'; sandbox allow-scripts allow-same-origin allow-downloads";
const types={'.html':'text/html; charset=utf-8','.htm':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.webp':'image/webp','.avif':'image/avif','.woff2':'font/woff2','.woff':'font/woff','.mp4':'video/mp4','.csv':'text/csv; charset=utf-8','.txt':'text/plain; charset=utf-8'};
/**
 * The platform stylesheet's font files: /af/fonts/<name>.woff2 (and the legacy /fonts/<name>.<hash8>.woff2). A source
 * checkout reads the app's public/fonts; otherwise each file is fetched once from the selected server's /af/fonts/ (the
 * skill archive packages no fonts) and served from this origin, so the private CSP keeps font-src 'self'.
 */
const PLATFORM_FONT=/^\/(?:af\/fonts\/([a-z0-9-]+)\.woff2|fonts\/([a-z0-9-]+)\.[a-f0-9]{8}\.woff2)$/;
let checkoutFonts;
async function checkoutFont(name){
 const dir=new URL('../../../public/fonts/',import.meta.url);
 checkoutFonts??=readdir(fileURLToPath(dir)).catch(error=>{if(error.code==='ENOENT'||error.code==='ENOTDIR')return [];throw error;});
 const file=(await checkoutFonts).find(entry=>entry.startsWith(name+'.')&&/^\.[a-f0-9]{8}\.woff2$/.test(entry.slice(name.length)));
 return file?await readFile(fileURLToPath(new URL(file,dir))):null;
}
function platformFonts(origin){
 const fetched=new Map();
 return async pathname=>{
  const match=PLATFORM_FONT.exec(pathname);if(!match)return null;
  const name=match[1]??match[2],local=await checkoutFont(name);if(local)return local;
  if(!origin)return null;
  if(!fetched.has(name))fetched.set(name,(async()=>{
   const response=await fetch(new URL(`/af/fonts/${name}.woff2`,origin),{redirect:'error',signal:AbortSignal.timeout(10000)});
   if(!response.ok)return null;
   const bytes=Buffer.from(await response.arrayBuffer());
   if(bytes.length>4_000_000||bytes.subarray(0,4).toString('latin1')!=='wOF2')throw Error('Unexpected platform font response');
   return bytes;
  })().catch(error=>{fetched.delete(name);throw error;}));
  return fetched.get(name);
 };
}
const inside=(root,path)=>{const tail=relative(root,path);return tail===''||(!tail.startsWith('..'+sep)&&tail!=='..'&&!tail.startsWith(sep));};
/** Start a private loopback server; contract: lib/skills/preview-contract.d.ts. */
/** Autofix (lib/html-autofix) on the bytes a page is served with; the file changes only when `write` is chosen. */
function previewAutofix(base,file,html){
 return autofixHtml(html,{exists:relative=>{const full=resolve(dirname(file),relative);if(!inside(base,full))return false;try{return statSync(full).isFile();}catch{return false;}}});
}
export async function startPreview({root,port=0,runtimeDir,fontOrigin=configuredServer,libraryAssets,revisionIntervalMs=1000,sessionOptions={},operationTimeoutMs=5000,autofix={}}) {
 if(!Number.isInteger(port)||port<0||port>65535)throw Error('Port must be an integer from 0 to 65535');
 const base=await realpath(resolve(root));if(!(await stat(base)).isDirectory())throw Error('Root must be a directory');
 // Generated only in the downloadable archive; optional in a source checkout.
 const runtimeModule=new URL('./preview-runtime.mjs',import.meta.url).href;
 let bundled;try{bundled=(await import(runtimeModule)).default;}catch(error){if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;}
 const runtimeAssets=bundled?runtimeAssetManifest(bundled):new Map();
 let libraries=libraryAssets;
 if(!libraries){try{libraries=(await import(new URL('./preview-libraries.mjs',import.meta.url).href)).default;}catch(error){if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;}}
 const publicLibraries=libraryAssetManifest(libraries??{}),libraryImports=libraryImportMap(publicLibraries);
 const runtime=runtimeDir?await realpath(resolve(runtimeDir)):undefined;
 if(fontOrigin!==null&&fontOrigin!==undefined&&!/^https?:$/.test(new URL(fontOrigin).protocol))throw Error('Font origin must be http(s)');
 const platformFont=platformFonts(fontOrigin??null);
 const revisions=createRevisionSource(base,{intervalMs:revisionIntervalMs});
 const sessions=createPreviewSessions(base,sessionOptions);
 // One report per distinct served content of each page, not one per request.
 const reported=new Map();
 const served=async(file,html)=>{
  const result=previewAutofix(base,file,html),name=relative(base,file).split(sep).join('/');
  const write=autofix.write&&result.changed;if(write){const temporary=file+'.autofix-'+process.pid+'.tmp';await writeFile(temporary,result.html);await rename(temporary,file);}
  const report=formatAutofixReport(result,{file:name,landed:result.changed?write?`also written to ${basename(file)}`:'served fixed; file unchanged (run autofix.mjs to write)':undefined,routine:result.routine});
  if(autofix.report&&reported.get(file)!==html){reported.set(file,html);autofix.report(report);}
  return {...result,report};
 };
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
   if(pathname==='/__af_preview/export-source'){
    const requested=new URL(req.url,'http://preview.invalid').searchParams.get('path')??'/';
    if(!requested.startsWith('/')||requested.includes('\\')||requested.split('/').some(part=>part.startsWith('.'))||!(requested==='/'||/\.html?$/i.test(requested)))return end(400,'A local HTML page path is required');
    const selected=requested==='/'?'/index.html':requested;
    const load=async name=>{
     if(publicLibraries.has(name))return {contentType:'text/javascript',bytes:Buffer.from(publicLibraries.get(name))};
     const font=await platformFont(name);if(font)return {contentType:'font/woff2',bytes:font};
     const decoded=decodeURIComponent(name);if(!decoded.startsWith('/')||decoded.includes('\\')||decoded.includes('\0')||decoded.split('/').some(part=>part.startsWith('.')))throw Error('Invalid local export path');
     try{let target=base;for(const part of decoded.slice(1).split('/')){target=resolve(target,part);if(!inside(base,target)||(await lstat(target)).isSymbolicLink())throw Error('Symlink or escaping local export dependency refused: '+name);}
      return {contentType:types[extname(target).toLowerCase()]??'application/octet-stream',bytes:await readPreviewFile(base,target)};
     }catch(error){if(error.code==='ENOENT')throw Error('Missing local dependency: '+name);throw error;}
    };
    try{const source=await load(selected),html=source.bytes.toString('utf8'),renderedHtml=await packPreviewExport({html:withPlatformStyles(html),pathname:selected,load,libraries:libraryImports});res.setHeader('Content-Type','application/json');return end(200,JSON.stringify({html,renderedHtml,pathname:requested}));}
    catch(error){res.setHeader('Content-Type','application/json');return end(error.code==='PREVIEW_LIMIT'?413:422,JSON.stringify({error:'Local export failed: '+(error.code==='ENOENT'?'a project dependency is missing':error.message)}));}
   }
   if(pathname==='/__af_preview/source'){
    const requested=new URL(req.url,'http://preview.invalid').searchParams.get('path')??'/';
    if(!requested.startsWith('/')||requested.includes('\\')||requested.split('/').some(part=>part.startsWith('.'))||!(requested==='/'||/\.html?$/i.test(requested)))return end(400,'A local HTML page path is required');
    const file=resolve(base,requested==='/'?'index.html':requested.slice(1));const html=(await readPreviewFile(base,file)).toString('utf8');res.setHeader('Content-Type','application/json');return end(200,JSON.stringify({html,pathname:requested}));
   }
   if(pathname==='/__af_preview/autofix'){
    const requested=new URL(req.url,'http://preview.invalid').searchParams.get('path')??'/';
    if(!requested.startsWith('/')||requested.includes('\\')||requested.split('/').some(part=>part.startsWith('.'))||!(requested==='/'||/\.html?$/i.test(requested)))return end(400,'A local HTML page path is required');
    const file=resolve(base,requested==='/'?'index.html':requested.slice(1));const result=previewAutofix(base,file,(await readPreviewFile(base,file)).toString('utf8'));res.setHeader('Content-Type','application/json');
    return end(200,JSON.stringify({clean:!result.fixes.length&&!result.problems.length,fixes:result.fixes,problems:result.problems,routine:result.routine,file:requested}));
   }
   if(pathname==='/__af_preview/revision'){res.setHeader('Content-Type','application/json');return end(200,JSON.stringify({revision:await revisions.current()}));}
   const font=await platformFont(pathname);if(font){res.setHeader('Content-Type','font/woff2');res.setHeader('Content-Length',font.length);return end(200,font);}
   const source=runtimeAssets.get(pathname)??publicLibraries.get(pathname);
   if(source!==undefined){res.setHeader('Content-Type','text/javascript; charset=utf-8');res.setHeader('Content-Length',Buffer.byteLength(source));return end(200,source);}
   const segments=pathname.split('/');if(segments.some(part=>part.startsWith('.')))return end(404,'Not found');
   const isRuntime=runtime&&pathname.startsWith('/af/');const selected=isRuntime?runtime:base;
   const requested=isRuntime?pathname.slice('/af/'.length):pathname.slice(1);
   let file=resolve(selected,requested||'index.html');if(!inside(selected,file))return end(404,'Not found');
   file=await realpath(file);if(!inside(selected,file)||relative(selected,file).split(sep).some(part=>part.startsWith('.')))return end(404,'Not found');
   const info=await stat(file);if(!info.isFile())return end(404,'Not found');if(info.size>PREVIEW_LIMITS.maxFileBytes)throw new PreviewLimitError('Preview file exceeds 32 MiB; reduce the file or select a smaller project.');
   const type=types[extname(file).toLowerCase()]||(isRuntime?'text/javascript; charset=utf-8':'application/octet-stream');
   res.setHeader('Content-Type',type);
   if(type.startsWith('text/html')){const html=isRuntime?(await readPreviewFile(selected,file)).toString('utf8'):(await served(file,(await readPreviewFile(selected,file)).toString('utf8'))).html;const revision=await revisions.current({fresh:true});const local=await sessions.prepare(html,pathname,revision);const config={pageId:'local:'+pathname,revision,backends:local?local.names:[],offline:true,libraries:libraryImports,...(local?{localPreview:{endpoint:'/__af_preview/datasets/'+local.id,schema:local.schema}}:{})};const body=previewHtml(html,changeNotice(revision,local?{endpoint:'/__af_preview/datasets/'+local.id,names:local.names}:undefined),config);res.setHeader('Content-Length',Buffer.byteLength(body));return end(200,body);}
   const bytes=await readPreviewFile(selected,file);res.setHeader('Content-Length',bytes.length);
   if(req.method==='HEAD')return end(200);
   end(200,bytes);
  }catch(error){res.removeHeader('Content-Length');if(error.code==='ENOENT'){const recovery=sessions.recover(decodeURIComponent((req.url??'/').split('?')[0]));if(recovery){res.setHeader('Content-Type','text/html; charset=utf-8');return end(409,previewHtml('<!doctype html><html><head><title>Local preview recovery</title></head><body><h1>Source file is unavailable</h1><p>Your local dataset edits are retained in this running helper. Export them before discarding this session.</p></body></html>',changeNotice('missing',{endpoint:'/__af_preview/datasets/'+recovery.id,names:recovery.names})));}}if(error.status){res.setHeader('Content-Type','application/json');return end(error.status,JSON.stringify({error:error.message}));}if(error.code==='PREVIEW_LIMIT'){res.removeHeader('Content-Length');res.setHeader('Content-Type','application/json');return end(413,JSON.stringify({error:error.message}));}if(req.url?.split('?')[0]==='/__af_preview/revision'){res.setHeader('Content-Type','application/json');return end(503,JSON.stringify({error:'Preview project is unavailable or changing; restore the selected directory and retry.'}));}return end(404,'Not found');}
 });
 server.maxConnections=16;server.requestTimeout=10000;server.headersTimeout=10000;server.on('close',()=>sessions.close());
 await new Promise((done,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',done);});
 return {server,url:`http://127.0.0.1:${server.address().port}/`,close:()=>new Promise((done,reject)=>server.close(error=>error?reject(error):done()))};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(realpathSync(process.argv[1])).href){
 console.error('Deprecated preview.mjs; prefer serve.mjs PROJECT.');const args=process.argv.slice(2);if(args.length===1&&args[0]==='--help'){console.log('Usage: node preview.mjs ROOT [--port PORT] [--runtime-dir DIR]\nServes only the selected project on loopback. Stop with Ctrl-C.');process.exit(0);}const root=args.shift();let port=0,runtimeDir;
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
