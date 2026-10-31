#!/usr/bin/env node
/**
 * Internal: the private loopback preview server (startPreview); also a deprecated direct entry,
 * `node preview.mjs ROOT [--port PORT] [--runtime-dir DIR]` (prefer serve.mjs).
 * Contract: lib/skills/preview-contract.d.ts. Routes live in preview-dataset-route.mjs and
 * preview-source-routes.mjs; file helpers in preview-server-files.mjs.
 * Used by: serve.mjs, html-preview/author-toolbox/font-delivery/shared-skill-delivery tests,
 *   scripts/fixtures/local-preview.mjs.
 */
import {beforeCommand} from './toolbox-update.mjs';

import {realpathSync} from 'node:fs';
import {createServer} from 'node:http';
import {realpath,stat,writeFile,rename} from 'node:fs/promises';
import {resolve,relative,sep,extname,basename} from 'node:path';
import {pathToFileURL} from 'node:url';
import {platformModules} from './preview-platform.mjs';
import {createRevisionSource,changeNotice} from './preview-changes.mjs';
import {createPreviewSessions} from './preview-sessions.mjs';
import {previewHtml,formatAutofixReport,pageDesignSystem} from './preview-html.mjs';
import {readPreviewFile,PREVIEW_LIMITS,PreviewLimitError} from './preview-files.mjs';
import {types,platformFonts,inside,previewAutofix} from './preview-server-files.mjs';
import {DATASET_ROUTE,handleDatasetRoute} from './preview-dataset-route.mjs';
import {handleSourceRoute} from './preview-source-routes.mjs';
import configuredServer from './toolbox-config.mjs';

// No remote sources, frames, forms, workers or popup permissions. This is a
// browser resource policy, not an OS/network sandbox for hostile JavaScript.
export const PRIVATE_CSP =
  "default-src 'none'; script-src 'self' 'unsafe-inline' blob:; style-src 'self' 'unsafe-inline'; "+
  "img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' data: blob:; connect-src "+
  "'self'; frame-src 'none'; object-src 'none'; worker-src 'none'; base-uri 'self'; form-action "+
  "'none'; frame-ancestors 'none'; sandbox allow-scripts allow-same-origin allow-downloads";
/** Start a private loopback server; contract: lib/skills/preview-contract.d.ts.
 * `platformOrigin` (default: the archive's selected server; `fontOrigin` is its older name)
 * supplies the runtime, libraries, components and fonts (./preview-platform); a source
 * checkout's own build outputs come first. */
export async function startPreview({root,port=0,runtimeDir,platformOrigin,fontOrigin,
  libraryAssets,revisionIntervalMs=1000,sessionOptions={},operationTimeoutMs=5000,autofix={}}) {
if(!Number.isInteger(port)||port<0||port>65535)throw Error(
   'Port must be an integer from 0 to 65535');
const base=await realpath(resolve(root));if(!(await stat(base)).isDirectory())throw Error(
   'Root must be a directory');
 const origin=platformOrigin??fontOrigin??configuredServer??null;
 const platform=platformModules({origin,libraryAssets});
 const runtime=runtimeDir?await realpath(resolve(runtimeDir)):undefined;
 const platformFont=platformFonts(origin);
 // Only the page's own design system stylesheet, fetched on demand.
 const platformCss=html=>{const name=pageDesignSystem(html);
   return name?platform.systemCss(name):Promise.resolve(null);};
 const revisions=createRevisionSource(base,{intervalMs:revisionIntervalMs});
 const sessions=createPreviewSessions(base,sessionOptions);
 // One report per distinct served content of each page, not one per request.
 const reported=new Map();
 const served=async(file,html)=>{
  const result=previewAutofix(base,file,html),name=relative(base,file).split(sep).join('/');
const write=autofix.write&&result.changed;if(write){const temporary=
    file+'.autofix-'+process.pid+'.tmp';await writeFile(temporary,result.html);await rename(
    temporary,file);}
const report=formatAutofixReport(result,{file:name,landed:
    result.changed?write?`also written to ${basename(file)}`:
    'served fixed; file unchanged (run autofix.mjs to write)':undefined,routine:result.routine});
  if(autofix.report&&reported.get(file)!==html){reported.set(file,html);autofix.report(report);}
  return {...result,report};
 };
 const server=createServer(async(req,res)=>{
res.setHeader('Content-Security-Policy',PRIVATE_CSP);res.setHeader('Cache-Control','no-store');
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy',
    'no-referrer');res.setHeader('Cross-Origin-Resource-Policy','same-origin');
  const end=(status,body)=>{res.statusCode=status;res.end(req.method==='HEAD'?undefined:body);};
  if(req.headers.host!==`127.0.0.1:${server.address().port}`)return end(403,'Forbidden');
if(req.headers.origin&&req.headers.origin!==`http://${req.headers.host}`)return end(403,
    'Forbidden');
  // Dataset routes accept POST; everything else below is read-only.
  const datasetRoute=(req.url??'').split('?')[0].match(DATASET_ROUTE);
  if(datasetRoute)return handleDatasetRoute({req,res,end,route:datasetRoute,sessions,
    operationTimeoutMs});
if(req.method!=='GET'&&req.method!=='HEAD'){res.setHeader('Allow','GET, HEAD');return end(405,
    'Read-only preview');}
  try {
   const pathname=decodeURIComponent((req.url||'/').split('?')[0]);
if(!pathname.startsWith('/')||pathname.includes('\\')||pathname.includes('\0'))return end(404,
     'Not found');
if(pathname==='/__af_preview/export-runtime'){res.setHeader('Content-Type','application/json');
     try{return end(200,JSON.stringify(await platform.runtimeAssets()));}catch(error){
     return end(503,JSON.stringify({error:error.message+' (the preview loads the runtime from '+
     'the selected server; check the network or pass --runtime-dir)'}));}}
   const handled=await handleSourceRoute(pathname,{req,res,end,base,platform,platformFont,
     platformCss});
   if(handled!==null)return;
if(pathname==='/__af_preview/revision'){res.setHeader('Content-Type','application/json');return end(
     200,JSON.stringify({revision:await revisions.current()}));}
const font=await platformFont(pathname);if(font){res.setHeader('Content-Type','font/woff2');
     res.setHeader('Content-Length',font.length);return end(200,font);}
   // --runtime-dir replaces the server's runtime (/af/*), but not its hosted components.
   const module=!(runtime&&pathname.startsWith('/af/')&&!pathname.startsWith('/af/components/'))?
     await platform.module(pathname):null;
if(module){res.setHeader('Content-Type','text/javascript; charset=utf-8');res.setHeader(
     'Content-Length',module.length);return end(200,module);}
const segments=pathname.split('/');if(segments.some(part=>part.startsWith('.')))return end(404,
     'Not found');
   const isRuntime=runtime&&pathname.startsWith('/af/');const selected=isRuntime?runtime:base;
   const requested=isRuntime?pathname.slice('/af/'.length):pathname.slice(1);
let file=resolve(selected,requested||'index.html');if(!inside(selected,file))return end(404,
     'Not found');
file=await realpath(file);if(!inside(selected,file)||relative(selected,file).split(sep).some(part=>
     part.startsWith('.')))return end(404,'Not found');
const info=await stat(file);if(!info.isFile())return end(404,'Not found');if(
     info.size>PREVIEW_LIMITS.maxFileBytes)throw new PreviewLimitError(
     'Preview file exceeds 32 MiB; reduce the file or select a smaller project.');
const type=types[extname(file).toLowerCase()]||(isRuntime?'text/javascript; charset=utf-8':
     'application/octet-stream');
   res.setHeader('Content-Type',type);
if(type.startsWith('text/html')){const html=isRuntime?(await readPreviewFile(selected,
     file)).toString('utf8'):(await served(file,(await readPreviewFile(selected,file)).toString(
     'utf8'))).html;const revision=await revisions.current({fresh:true});const local=
     await sessions.prepare(html,pathname,revision);const config={pageId:'local:'+pathname,revision,
     backends:local?local.names:[],offline:true,libraries:await platform.importMap().catch(
     ()=>({})),...(local?{localPreview:{
     endpoint:'/__af_preview/datasets/'+local.id,schema:local.schema}}:{})};const body=previewHtml(
     html,changeNotice(revision,local?{endpoint:'/__af_preview/datasets/'+local.id,names:
local.names}:undefined),config,await platformCss(html).catch(()=>null));res.setHeader(
       'Content-Length',Buffer.byteLength(body));
     return end(200,body);}
   const bytes=await readPreviewFile(selected,file);res.setHeader('Content-Length',bytes.length);
   if(req.method==='HEAD')return end(200);
   end(200,bytes);
  }catch(error){
   res.removeHeader('Content-Length');
   // A served page vanished while its dataset session still holds edits: offer their export.
   if(error.code==='ENOENT'){const recovery=
    sessions.recover(decodeURIComponent((req.url??'/').split('?')[0]));if(recovery){res.setHeader(
    'Content-Type','text/html; charset=utf-8');return end(409,previewHtml(
    '<!doctype html><html><head><title>Local preview recovery</title></head><body><h1>Source file '+
    'is unavailable</h1><p>Your local dataset edits are retained in this running helper. Export '+
    'them before discarding this session.</p></body></html>',changeNotice('missing',{endpoint:
    '/__af_preview/datasets/'+recovery.id,names:recovery.names})));}}
   if(error.status){res.setHeader('Content-Type','application/json');return end(error.status,
    JSON.stringify({error:error.message}));}
   if(error.code==='PREVIEW_LIMIT'){res.removeHeader('Content-Length');
    res.setHeader('Content-Type','application/json');return end(413,JSON.stringify({error:
    error.message}));}
   if(req.url?.split('?')[0]==='/__af_preview/revision'){res.setHeader(
    'Content-Type','application/json');return end(503,JSON.stringify({error:
    'Preview project is unavailable or changing; restore the selected directory and retry.'}));}
   return end(404,'Not found');
  }
 });
server.maxConnections=16;server.requestTimeout=10000;server.headersTimeout=10000;server.on('close',(
   )=>sessions.close());
await new Promise((done,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',done);
   });
return {server,url:`http://127.0.0.1:${server.address().port}/`,close:()=>new Promise((done,
   reject)=>server.close(error=>error?reject(error):done()))};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(realpathSync(process.argv[1])).href){
if(await beforeCommand(import.meta.url,process.argv.slice(2)))process.exit(process.exitCode??0);
process.argv=process.argv.filter(arg=>arg!=='--no-update');
console.error('Deprecated preview.mjs; prefer serve.mjs PROJECT.');const args=process.argv.slice(2);
   if(args.length===1&&args[0]==='--help'){console.log(
   'Usage: node preview.mjs ROOT [--port PORT] [--runtime-dir DIR]\nServes only the selected '+
   'project on loopback. Stop with Ctrl-C.');process.exit(0);}
 const root=args.shift();let port=0,runtimeDir;
 try {
if(!root||root.startsWith('--'))throw Error(
    'Usage: node preview.mjs ROOT [--port PORT] [--runtime-dir DIR]');
while(args.length){const flag=args.shift(),value=args.shift();if(!value)throw Error(
    'Missing option value');if(flag==='--port')port=Number(value);else if(
    flag==='--runtime-dir')runtimeDir=value;else throw Error('Unknown option');}
const session=await startPreview({root,port,runtimeDir});console.log(
    `Private local preview: ${session.url}\nStop with Ctrl-C. Only the selected directory is `+
    `served; dataset edits stay in memory. No files are uploaded or written.`);
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{void session.close();});
 }catch(error){console.error(error.message);process.exitCode=1;}
}
