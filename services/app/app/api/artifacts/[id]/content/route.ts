import {readableArtifact} from '@/lib/artifact-read';
/** Authenticated immutable content reads never use public serving/import paths. */
import {withTokenAuth} from '@/lib/auth';
import {getVersionFor} from '@/lib/artifacts';
import {serveStoredFile} from '@/lib/story/file-store';
import {catalogOf} from '@/lib/datasets/catalog';
import {objectStore} from '@/lib/object-store';
import {json} from '@/lib/http';

export const GET=withTokenAuth(async(request,{tokenId,userId,params})=>{
 const actor={tokenId,userId};const head=(await readableArtifact(actor,params.id))?.row;
 if(!head)return json({error:'not_found'},404);
 const raw=new URL(request.url).searchParams.get('version');
 if(raw!==null&&(!/^[1-9]\d*$/.test(raw)||!Number.isSafeInteger(Number(raw))))return json({error:'invalid_version'},400);
 const row=raw===null||Number(raw)===head.version?head:await getVersionFor(actor,head.id,Number(raw));
 if(!row)return json({error:'not_found'},404);
 if(['image','pdf','file'].includes(row.format))return serveStoredFile(request,{id:head.id,meta:row.meta});
 if(row.format==='dataset'){
  const catalog=catalogOf(row);
  const table=catalog?.kind==='stored'&&catalog.tables.length===1?catalog.tables[0]:null;
  if(!table?.objectKey)return json({error:'not_flat_dataset',hint:'Use the catalog API to read a multi-table or connected dataset definition.'},400);
  return new Response(new Uint8Array(await objectStore().get(table.objectKey)),{headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
 }
 return new Response(row.source??'',{headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'}});
});
