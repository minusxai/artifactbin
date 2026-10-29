import {datasetResponse, createDatasetSecret, DatasetError, secretTargetShape} from '@/lib/datasets';
import {requestActor} from '@/lib/authentication';
import { getArtifactFor } from '@/lib/artifacts';
import {readJson,json,unauthorized} from '@/lib/http';
import { withAccountToken } from '@/lib/accounts';
export async function POST(request:Request){const caller=await requestActor(request);if(caller instanceof Response)return caller;
 // A secret is stamped with a token: a session's is its account token, as every browser create is.
 const actor=await withAccountToken(caller);if(!actor)return unauthorized(request);
 const body=await readJson(request);const target=secretTargetShape.safeParse(body?.connection);if(!body||typeof body.value!=='string'||!target.success||body.datasetId!==undefined&&typeof body.datasetId!=='string')return json({error:'invalid_secret'},400);const datasetId=body.datasetId as string|undefined;return datasetResponse(async()=>{if(datasetId){const dataset=await getArtifactFor(actor,datasetId);if(!dataset||dataset.format!=='dataset')throw new DatasetError('Dataset not found',404);}return {secret:await createDatasetSecret(actor,body.value as string,target.data,datasetId)};},201);}
