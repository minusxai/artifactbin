import { getVersionFor, readableArtifact, refusingUnservable, servableDocument } from '@/lib/artifacts';
/** Authenticated immutable content reads never use public serving/import paths. */
import { withTokenAuth } from '@/lib/authentication';
import { canEdit } from '@artifactbin/contracts';
import {LIVE_DATASET_REFUSAL, liveConnectionOf, serveStoredFile, catalogOf, publicCatalogOf, serializeDatasetDefinition, type DatasetCatalog} from '@/lib/datasets';
import {objectStore} from '@/lib/object-store';
import {datasetReadAccess,datasetRowsFor,viewCatalog} from '@/lib/dataset-permissions';
import {json} from '@/lib/http';

/** A reader's definition names the public relations only. */
const readableDefinition=(catalog:DatasetCatalog)=>serializeDatasetDefinition({
 kind:'stored',defaultSchema:catalog.defaultSchema,refreshSeconds:catalog.refreshSeconds,
 tables:catalog.tables.map(table=>({schema:table.schema,name:table.name,columns:table.columns.map(column=>column.name)})),
});

export const GET=withTokenAuth((request,{ actor,params })=>refusingUnservable(async()=>{
 const readable=await readableArtifact(actor,params.id);
 if(!readable)return json({error:'not_found'},404);
 const head=readable.row;
 const raw=new URL(request.url).searchParams.get('version');
 if(raw!==null&&(!/^[1-9]\d*$/.test(raw)||!Number.isSafeInteger(Number(raw))))return json({error:'invalid_version'},400);
 const row=raw===null||Number(raw)===head.version?servableDocument(head):await getVersionFor(actor,head.id,Number(raw));
 if(!row)return json({error:'not_found'},404);
 if(['image','pdf','file'].includes(row.format))return serveStoredFile(request,{id:head.id,meta:row.meta});
 if(row.format==='dataset'&&liveConnectionOf(row.meta))return json({error:'live_dataset',message:LIVE_DATASET_REFUSAL},400);
 if(row.format==='dataset'){
  // The reader's role view (lib/dataset-permissions): a role that sees every row gets the stored bytes.
  const decision=await datasetReadAccess(head,actor);
  if(!decision.allowed)return json({error:'not_found'},404);
  const catalog=catalogOf(row);
  const table=catalog?.kind==='stored'&&catalog.tables.length===1?catalog.tables[0]:null;
  if(table?.objectKey&&!decision.full)return new Response(JSON.stringify(await datasetRowsFor(decision,row,table)),{headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
  if(table?.objectKey)return new Response(new Uint8Array(await objectStore().get(table.objectKey)),{headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
  if(!catalog)return json({error:'not_found'},404);
  // A dataset with no single stored table to download: its content is the definition (JSON),
  // as stored for its editors, as its role view's public relations for everyone else.
  const stored=catalog.kind==='stored'&&typeof row.source==='string'&&row.source?row.source:null;
  const definition=canEdit(readable.role)&&stored?stored:readableDefinition(viewCatalog(decision,publicCatalogOf(row)??catalog));
  return new Response(definition,{headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
 }
 return new Response(row.source??'',{headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'}});
}));
