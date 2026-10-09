import {renderSocialPreviewImage} from '../../app/lib/cli-toolkit/host.server';
import {socialPreviewCrop,socialPreviewImage} from '../../app/lib/cli-toolkit';
import {previewRenderRequest} from './preview-render';
import {createBrowser} from '@artifactbin/browser/local';
import {chromiumExecutable} from './chromium';
import type {LocalImageOptions} from './local-image-options';
import {localIdentities} from './identities';
/** Foreground file-session entry, loaded only after choosing the preview runtime. */
import {join,resolve} from 'node:path';
import {networkInterfaces} from 'node:os';
import {startPreview} from './preview/session';
import {previewFiles,type PreviewOptions} from './preview-options';
import {loadWorkspace} from './workspace';
import {DEFAULT_SERVER} from './config';
import {CliError} from './errors';

async function openPreview(options:PreviewOptions,assets:string,capture=false){
 const workspace=await loadWorkspace(options.cwd,options.home);
 const localFiles=await localIdentities(workspace);
 const files=options.paths.length?await previewFiles(workspace.root,workspace.cwd,options.paths.map(path=>localFiles[path]?resolve(workspace.root,localFiles[path]):path)):[];
 const origin=options.server??workspace.tracking?.server??DEFAULT_SERVER;
 // Runtime CSS/font preparation reads packaged assets relative to the runtime root.
 process.chdir(resolve(assets));
 const session=await startPreview({root:workspace.root,home:options.home,files,localFiles,assets:join(assets,'preview'),publicAssets:join(assets,'public'),port:options.port,share:options.share,publicUrl:options.publicUrl,origin,capture,
  asset:async id=>{throw new CliError('unresolved_reference',`Reference ${id} is not available in this workspace. Add or import its local copy before previewing.`);},
  dataset:async id=>{throw new CliError('unresolved_reference',`Dataset ${id} is not available in this workspace. Add or import its local copy before previewing.`);}});
 return {session,files};
}
export async function startPreviewHost(options:PreviewOptions,assets:string):Promise<void>{
 const {session,files}=await openPreview(options,assets);
 const port=new URL(session.url).port;
 const urls=[...(options.publicUrl?[options.publicUrl]:[]),session.url,...(options.share?Object.values(networkInterfaces()).flatMap(list=>(list??[]).filter(address=>!address.internal&&address.family==='IPv4').map(address=>`http://${address.address}:${port}`)):[])];
 process.stdout.write(options.json?JSON.stringify({url:options.publicUrl??session.url,urls,files})+'\n':`Preview: ${urls.join('\n         ')}\nPress Ctrl-C to stop.\n`);
 let stop!:()=>void;
 try{
  await new Promise<void>(resolve=>{
   stop=()=>resolve();
   process.on('SIGINT',stop);process.on('SIGTERM',stop);
  });
  await session.close();
 }finally{process.off('SIGINT',stop);process.off('SIGTERM',stop);}

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
  const result=await browser.render(previewRenderRequest({url:session.url,source:document.body,format:options.format,...(options.page?{page:options.page}:{}),...(options.og?{card:socialPreviewCrop(document.body)}:{})}));
  const failure=session.failure();if(failure)throw new CliError('render_failed',failure);
  if(!result.ok)throw new CliError(result.reason==='no_slide'?'slide_not_found':'render_failed',result.reason==='no_slide'?`Document has ${result.slides} slides.`:result.detail??'Local image rendering failed.');
  return Buffer.from(result.bytes);
 }finally{try{await browser.close();}finally{await session.close();}}
}

export {exportLocalHtml} from './local-html';
