import {datasetActor,datasetResponse} from '@/lib/datasets/http';
import {resolveDatasetConnection} from '@/lib/datasets/secrets';
import {connectionShape} from '@/lib/datasets/input';
import {discoverPostgres,queryPostgres} from '@/lib/datasets/postgres';
import {compileNotebookSql} from '@/lib/datasets/notebook';
import {getArtifactFor} from '@/lib/artifacts';
import {readJson,json} from '@/lib/http';
import type {DatasetNotebook} from '@/lib/datasets/types';
export async function POST(request:Request){const actor=await datasetActor(request);if(actor instanceof Response)return actor;const body=await readJson(request),parsed=connectionShape.safeParse(body?.connection);if(!body||!parsed.success||typeof body.cellId!=='string'||!body.notebook||typeof body.notebook!=='object')return json({error:'invalid_notebook'},400);if(body.datasetId&&!await getArtifactFor(actor,body.datasetId as string))return json({error:'not_found'},404);return datasetResponse(async()=>{const config=await resolveDatasetConnection(parsed.data,body.datasetId?undefined:actor,body.datasetId as string|undefined);const discovered=await discoverPostgres(config);const raw={kind:'postgres' as const,connection:parsed.data,notebookSources:discovered,defaultSchema:'public',refreshSeconds:0,tables:discovered.map(table=>({...table,source:{schema:table.schema,table:table.name}}))};const compiled=compileNotebookSql(raw,body.notebook as DatasetNotebook,body.cellId as string);const result=await queryPostgres(config,compiled.sql,compiled.values,{limit:50,offset:0});return {...result,refreshedAt:new Date().toISOString()};});}
