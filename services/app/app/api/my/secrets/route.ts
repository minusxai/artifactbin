import {datasetActor,datasetResponse} from '@/lib/datasets/http';
import {createDatasetSecret} from '@/lib/datasets/secrets';
import {secretTargetShape} from '@/lib/datasets/input';
import {readJson,json} from '@/lib/http';
export async function POST(request:Request){const actor=await datasetActor(request);if(actor instanceof Response)return actor;const body=await readJson(request);const target=secretTargetShape.safeParse(body?.connection);if(!body||typeof body.value!=='string'||!target.success||body.datasetId!==undefined&&typeof body.datasetId!=='string')return json({error:'invalid_secret'},400);return datasetResponse(async()=>({secret:await createDatasetSecret(actor,body.value as string,target.data,body.datasetId as string|undefined)}),201);}
