import {datasetActor,datasetResponse} from '@/lib/datasets/http';
import {resolveDatasetConnection} from '@/lib/datasets/secrets';
import {connectionShape} from '@/lib/datasets/input';
import {discoverPostgres} from '@/lib/datasets/postgres';
import {getArtifactFor} from '@/lib/artifacts';
import {readJson,json} from '@/lib/http';
export async function POST(request:Request){const actor=await datasetActor(request);if(actor instanceof Response)return actor;const body=await readJson(request),parsed=connectionShape.safeParse(body?.connection);if(!body||!parsed.success||body.datasetId!==undefined&&typeof body.datasetId!=='string')return json({error:'invalid_connection'},400);if(body.datasetId&&!await getArtifactFor(actor,body.datasetId as string))return json({error:'not_found'},404);return datasetResponse(async()=>({tables:await discoverPostgres(await resolveDatasetConnection(parsed.data,body.datasetId?undefined:actor,body.datasetId as string|undefined))}));}
