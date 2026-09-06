import {datasetActor,datasetResponse} from '@/lib/datasets/http';
import {saveConnection} from '@/lib/datasets/connections';
import {readJson} from '@/lib/http';
export async function PUT(request:Request,ctx:{params:Promise<{id:string}>}){const actor=await datasetActor(request);if(actor instanceof Response)return actor;const {id}=await ctx.params;return datasetResponse(async()=>({connection:await saveConnection(actor,await readJson(request),id)}));}
