import type {RenderUploadRequest,RenderUploadResult} from '@artifactbin/contracts';
export interface UploadOptions { origin:string; prefix:string; proxyUrl?:string }
export const MAX_EXPORT_BYTES=64*1024*1024;
export function admittedUploadUrl(raw:string,options:Pick<UploadOptions,'origin'|'prefix'>):URL {
  const url=new URL(raw),origin=new URL(options.origin);
  const path=decodeURIComponent(url.pathname);
  if(url.origin!==origin.origin||url.username||url.password||url.hash||raw.length>16384
    ||!['http:','https:'].includes(url.protocol)||!options.prefix.startsWith('/')||!options.prefix.endsWith('/')
    ||!path.startsWith(options.prefix)||path.split('/').some(part=>part==='.'||part==='..')||path.includes('\\'))throw new Error('Export upload destination refused');
  return url;
}
/** The renderer supplies bytes; this transport never exposes its grant to the page. */
export async function uploadImage(target:RenderUploadRequest['upload'],bytes:Uint8Array,options:UploadOptions,timeoutMs=15_000):Promise<void>{
  if(timeoutMs<=0)throw new Error('Export upload deadline');
  const url=admittedUploadUrl(target.url,options);
  if(!bytes.byteLength||bytes.byteLength>MAX_EXPORT_BYTES||!['image/png','image/jpeg'].includes(target.contentType))throw new Error('Export upload refused');
  const destination=options.proxyUrl ? new URL(url.pathname+url.search,options.proxyUrl) : url;
  try {
    const response=await fetch(destination,{method:'PUT',redirect:'manual',signal:AbortSignal.timeout(Math.min(15_000,Math.ceil(timeoutMs))),
      headers:{'content-type':target.contentType,...(options.proxyUrl?{'x-upload-origin':url.origin}:{})},body:new Uint8Array(bytes)});
    await response.body?.cancel();
    if(!response.ok)throw new Error('upload failed');
  } catch {throw new Error('Export upload failed');}
}
export type UploadedImage = Extract<RenderUploadResult,{ok:true}>;
