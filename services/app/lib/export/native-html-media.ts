import {parse,type DefaultTreeAdapterMap} from 'parse5';
import {rewriteHtmlAssetUrls} from '@/lib/html-page';
/** Original publication admission and the current reader's asset ACL are both
 * required. The loader returns bytes, never a capability or credential URL. */
interface OfflineHtmlImage {bytes:Uint8Array;mime:string}
export interface OfflineHtmlMediaInput {
 html:string;
 admittedIds:readonly string[];
 loadImage:(id:string)=>Promise<OfflineHtmlImage|null>;
 maxBytes:number;
}
export class OfflineHtmlMediaError extends Error {
 constructor(readonly reason:'unavailable'|'too_large'|'unsupported_type'){super(reason)}
}
const MIME=new Set(['image/png','image/jpeg','image/gif','image/webp','image/avif']);
/** Portable raster images only; authored data images and inline SVG stay intact. */
export async function packOfflineHtmlImages(input:OfflineHtmlMediaInput):Promise<string>{
 const urls=new Map<string,string>();const ids=new Set<string>();
 const visit=(node:DefaultTreeAdapterMap['node']):void=>{
  if('tagName' in node){
   const name=node.tagName==='img'||node.tagName==='source'?'src':node.tagName==='video'?'poster':null;
   const value=name&&node.attrs.find(attr=>attr.name===name)?.value;
   if(value&&/^ref:[A-Za-z0-9]{6,12}$/.test(value))ids.add(value.slice(4));
  }
  if('childNodes' in node)for(const child of node.childNodes)visit(child);
 };visit(parse(input.html));
 for(const id of ids){
  if(!input.admittedIds.includes(id))throw new OfflineHtmlMediaError('unavailable');
  const image=await input.loadImage(id);if(!image)throw new OfflineHtmlMediaError('unavailable');
  const mime=image.mime.toLowerCase();if(!MIME.has(mime))throw new OfflineHtmlMediaError('unsupported_type');
  if(image.bytes.byteLength*4/3>input.maxBytes)throw new OfflineHtmlMediaError('too_large');
  const data=`data:${mime};base64,${Buffer.from(image.bytes).toString('base64')}`;
  urls.set(`ref:${id}`,data);
 }
 const packed=rewriteHtmlAssetUrls(input.html,urls);
 if(Buffer.byteLength(packed)>input.maxBytes)throw new OfflineHtmlMediaError('too_large');
 return packed;
}
