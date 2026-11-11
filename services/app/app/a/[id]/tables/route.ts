import { getArtifactById } from '@/lib/artifacts';
import { REVALIDATE_ACTOR_HEADER } from '@artifactbin/contracts';
import { requestOrSessionActor } from '@/lib/authentication';
import {readJson,json} from '@/lib/http';
import {LIVE_DATASET_REFUSAL, liveConnectionOf, catalogOf, datasetResponse, executeCatalog, DatasetError} from '@/lib/datasets';
import {datasetReadAccess, datasetView, sqlRefusal, sqlRefusalMessage, viewCatalog} from '@/lib/dataset-permissions';
const quote=(name:string)=>`"${name.replaceAll('"','""')}"`;
/**
 * THE DATASET EXPLORER'S READ, over the caller's role view (lib/dataset-permissions): the same read decision as every
 * door. `{table:{schema,name}}` browses one table the role may read (a server-built read: any reader); `{sql}` runs the
 * caller's statement, only for a role whose rules allow SQL (`sqlRefusal`, the one SQL check).
 */
export async function POST(request:Request,ctx:{params:Promise<{id:string}>}){
 const {id}=await ctx.params;const actor=await requestOrSessionActor(request);const row=await getArtifactById(id);
 if(row?.format==='dataset'&&liveConnectionOf(row.meta))return json({error:'live_dataset',message:LIVE_DATASET_REFUSAL},400);
 const decision=row?.format==='dataset'?await datasetReadAccess(row,actor):null;
 if(!row||!decision?.allowed)return json({error:'not_found'},404);
 const body=await readJson(request);
 const table=body?.table as {schema?:unknown;name?:unknown}|undefined;
 if(!body||(typeof body.sql==='string')===(table!==undefined))return json({error:'invalid_query',hint:'Send either {table:{schema,name}} or {sql}.'},400);
 const catalog=catalogOf(row);if(!catalog)return json({error:'invalid_dataset'},400);
 let sql:string;
 if(typeof body.sql==='string'){
  const refused=sqlRefusal(decision);
  if(refused)return json({error:'permission_denied',message:sqlRefusalMessage(`${refused.schema}.${refused.name}`)},403);
  sql=body.sql;
 }else{
  const visible=viewCatalog(decision,catalog).tables.find(t=>t.schema===table?.schema&&t.name===table?.name);
  if(!visible)return json({error:'unknown_table'},400);
  sql=`SELECT * FROM ${quote(visible.schema)}.${quote(visible.name)}`;
 }
 return datasetResponse(()=>executeCatalog(catalog,sql,{}, {datasetId:id,view:datasetView(decision),limit:typeof body.limit==='number'?body.limit:100,offset:typeof body.offset==='number'?body.offset:0,refresh:body.refresh===true,signal:request.signal,authorize:async()=>{
  const currentActor=await requestOrSessionActor(request,{revalidate:true}),current=await getArtifactById(id);
  const now=current?.format==='dataset'?await datasetReadAccess(current,currentActor):null;
  if(!current||!now?.allowed||now.identity!==decision.identity||JSON.stringify(catalogOf(current))!==JSON.stringify(catalog))throw new DatasetError('Dataset not found',404);
 }}),200,{[REVALIDATE_ACTOR_HEADER]:'1'});
}
