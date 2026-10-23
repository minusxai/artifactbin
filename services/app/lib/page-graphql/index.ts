import type {AccessActor} from '@/lib/accounts';
import type {HtmlPageVersion,PageNamespaceSource,PageOperationRequest,HtmlJsonObject} from '@artifactbin/contracts';
import {getArtifactHeaderById,effectiveRole} from '@/lib/artifacts';
import {readHtmlPage} from '@/lib/html-publication';
import {getHtmlBackendVersion} from '@/lib/html-backends';
import {createPageOperations,createBackendInvoker,pageOperationKind} from '@/lib/page-operations';
import {createDatasetNamespaceInvoker,datasetNamespaceSources} from '@/lib/dataset-graphql';
import {createRetainedDatasetGraphql} from '@/lib/dataset-graphql/retained';
import {services} from '@/lib/platform';
import {json,readJson} from '@/lib/http';
import {requestOrSessionActor,refusesCrossSite} from '@/lib/accounts';
async function sources(_actor:AccessActor,page:HtmlPageVersion):Promise<readonly PageNamespaceSource[]>{
 const backends=await Promise.all(page.links.filter(link=>link.kind==='backend').map(async link=>{
  const backend=await getHtmlBackendVersion(link.backendId,link.version);
  if(!backend||backend.pageId!==page.pageId)throw Error('backend_link_mismatch');
  return {name:link.name,fileId:link.backendId,version:link.version,typeDefs:backend.typeDefs};
 }));
 return [...backends,...datasetNamespaceSources(page.links.filter(link=>link.kind==='dataset'))];
}
function operations(actor:AccessActor,page:HtmlPageVersion){
 const backend=createBackendInvoker(services().runner,getHtmlBackendVersion);
 const dataset=createDatasetNamespaceInvoker(actor,page.links.filter(link=>link.kind==='dataset'),createRetainedDatasetGraphql());
 return createPageOperations({readPage:readHtmlPage,role:async(a,id)=>{const row=await getArtifactHeaderById(id);return row?effectiveRole(row,a):'none';},sources,invoke:call=>{
  const link=page.links.find(link=>link.name===call.namespace);
  if(!link)throw Error('namespace_not_linked');
  return link.kind==='backend'?backend(call):dataset(call);
 }});
}
/** Original request identity and ACLs guard both SDL and executions. */
export async function pageGraphql(request:Request,pageId:string):Promise<Response>{
 const actor=await requestOrSessionActor(request);
 if(refusesCrossSite(request,actor))return json({error:'forbidden'},403);
 try{
  if(request.method==='GET'){
   const revision=new URL(request.url).searchParams.get('revision')??undefined;
   const page=await readHtmlPage(actor,pageId,revision);
   return json({sdl:await operations(actor,page).schema(actor,pageId,page.revision),revision:page.revision});
  }
  const body=await readJson(request);
  if(!body||typeof body.query!=='string'||typeof body.revision!=='string'||(body.operationName!==undefined&&typeof body.operationName!=='string')||(body.variables!==undefined&&(!body.variables||typeof body.variables!=='object'||Array.isArray(body.variables))))return json({error:'invalid_graphql_request'},400);
  const operationKind=pageOperationKind(body.query,typeof body.operationName==='string'?body.operationName:undefined);
  if(!operationKind||(body.operation!==undefined&&body.operation!==operationKind))return json({error:'invalid_graphql_operation'},400);
  const head=await readHtmlPage(actor,pageId);
  if(operationKind==='mutation'&&head.revision!==body.revision)return json({error:'archived_page_readonly'},403);
  const page=await readHtmlPage(actor,pageId,body.revision);
  const operation:PageOperationRequest={pageId,revision:body.revision,query:body.query,...(body.variables?{variables:body.variables as HtmlJsonObject}:{}),...(typeof body.operationName==='string'?{operationName:body.operationName}:{})};
  return json(await operations(actor,page).execute(actor,operation,request.signal));
 }catch{return json({error:'page_operation_unavailable'},404);}
}
