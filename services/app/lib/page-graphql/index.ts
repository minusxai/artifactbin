import {registeredMutationPlan,registeredMutationInvoker,createRetainedRegisteredMutation} from '@/lib/registered-page-mutations';
import type {HtmlBackendVersionRecord} from '@/lib/html-backends';
import type {HtmlBackendLink} from '@artifactbin/contracts';
import {registeredPlan} from '@/lib/registered-page-queries/registry';
import {registeredQueryInvoker} from '@/lib/registered-page-queries/namespace';
import {createRetainedRegisteredQueries} from '@/lib/registered-page-queries/retained';
import type {AccessActor} from '@/lib/accounts';
import {REVALIDATE_ACTOR_HEADER} from '@artifactbin/contracts';
import type {HtmlPageVersion,PageNamespaceSource,PageOperationRequest,HtmlJsonObject} from '@artifactbin/contracts';
import {getArtifactHeaderById,effectiveRole,accessMoved} from '@/lib/artifacts';
import {readHtmlPage} from '@/lib/html-publication';
import {getHtmlBackendVersion} from '@/lib/html-backends';
import {createPageOperations,createBackendInvoker,pageOperationKind} from '@/lib/page-operations';
import {createDatasetNamespaceInvoker,datasetNamespaceSources} from '@/lib/dataset-graphql';
import {createRetainedDatasetGraphql} from '@/lib/dataset-graphql/retained';
import {services} from '@/lib/platform';
import {json,readJson} from '@/lib/http';
import {requestOrSessionActor,refusesCrossSite} from '@/lib/accounts';
/** Reserved host programs are validated before discovery or invocation; unknown kinds never reach the runner. */
function registeredPrograms(page:HtmlPageVersion,link:HtmlBackendLink,backend:HtmlBackendVersionRecord){
 const query=registeredPlan(page,link,backend),mutation=registeredMutationPlan(page,link,backend);
 if(!query&&!mutation&&backend.compiled.startsWith('!registered-page-'))throw Error('registered_program_unsupported');
 return {query,mutation};
}
async function sources(_actor:AccessActor,page:HtmlPageVersion):Promise<readonly PageNamespaceSource[]>{
 const backends=await Promise.all(page.links.filter(link=>link.kind==='backend').map(async link=>{
  const backend=await getHtmlBackendVersion(link.backendId,link.version);
  if(!backend||backend.pageId!==page.pageId)throw Error('backend_link_mismatch');
  registeredPrograms(page,link,backend);
  return {name:link.name,fileId:link.backendId,version:link.version,typeDefs:backend.typeDefs};
 }));
 return [...backends,...datasetNamespaceSources(page.links.filter(link=>link.kind==='dataset'))];
}
function operations(actor:AccessActor,page:HtmlPageVersion,revalidateActor:()=>Promise<AccessActor>,retainReadFence?:(verify:()=>Promise<void>)=>void){
 const backend=createBackendInvoker(services().runner,getHtmlBackendVersion);
 const dataset=createDatasetNamespaceInvoker(actor,page.links.filter(link=>link.kind==='dataset'),createRetainedDatasetGraphql({retainReadFence}));
 return createPageOperations({readPage:readHtmlPage,role:async(a,id)=>{const row=await getArtifactHeaderById(id);return row?effectiveRole(row,a):'none';},sources,invoke:async call=>{
  const link=page.links.find(link=>link.name===call.namespace);
  if(!link)throw Error('namespace_not_linked');
  if(link.kind==='backend'){
   const record=await getHtmlBackendVersion(link.backendId,link.version);
   if(!record)throw Error('backend_link_mismatch');
   const {query:plan,mutation}=registeredPrograms(page,link,record);
   if(plan){const adapter=createRetainedRegisteredQueries(actor,page,{retainReadFence,fenceSignal:call.signal});return registeredQueryInvoker(page,{...plan.registration,subject:actor.userId},adapter.execute)(call);}
   if(mutation){const adapter=createRetainedRegisteredMutation(actor,page,link,record,revalidateActor);return registeredMutationInvoker(adapter.context,adapter.plan,(_context,_plan,args,signal)=>adapter.execute(args,signal))(call);}
   return backend(call);
  }
  return dataset(call);
 }});
}
/** Original request identity and ACLs guard both SDL and executions. */
export async function pageGraphql(request:Request,pageId:string):Promise<Response>{
 const actor=await requestOrSessionActor(request);
 if(refusesCrossSite(request,actor))return json({error:'forbidden'},403);
 try{
  const admitted=await getArtifactHeaderById(pageId);if(!admitted)throw Error('page_unavailable');
  const verifyPage=async(revision:string)=>{
   const currentActor=await requestOrSessionActor(request,{revalidate:true});
   if(JSON.stringify(currentActor)!==JSON.stringify(actor))throw Error('page_unavailable');
   const current=await getArtifactHeaderById(pageId);
   if(!current||accessMoved(admitted,current)||current.edit_id!==admitted.edit_id||current.version!==admitted.version||JSON.stringify(current.meta.htmlLinks)!==JSON.stringify(admitted.meta.htmlLinks))throw Error('page_unavailable');
   await readHtmlPage(currentActor,pageId,revision);
  };
  const readHeaders={'Cache-Control':'no-store',[REVALIDATE_ACTOR_HEADER]:'1'};
  if(request.method==='GET'){
   const revision=new URL(request.url).searchParams.get('revision')??undefined;
   const page=await readHtmlPage(actor,pageId,revision);
   const sdl=await operations(actor,page,()=>requestOrSessionActor(request,{revalidate:true})).schema(actor,pageId,page.revision);
   await verifyPage(page.revision);
   return json({sdl,revision:page.revision},200,readHeaders);
  }
  const body=await readJson(request);
  if(!body||typeof body.query!=='string'||typeof body.revision!=='string'||(body.operationName!==undefined&&typeof body.operationName!=='string')||(body.variables!==undefined&&(!body.variables||typeof body.variables!=='object'||Array.isArray(body.variables))))return json({error:'invalid_graphql_request'},400);
  const operationKind=pageOperationKind(body.query,typeof body.operationName==='string'?body.operationName:undefined);
  if(!operationKind||(body.operation!==undefined&&body.operation!==operationKind))return json({error:'invalid_graphql_operation'},400);
  const head=await readHtmlPage(actor,pageId);
  if(operationKind==='mutation'&&head.revision!==body.revision)return json({error:'archived_page_readonly'},403);
  // The head just read is this revision when the request names it: one read of the page's source, not two.
  const page=body.revision===head.revision?head:await readHtmlPage(actor,pageId,body.revision);
  const operation:PageOperationRequest={pageId,revision:body.revision,query:body.query,...(body.variables?{variables:body.variables as HtmlJsonObject}:{}),...(typeof body.operationName==='string'?{operationName:body.operationName}:{})};
  // Mutations conserve their durable receipts; this final fence only withholds read results.
  const readFences:Array<()=>Promise<void>>=[];
  const result=await operations(actor,page,()=>requestOrSessionActor(request,{revalidate:true}),operationKind==='query'?verify=>{readFences.push(verify);}:undefined).execute(actor,operation,request.signal);
  if(operationKind==='query'){
   for(const verify of readFences)await verify();
   await verifyPage(page.revision);
   return json(result,200,readHeaders);
  }
  return json(result);
 }catch{return json({error:'page_operation_unavailable'},404);}
}
