import {readableArtifact} from '@/lib/artifact-read';
/** Authenticated immutable content reads never use public serving/import paths. */
import {withTokenAuth} from '@/lib/auth';
import {getVersionFor} from '@/lib/artifacts';
import {canEdit} from '@/lib/share-roles';
import {serveStoredFile} from '@/lib/story/file-store';
import {catalogOf,publicCatalogOf} from '@/lib/datasets/catalog';
import {serializeDatasetDefinition} from '@/lib/datasets/definition';
import type {DatasetCatalog} from '@/lib/datasets/types';
import {objectStore} from '@/lib/object-store';
import {json} from '@/lib/http';

/** A reader's definition names the public relations only: no connection, no notebook. */
const readableDefinition=(catalog:DatasetCatalog)=>serializeDatasetDefinition({
 kind:catalog.kind,defaultSchema:catalog.defaultSchema,refreshSeconds:catalog.refreshSeconds,
 tables:catalog.tables.map(table=>({schema:table.schema,name:table.name,columns:table.columns.map(column=>column.name)})),
});

export const GET=withTokenAuth(async(request,{tokenId,userId,params})=>{
 const actor={tokenId,userId};const readable=await readableArtifact(actor,params.id);
 if(!readable)return json({error:'not_found'},404);
 const head=readable.row;
 const raw=new URL(request.url).searchParams.get('version');
 if(raw!==null&&(!/^[1-9]\d*$/.test(raw)||!Number.isSafeInteger(Number(raw))))return json({error:'invalid_version'},400);
 const row=raw===null||Number(raw)===head.version?head:await getVersionFor(actor,head.id,Number(raw));
 if(!row)return json({error:'not_found'},404);
 if(['image','pdf','file'].includes(row.format))return serveStoredFile(request,{id:head.id,meta:row.meta});
 if(row.format==='dataset'){
  const catalog=catalogOf(row);
  const table=catalog?.kind==='stored'&&catalog.tables.length===1?catalog.tables[0]:null;
  if(table?.objectKey)return new Response(new Uint8Array(await objectStore().get(table.objectKey)),{headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
  if(!catalog)return json({error:'not_found'},404);
  // A connected or multi-table dataset holds no downloadable rows: its content is the definition.
  const stored=typeof row.source==='string'&&row.source.trimStart().startsWith('<Dataset')?row.source:null;
  const definition=canEdit(readable.role)&&stored?stored:readableDefinition(publicCatalogOf(row)??catalog);
  return new Response(definition,{headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'}});
 }
 return new Response(row.source??'',{headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'}});
});
