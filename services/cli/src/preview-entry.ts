import {renderSocialPreviewImage} from '../../app/lib/story/social-preview-image.server';
import {socialPreviewCrop,socialPreviewImage} from '../../app/lib/story/social-preview';
import {CARD_WIDTH,CARD_HEIGHT} from '../../app/lib/export-card';
import {createBrowser} from '@artifactbin/browser/local';
import {chromiumExecutable} from './standalone-browser';
import type {LocalImageOptions} from './local-image-options';
import {localIdentities} from './identities';
/** Foreground file-session entry, loaded only after choosing the preview runtime. */
import {join,resolve} from 'node:path';
import {networkInterfaces} from 'node:os';
import {startPreview} from './preview/session';
import {previewFiles,type PreviewOptions} from './preview-options';
import {loadWorkspace} from './workspace';
import {loadConnection,exportedServer,DEFAULT_SERVER} from './config';
import {HttpClient} from './http';
import {inferColumns} from '@artifactbin/utils/shape';
import {CliError} from './errors';

async function openPreview(options:PreviewOptions,assets:string,capture=false){
 const workspace=await loadWorkspace(options.cwd,options.home);
 const localFiles=await localIdentities(workspace);
 const files=await previewFiles(workspace.root,workspace.cwd,options.paths.map(path=>localFiles[path]?resolve(workspace.root,localFiles[path]):path));
 const origin=options.server??workspace.tracking?.server??await exportedServer(options.home)??DEFAULT_SERVER;
 if(workspace.tracking&&origin!==workspace.tracking.server)throw new CliError('wrong_server','Preview must use the workspace’s bound host.');
 let client:HttpClient|undefined;
 const remote=async()=>{
  if(client)return client;
  const connection=await loadConnection(origin,options.home);
  if(!connection)throw new CliError('auth_required',`Sign in to ${origin} with afbin auth before reading its references.`);
  return client=new HttpClient({connection,home:options.home,account:workspace.tracking?.account,readOnly:true});
 };
 // Runtime CSS/font preparation reads packaged assets relative to the runtime root.
 process.chdir(resolve(assets));
 const session=await startPreview({root:workspace.root,home:options.home,files,localFiles,assets:join(assets,'preview'),publicAssets:join(assets,'public'),port:options.port,share:options.share,origin,capture,
  asset:async id=>(await remote()).content(`/artifacts/${id}/content`),
  dataset:async id=>{
   const content=await(await remote()).content(`/artifacts/${id}/content`);
   if(!content.contentType.includes('application/json'))throw new CliError('unsupported_preview_input','This remote dataset does not provide stored rows for local preview.');
   const rows=JSON.parse(content.bytes.toString());
   if(!Array.isArray(rows)||!rows.every(row=>row&&typeof row==='object'&&!Array.isArray(row)))throw new CliError('invalid_dataset','The remote dataset did not return row objects.');
   return {rows,columns:inferColumns(rows)};
  }});
 return {session,files};
}
export async function startPreviewHost(options:PreviewOptions,assets:string):Promise<void>{
 const {session,files}=await openPreview(options,assets);
 const port=new URL(session.url).port;
 const urls=[session.url,...(options.share?Object.values(networkInterfaces()).flatMap(list=>(list??[]).filter(address=>!address.internal&&address.family==='IPv4').map(address=>`http://${address.address}:${port}`)):[])];
 process.stdout.write(options.json?JSON.stringify({url:session.url,urls,files})+'\n':`Preview: ${urls.join('\n         ')}\nPress Ctrl-C to stop.\n`);
 await new Promise<void>(resolve=>{
  const stop=()=>{process.off('SIGINT',stop);process.off('SIGTERM',stop);resolve();};
  process.on('SIGINT',stop);process.on('SIGTERM',stop);
 });
 await session.close();
}

/** Same local resolution and document runtime as preview, with no editor or write endpoints. */
export async function exportPreviewImage(options:LocalImageOptions,assets:string):Promise<Buffer>{
 const {session}=await openPreview({...options,paths:[resolve(options.cwd,options.path)],port:0,share:false,json:false},assets,true);
 const browser=createBrowser({executablePath:chromiumExecutable});
 try{
  const document=await session.document(options.path);
  const cover=options.og?socialPreviewImage(document.body):null;
  if(cover){
   const response=await fetch(session.url+'/remote/'+cover);
   if(!response.ok||!response.headers.get('content-type')?.startsWith('image/'))throw new CliError('render_failed','The selected cover image could not be read.');
   return renderSocialPreviewImage(Buffer.from(await response.arrayBuffer()),document.body,options.format);
  }
  const result=await browser.render({url:session.url+'/?capture=1',format:options.format,viewport:options.og?{width:CARD_WIDTH,height:CARD_HEIGHT}:{width:1200,height:630},selector:'[data-afbin-export-ready] [data-mx-story-root]',capture:options.page?{slide:options.page}:options.og?{card:socialPreviewCrop(document.body)}:'full',sameOriginOnly:true,waitForManagedFrames:true,timeoutMs:30000});
  const failure=session.failure();if(failure)throw new CliError('render_failed',failure);
  if(!result.ok)throw new CliError(result.reason==='no_slide'?'slide_not_found':'render_failed',result.reason==='no_slide'?`Document has ${result.slides} slides.`:result.detail??'Local image rendering failed.');
  return Buffer.from(result.bytes);
 }finally{try{await browser.close();}finally{await session.close();}}
}
