import {datasetActor,datasetResponse} from '@/lib/datasets/http';
import {prepareCatalog,catalogOf} from '@/lib/datasets/catalog';
import {executeCatalog} from '@/lib/datasets/execute';
import {getArtifactFor} from '@/lib/artifacts';
import {readJson,json} from '@/lib/http';
export async function POST(request:Request){
 const actor=await datasetActor(request);if(actor instanceof Response)return actor;
 const body=await readJson(request);if(!body||typeof body.sql!=='string')return json({error:'invalid_query'},400);
 const previous=typeof body.datasetId==='string'?await getArtifactFor(actor,body.datasetId):undefined;
 if(body.datasetId&&!previous)return json({error:'not_found'},404);
 const prepared=await prepareCatalog(body.dataset,actor,previous??undefined);if(prepared instanceof Response)return prepared;
 return datasetResponse(()=>executeCatalog(catalogOf(prepared)!,body.sql as string,{}, {limit:50,refresh:true}));
}
