import {datasetActor,datasetResponse} from '@/lib/datasets/http';
import {createDatasetSecret} from '@/lib/datasets/secrets';
import {DatasetError} from '@/lib/datasets/errors';
import {secretTargetShape} from '@/lib/datasets/input';
import {getArtifactFor} from '@/lib/artifacts/store';
import {readJson,json} from '@/lib/http';
export async function POST(request:Request){const actor=await datasetActor(request);if(actor instanceof Response)return actor;const body=await readJson(request);const target=secretTargetShape.safeParse(body?.connection);if(!body||typeof body.value!=='string'||!target.success||body.datasetId!==undefined&&typeof body.datasetId!=='string')return json({error:'invalid_secret'},400);const datasetId=body.datasetId as string|undefined;return datasetResponse(async()=>{if(datasetId){const dataset=await getArtifactFor(actor,datasetId);if(!dataset||dataset.format!=='dataset')throw new DatasetError('Dataset not found',404);}return {secret:await createDatasetSecret(actor,body.value as string,target.data,datasetId)};},201);}
