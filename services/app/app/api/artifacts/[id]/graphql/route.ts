import {pageGraphql} from '@/lib/page-graphql';
import {DatasetBindingUnsupportedError,datasetGraphqlSchema,isDatasetGraphqlTarget} from '@/lib/dataset-graphql';
import {runOperation} from '@/lib/operations';
import {requestOrSessionActor,refusesCrossSite} from '@/lib/authentication';
import {json,readJson} from '@/lib/http';
type Context={params:Promise<Record<string,string>>};
/**
 * One path, two targets: a page's composed GraphQL, or a dataset's generated API (query_dataset_graphql).
 * Anything the dataset side does not answer (no access, a malformed request) falls through to the page side,
 * so a refused dataset answers exactly as an id that does not exist.
 */
export async function GET(request:Request,context:Context){
 const id=(await context.params).id!;
 if(await isDatasetGraphqlTarget(id)){
  const actor=await requestOrSessionActor(request);
  if(!refusesCrossSite(request,actor)){
   try{return json(await datasetGraphqlSchema(actor,id,request.signal),200,{'Cache-Control':'no-store'});}
   catch(error){if(error instanceof DatasetBindingUnsupportedError)return json({error:error.code,hint:error.hint},400);/* otherwise the uniform answer below */}
  }
 }
 return pageGraphql(request,id);
}
export async function POST(request:Request,context:Context){
 const id=(await context.params).id!;
 if(await isDatasetGraphqlTarget(id)){
  const actor=await requestOrSessionActor(request);
  if(!refusesCrossSite(request,actor)){
   const body=await readJson(request.clone());
   // A well-formed request (exactly the operation's own input rules) runs the operation, which authorizes before it
   // answers anything: a caller the dataset does not admit gets its 404, and the uniform answer below.
   if(wellFormed(body)){
    const response=await runOperation('query_dataset_graphql',request,actor,{id,query:body.query,...(body.variables!==undefined?{variables:body.variables}:{}),...(body.operationName!==undefined?{operationName:body.operationName}:{}),...(body.idempotencyKey!==undefined?{idempotencyKey:body.idempotencyKey}:{})});
    if(response.status!==404)return response;
   }else{
    // Readership before validation: only a caller the dataset admits (to read or write) learns that the request is
    // malformed; anyone else gets the uniform answer below, exactly as for an id that does not exist.
    try{await datasetGraphqlSchema(actor,id,request.signal);return json({error:'invalid_graphql_request'},400);}catch{/* the uniform answer below */}
   }
  }
 }
 return pageGraphql(request,id);
}
/** The operation's own input rules (lib/operations registry `query_dataset_graphql`), checked before any lookup. */
function wellFormed(body:Record<string,unknown>|null):body is Record<string,unknown>&{query:string}{
 if(!body||typeof body.query!=='string')return false;
 const v=body.variables;
 if(v!==undefined&&(!v||typeof v!=='object'||Array.isArray(v)))return false;
 return (body.operationName===undefined||typeof body.operationName==='string')&&(body.idempotencyKey===undefined||typeof body.idempotencyKey==='string');
}
