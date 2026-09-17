import {Readable} from 'node:stream';
import {ASSETS_ORIGIN} from '@/lib/config';
import {getDb} from '@/lib/db';
import {mintExportKey,verifyExportKey} from '@/lib/export-key';
import {objectStore} from '@/lib/object-store';
import type {ExportImage} from './cache';

export function exportAssetUrl(id:string,base:string):string {
 const url=new URL(`/assets/export/${id}`,ASSETS_ORIGIN??base);
 url.searchParams.set('key',mintExportKey(`export-asset:${id}`,300_000));
 return url.toString();
}
/** The grant admits only a published DB object, never a caller-selected S3 key. */
export async function exportAssetResponse(request:Request,id:string):Promise<Response>{
 const url=new URL(request.url),keys=[...url.searchParams.keys()];
 if(!['GET','HEAD'].includes(request.method)||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)
   ||keys.length!==1||keys[0]!=='key'||!verifyExportKey(`export-asset:${id}`,url.searchParams.get('key')??undefined))
  return new Response('not found',{status:404,headers:{'cache-control':'no-store'}});
 const image=(await (await getDb()).query<ExportImage>('SELECT * FROM export_images WHERE id=$1',[id])).rows[0];
 if(!image)return new Response('not found',{status:404,headers:{'cache-control':'no-store'}});
 try {
  const stream=await objectStore().getStream(image.object_key);
  const headers={'content-type':image.mime,'content-length':String(image.bytes),'cache-control':'private, no-store','x-content-type-options':'nosniff'};
  if(request.method==='HEAD'){stream.destroy();return new Response(null,{headers});}
  return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>,{headers});
 } catch {return new Response('image unavailable',{status:503,headers:{'cache-control':'no-store'}});}
}
