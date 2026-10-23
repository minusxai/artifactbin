import {pageBackendOperation} from '@/lib/page-operations';
import {readJson,json} from '@/lib/http';
import type {RunnerJson} from '@artifactbin/contracts';
export async function POST(request:Request){
 const body=await readJson(request);if(!body||typeof body.operation!=='string'||!body.input||typeof body.input!=='object'||Array.isArray(body.input))return json({error:'invalid_operation_input'},400);
 return pageBackendOperation(request,body.operation,body.input as RunnerJson,typeof body.documentSource==='string'?body.documentSource:undefined);
}
