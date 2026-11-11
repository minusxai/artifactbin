/**
 * Internal: the private loopback preview server (startPreview); serve.mjs is its command.
 * Contract: lib/skills/preview-contract.d.ts. Routes live in preview-source-routes.mjs; file
 * helpers in preview-server-files.mjs.
 * Used by: serve.mjs, html-preview/author-toolbox/font-delivery/shared-skill-delivery tests,
 *   scripts/fixtures/local-preview.mjs.
 */
import {createServer} from 'node:http';
import {realpath,stat,writeFile,rename} from 'node:fs/promises';
import {resolve,relative,sep,extname,basename} from 'node:path';
import {platformModules} from './preview-platform.mjs';
import {createRevisionSource,changeNotice} from './preview-changes.mjs';
import {previewHtml,formatAutofixReport,pageDesignSystem} from './preview-html.mjs';
import {readPreviewFile,PREVIEW_LIMITS,PreviewLimitError} from './preview-files.mjs';
import {types,platformFonts,platformBoundaries,inside,previewAutofix} from
  './preview-server-files.mjs';
import {handleSourceRoute} from './preview-source-routes.mjs';
import configuredServer from './toolbox-config.mjs';

// No remote sources, frames, forms, workers or popup permissions. This is a
// browser resource policy, not an OS/network sandbox for hostile JavaScript.
const PRIVATE_CSP =
  "default-src 'none'; script-src 'self' 'unsafe-inline' blob:; style-src 'self' 'unsafe-inline'; "+
  "img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' data: blob:; connect-src "+
  "'self'; frame-src 'none'; object-src 'none'; worker-src 'none'; base-uri 'self'; form-action "+
  "'none'; frame-ancestors 'none'; sandbox allow-scripts allow-same-origin allow-downloads";
/** Start a private loopback server; contract: lib/skills/preview-contract.d.ts.
 * `platformOrigin` (default: the archive's selected server)
 * supplies the runtime, libraries, components, fonts and boundaries (./preview-platform); a source
 * checkout's own build outputs come first. */
export async function startPreview({root,port=0,platformOrigin,
  libraryAssets,revisionIntervalMs=1000,autofix={}}) {
if(!Number.isInteger(port)||port<0||port>65535)throw Error(
   'Port must be an integer from 0 to 65535');
const base=await realpath(resolve(root));if(!(await stat(base)).isDirectory())throw Error(
   'Root must be a directory');
 const origin=platformOrigin??configuredServer??null;
 const platform=platformModules({origin,libraryAssets});
 const platformFont=platformFonts(origin),platformBoundary=platformBoundaries(origin);
 // Only the page's own design system stylesheet, fetched on demand.
 const platformCss=html=>{const name=pageDesignSystem(html);
   return name?platform.systemCss(name):Promise.resolve(null);};
 const revisions=createRevisionSource(base,{intervalMs:revisionIntervalMs});
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
if(req.method!=='GET'&&req.method!=='HEAD'){res.setHeader('Allow','GET, HEAD');return end(405,
    'Read-only preview');}
  try {
   const pathname=decodeURIComponent((req.url||'/').split('?')[0]);
if(!pathname.startsWith('/')||pathname.includes('\\')||pathname.includes('\0'))return end(404,
     'Not found');
if(pathname==='/__af_preview/export-runtime'){res.setHeader('Content-Type','application/json');
     try{return end(200,JSON.stringify(await platform.runtimeAssets()));}catch(error){
     return end(503,JSON.stringify({error:error.message+' (the preview loads the runtime from '+
     'the selected server; check the network)'}));}}
   const handled=await handleSourceRoute(pathname,{req,res,end,base,platform,platformFont,
     platformCss});
   if(handled!==null)return;
if(pathname==='/__af_preview/revision'){res.setHeader('Content-Type','application/json');return end(
     200,JSON.stringify({revision:await revisions.current()}));}
const font=await platformFont(pathname);if(font){res.setHeader('Content-Type','font/woff2');
     res.setHeader('Content-Length',font.length);return end(200,font);}
   const boundary=await platformBoundary(pathname);if(boundary){res.setHeader('Content-Type',
     'application/json');res.setHeader('Content-Length',boundary.length);return end(200,boundary);}
   const module=await platform.module(pathname);
if(module){res.setHeader('Content-Type','text/javascript; charset=utf-8');res.setHeader(
     'Content-Length',module.length);return end(200,module);}
const segments=pathname.split('/');if(segments.some(part=>part.startsWith('.')))return end(404,
     'Not found');
let file=resolve(base,pathname.slice(1)||'index.html');if(!inside(base,file))return end(404,
     'Not found');
file=await realpath(file);if(!inside(base,file)||relative(base,file).split(sep).some(part=>
     part.startsWith('.')))return end(404,'Not found');
const info=await stat(file);if(!info.isFile())return end(404,'Not found');if(
     info.size>PREVIEW_LIMITS.maxFileBytes)throw new PreviewLimitError(
     'Preview file exceeds 32 MiB; reduce the file or select a smaller project.');
const type=types[extname(file).toLowerCase()]||'application/octet-stream';
   res.setHeader('Content-Type',type);
if(type.startsWith('text/html')){const html=(await served(file,(await readPreviewFile(base,
     file)).toString('utf8'))).html;const revision=await revisions.current({fresh:true});
     const config={pageId:'local:'+pathname,revision,backends:[],offline:true,libraries:
     await platform.importMap().catch(()=>({}))};const body=previewHtml(html,changeNotice(
     revision),config,await platformCss(html).catch(()=>null));
     res.setHeader('Content-Length',Buffer.byteLength(body));return end(200,body);}
   const bytes=await readPreviewFile(base,file);res.setHeader('Content-Length',bytes.length);
   if(req.method==='HEAD')return end(200);
   end(200,bytes);
  }catch(error){
   res.removeHeader('Content-Length');
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
server.maxConnections=16;server.requestTimeout=10000;server.headersTimeout=10000;
await new Promise((done,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',done);
   });
return {server,url:`http://127.0.0.1:${server.address().port}/`,close:()=>new Promise((done,
   reject)=>server.close(error=>error?reject(error):done()))};
}
