import {datasetActor,datasetResponse} from '@/lib/datasets/http';
import {listConnections,saveConnection} from '@/lib/datasets/connections';
import {readJson} from '@/lib/http';
export async function GET(request:Request){const actor=await datasetActor(request);if(actor instanceof Response)return actor;return datasetResponse(async()=>({connections:await listConnections(actor)}));}
export async function POST(request:Request){const actor=await datasetActor(request);if(actor instanceof Response)return actor;return datasetResponse(async()=>({connection:await saveConnection(actor,await readJson(request))}),201);}
