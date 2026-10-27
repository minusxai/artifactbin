/**
 * Internal: the preview server's page-source endpoints: /__af_preview/export-source (self-contained
 * export), /__af_preview/source (raw page HTML) and /__af_preview/autofix (autofix report).
 * Used by: preview.mjs.
 */
import {lstat} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {packPreviewExport,withPlatformStyles} from './preview-html.mjs';
import {readPreviewFile} from './preview-files.mjs';
import {types,inside,previewAutofix} from './preview-server-files.mjs';

/**
 * Answer a page-source request, or return null when `pathname` is not one of these routes.
 * ctx: {req,res,end,base,platform,platformFont,platformCss}.
 */
export async function handleSourceRoute(pathname,ctx){
 const {req,res,end,base,platform,platformFont,platformCss}=ctx;
   if(pathname==='/__af_preview/export-source'){
    const requested=new URL(req.url,'http://preview.invalid').searchParams.get('path')??'/';
if(!requested.startsWith('/')||requested.includes('\\')||requested.split('/').some(part=>
      part.startsWith('.'))||!(requested==='/'||/\.html?$/i.test(requested)))return end(400,
      'A local HTML page path is required');
    const selected=requested==='/'?'/index.html':requested;
    // Resolves each dependency the exporter asks for: platform modules, fonts, then project files.
    const load=async name=>{
     const module=await platform.module(name);
     if(module)return {contentType:'text/javascript',bytes:module};
     const font=await platformFont(name);if(font)return {contentType:'font/woff2',bytes:font};
const decoded=decodeURIComponent(name);if(!decoded.startsWith('/')||decoded.includes('\\')||
       decoded.includes('\0')||decoded.split('/').some(part=>part.startsWith('.')))throw Error(
       'Invalid local export path');
     // Walk segment by segment so no symlink anywhere on the path is followed.
try{let target=base;for(const part of decoded.slice(1).split('/')){target=resolve(target,part);if(
       !inside(base,target)||(await lstat(target)).isSymbolicLink())throw Error(
       'Symlink or escaping local export dependency refused: '+name);}
return {contentType:types[extname(target).toLowerCase()]??'application/octet-stream',bytes:
        await readPreviewFile(base,target)};
     }catch(error){if(error.code==='ENOENT')throw Error('Missing local '+
       'dependency: '+name);throw error;}
    };
try{const source=await load(selected),html=source.bytes.toString('utf8'),renderedHtml=
      await packPreviewExport({html:withPlatformStyles(html,await platformCss(html)),
pathname:selected,load,libraries:await platform.importMap()});res.setHeader('Content-Type',
        'application/json');return end(200,
      JSON.stringify({html,renderedHtml,pathname:requested}));}
catch(error){res.setHeader('Content-Type','application/json');return end(
      error.code==='PREVIEW_LIMIT'?413:422,JSON.stringify({error:'Local export failed: '+(
      error.code==='ENOENT'?'a project dependency is missing':error.message)}));}
   }
   if(pathname==='/__af_preview/source'){
    const requested=new URL(req.url,'http://preview.invalid').searchParams.get('path')??'/';
if(!requested.startsWith('/')||requested.includes('\\')||requested.split('/').some(part=>
      part.startsWith('.'))||!(requested==='/'||/\.html?$/i.test(requested)))return end(400,
      'A local HTML page path is required');
const file=resolve(base,requested==='/'?'index.html':requested.slice(1));const html=(
      await readPreviewFile(base,file)).toString('utf8');res.setHeader('Content-Type',
      'application/json');return end(200,JSON.stringify({html,pathname:requested}));
   }
   if(pathname==='/__af_preview/autofix'){
    const requested=new URL(req.url,'http://preview.invalid').searchParams.get('path')??'/';
if(!requested.startsWith('/')||requested.includes('\\')||requested.split('/').some(part=>
      part.startsWith('.'))||!(requested==='/'||/\.html?$/i.test(requested)))return end(400,
      'A local HTML page path is required');
const file=resolve(base,requested==='/'?'index.html':requested.slice(1));const result=
      previewAutofix(base,file,(await readPreviewFile(base,file)).toString('utf8'));res.setHeader(
      'Content-Type','application/json');
return end(200,JSON.stringify({clean:!result.fixes.length&&!result.problems.length,fixes:
      result.fixes,problems:result.problems,routine:result.routine,file:requested}));
   }
 return null;
}
