import { refusesCrossSite, sessionActor } from '@/lib/accounts';
import {runnerOperation} from '@/lib/runner';
import {readJson,json} from '@/lib/http';
export async function POST(request:Request){
 if(refusesCrossSite(request,await sessionActor(request)))return json({error:'forbidden'},403);
 const body=await readJson(request);if(!body||typeof body.operation!=='string'||!body.input||typeof body.input!=='object'||Array.isArray(body.input))return json({error:'invalid_operation_input'},400);
 return runnerOperation(request,body.operation,body.input as Record<string,unknown>,typeof body.documentSource==='string'?body.documentSource:undefined);
}
