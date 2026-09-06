import {datasetActor,datasetResponse} from '@/lib/datasets/http';
import {connectionConfig} from '@/lib/datasets/connections';
import {discoverPostgres} from '@/lib/datasets/postgres';
export async function POST(request:Request,ctx:{params:Promise<{id:string}>}){const actor=await datasetActor(request);if(actor instanceof Response)return actor;const {id}=await ctx.params;return datasetResponse(async()=>({tables:await discoverPostgres(await connectionConfig(id,actor))}));}
