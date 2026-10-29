import {getArtifactById,effectiveRole} from '@/lib/artifacts';
import { canRead, REVALIDATE_ACTOR_HEADER } from '@artifactbin/contracts';
import { requestOrSessionActor } from '@/lib/authentication';
import {readJson,json} from '@/lib/http';
import {catalogOf, datasetResponse, executeCatalog, DatasetError} from '@/lib/datasets';
export async function POST(request:Request,ctx:{params:Promise<{id:string}>}){
 const {id}=await ctx.params;const actor=await requestOrSessionActor(request);const row=await getArtifactById(id);
 if(!row||row.format!=='dataset'||!canRead(await effectiveRole(row,actor)))return json({error:'not_found'},404);
 const body=await readJson(request);if(!body||typeof body.sql!=='string')return json({error:'invalid_query'},400);
 const catalog=catalogOf(row);if(!catalog)return json({error:'invalid_dataset'},400);
 return datasetResponse(()=>executeCatalog(catalog,body.sql as string,{}, {datasetId:id,limit:typeof body.limit==='number'?body.limit:100,offset:typeof body.offset==='number'?body.offset:0,refresh:body.refresh===true,signal:request.signal,authorize:async()=>{
  const currentActor=await requestOrSessionActor(request,{revalidate:true}),current=await getArtifactById(id);
  if(!current||!canRead(await effectiveRole(current,currentActor))||JSON.stringify(catalogOf(current))!==JSON.stringify(catalog))throw new DatasetError('Dataset not found',404);
 }}),200,{[REVALIDATE_ACTOR_HEADER]:'1'});
}
