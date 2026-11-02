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
  const body=refusesCrossSite(request,actor)?null:await readJson(request.clone());
  if(body&&typeof body.query==='string'){
   const response=await runOperation('query_dataset_graphql',request,actor,{id,query:body.query,...(body.variables!==undefined?{variables:body.variables}:{}),...(body.operationName!==undefined?{operationName:body.operationName}:{})});
   if(response.status!==404)return response;
  }
 }
 return pageGraphql(request,id);
}
