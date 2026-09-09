import {datasetActor,datasetResponse} from '@/lib/datasets/http';
import {prepareCatalog,catalogOf} from '@/lib/datasets/catalog';
import {executeCatalog} from '@/lib/datasets/execute';
import {getArtifactFor} from '@/lib/artifacts';
import {readJson,json} from '@/lib/http';
import {DatasetError} from '@/lib/datasets/errors';
import {REVALIDATE_ACTOR_HEADER} from '@artifactbin/contracts';
export async function POST(request:Request){
 const actor=await datasetActor(request);if(actor instanceof Response)return actor;
 const body=await readJson(request);if(!body||typeof body.sql!=='string')return json({error:'invalid_query'},400);
 const previous=typeof body.datasetId==='string'?await getArtifactFor(actor,body.datasetId):undefined;
 if(body.datasetId&&!previous)return json({error:'not_found'},404);
 const prepared=await prepareCatalog(body.dataset,actor,previous??undefined);if(prepared instanceof Response)return prepared;
 return datasetResponse(()=>executeCatalog(catalogOf(prepared)!,body.sql as string,{}, {limit:50,refresh:true,datasetId:previous?.id,actor,signal:request.signal,authorize:async()=>{
  const currentActor=await datasetActor(request);
  if(currentActor instanceof Response)throw new DatasetError('Dataset not found',404);
  if(previous){const current=await getArtifactFor(currentActor,previous.id);if(!current||JSON.stringify(catalogOf(current))!==JSON.stringify(catalogOf(previous)))throw new DatasetError('Dataset changed; retry preview',404);}
 }}),200,{[REVALIDATE_ACTOR_HEADER]:'1'});
}
