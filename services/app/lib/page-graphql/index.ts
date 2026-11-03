import {registeredMutationPlan,registeredMutationInvoker} from '@/lib/registered-page-mutations';
import {createRetainedRegisteredMutation} from '@/lib/page-graphql/registered-mutations';
import {type HtmlBackendVersionRecord, getHtmlBackendVersion} from '@/lib/html-backends';
import type {HtmlDatasetLink,HtmlPageLink} from '@artifactbin/contracts';
import type {HtmlBackendLink} from '@artifactbin/contracts';
import {registeredPlan, registeredQueryInvoker} from '@/lib/registered-page-queries';
import {createRetainedRegisteredQueries} from '@/lib/page-graphql/registered-queries';
import type { AccessActor } from '@/lib/accounts';
import {REVALIDATE_ACTOR_HEADER} from '@artifactbin/contracts';
import type {HtmlPageVersion,PageNamespaceSource,PageOperationRequest,HtmlJsonObject} from '@artifactbin/contracts';
import { getArtifactById, getArtifactHeaderById, accessMoved, readableArtifactHeader } from '@/lib/artifacts';
import { pageRole } from '@/lib/dataset-permissions';
import {readHtmlPage} from '@/lib/html-publication';
import {createPageOperations,createBackendInvoker,createResolverQuery,createResolverSql,pageOperationKind,type ResolverDatasets} from '@/lib/page-operations';
import {executeLinkedDatasetGraphql, loadPageDatasets, readLinkedDatasetTables, type PageDatasets} from '@/lib/dataset-graphql';
import {getDb,services} from '@/lib/platform';
import {people} from '@/lib/datasets';
import {json,readJson} from '@/lib/http';
import { requestOrSessionActor, refusesCrossSite } from '@/lib/authentication';
/** Reserved host programs are validated before discovery or invocation; unknown kinds never reach the runner. */
function registeredPrograms(page:HtmlPageVersion,link:HtmlBackendLink,backend:HtmlBackendVersionRecord){
 const query=registeredPlan(page,link,backend),mutation=registeredMutationPlan(page,link,backend);
 if(!query&&!mutation&&backend.compiled.startsWith('!registered-page-'))throw Error('registered_program_unsupported');
 return {query,mutation};
}
/** The page's dataset links: each mounts its dataset's generated roots flat at the top of the page schema. */
const datasetLinks=(page:HtmlPageVersion)=>page.links.filter((link):link is HtmlDatasetLink=>link.kind==='dataset');
async function backendSources(page:HtmlPageVersion):Promise<PageNamespaceSource[]>{
 return Promise.all(page.links.filter(link=>link.kind==='backend').map(async link=>{
  const backend=await getHtmlBackendVersion(link.backendId,link.version);
  if(!backend||backend.pageId!==page.pageId)throw Error('backend_link_mismatch');
  registeredPrograms(page,link,backend);
  return {name:link.name,fileId:link.backendId,version:link.version,typeDefs:backend.typeDefs};
 }));
}
/** How many times a read raced by a linked dataset's write runs before the request is refused. */
const RACED_READ_ATTEMPTS=3;
interface OperationScope{revalidateActor:()=>Promise<AccessActor>;retainReadFence?:(verify:()=>Promise<void>)=>void;idempotencyKey?:string;signal?:AbortSignal}
function operations(actor:AccessActor,page:HtmlPageVersion,scope:OperationScope){
 const {revalidateActor,retainReadFence}=scope;
 const backend=createBackendInvoker(services().runner,getHtmlBackendVersion);
 const linked=datasetLinks(page);
 // The dataset links load once per request, for this reader's role through this page: the composed SDL and the execution share it.
 let loaded:Promise<PageDatasets>|undefined;
 const datasets=()=>loaded??=loadPageDatasets(actor,linked,{pageId:page.pageId,...(retainReadFence?{retainReadFence}:{}),...(scope.idempotencyKey?{idempotencyKey:scope.idempotencyKey}:{})},scope.signal??new AbortController().signal);
 const sources=async(_actor:AccessActor,current:HtmlPageVersion):Promise<readonly PageNamespaceSource[]>=>[
  ...await backendSources(current),
  ...(linked.length?(await datasets()).sources.map(source=>({...source,kind:'dataset-hasura' as const})):[]),
 ];
 // The page this request already read for this reader and revision is not read again (its source is the costly part).
 const readPage:typeof readHtmlPage=(reader,id,revision)=>reader===actor&&id===page.pageId&&revision===page.revision?Promise.resolve(page):readHtmlPage(reader,id,revision);
 // The built-in viewer's name is the reader's own person card (never another person's, never an email).
 const viewerName=async(subject:string)=>(await people(await getDb(),[subject]))[subject]?.name??null;
 return createPageOperations({readPage,role:async(a,id)=>{const row=await getArtifactHeaderById(id);return row?pageRole(row,a):null;},sources,datasets:async()=>linked.length?datasets():undefined,viewerName,invoke:async call=>{
  const link=page.links.find(link=>link.name===call.namespace);
  // Dataset roots never reach invoke: page operations run them through `datasets`.
  if(link?.kind!=='backend')throw Error('namespace_not_linked');
  const record=await getHtmlBackendVersion(link.backendId,link.version);
  if(!record)throw Error('backend_link_mismatch');
  const {query:plan,mutation}=registeredPrograms(page,link,record);
  if(plan){const adapter=createRetainedRegisteredQueries(actor,page,{readPage,retainReadFence,fenceSignal:call.signal});return registeredQueryInvoker(page,{...plan.registration,subject:actor.userId},adapter.execute)(call);}
  if(mutation){const adapter=createRetainedRegisteredMutation(actor,page,link,record,revalidateActor);return registeredMutationInvoker(adapter.context,adapter.plan,(_context,_plan,args,signal)=>adapter.execute(args,signal))(call);}
  return backend(call);
 }});
}
/** The datasets the page head links now, live and pinned. */
const headDatasetLinks=async(pageId:string)=>{const row=await getArtifactById(pageId);return !row||row.format!=='html'?[]:((row.meta as {htmlLinks?:HtmlPageLink[]}).htmlLinks??[]).filter((link):link is HtmlDatasetLink=>link.kind==='dataset');};
/**
 * A resolver's caps.query and caps.sql, composed here so page operations stay below datasets and artifacts: the
 * datasets the page head links, run as the caller the run was admitted for, as one Hasura-style API (query) or as
 * read-only SQL tables on the SQL service's read door (sql).
 */
export const resolverDatasets:ResolverDatasets={
 query:createResolverQuery({links:headDatasetLinks,execute:executeLinkedDatasetGraphql}),
 sql:createResolverSql({links:headDatasetLinks,read:readLinkedDatasetTables,run:input=>services().sql.run(input)}),
};
const IDEMPOTENCY_KEY=/^[A-Za-z0-9_-]{16,128}$/;
/** Original request identity and ACLs guard both SDL and executions. */
export async function pageGraphql(request:Request,pageId:string):Promise<Response>{
 const actor=await requestOrSessionActor(request);
 if(refusesCrossSite(request,actor))return json({error:'forbidden'},403);
 try{
  const admitted=await getArtifactHeaderById(pageId);if(!admitted)throw Error('page_unavailable');
  const verifyPage=async(revision:string)=>{
   const currentActor=await requestOrSessionActor(request,{revalidate:true});
   if(JSON.stringify(currentActor)!==JSON.stringify(actor))throw Error('page_unavailable');
   // One header read decides both: the head did not move, and this reader may still read it.
   const readable=await readableArtifactHeader(currentActor,pageId),current=readable?.row;
   if(!current||current.format!=='html'||accessMoved(admitted,current)||current.edit_id!==admitted.edit_id||current.version!==admitted.version||JSON.stringify(current.meta.htmlLinks)!==JSON.stringify(admitted.meta.htmlLinks))throw Error('page_unavailable');
   // An archived revision is immutable; its own row is checked only when it is not the head just read.
   if(revision!==String(current.version))await readHtmlPage(currentActor,pageId,revision);
  };
  const readHeaders={'Cache-Control':'no-store',[REVALIDATE_ACTOR_HEADER]:'1'};
  if(request.method==='GET'){
   const revision=new URL(request.url).searchParams.get('revision')??undefined;
   const page=await readHtmlPage(actor,pageId,revision);
   const sdl=await operations(actor,page,{revalidateActor:()=>requestOrSessionActor(request,{revalidate:true}),signal:request.signal}).schema(actor,pageId,page.revision);
   await verifyPage(page.revision);
   return json({sdl,revision:page.revision},200,readHeaders);
  }
  const body=await readJson(request);
  if(!body||typeof body.query!=='string'||typeof body.revision!=='string'||(body.operationName!==undefined&&typeof body.operationName!=='string')||(body.variables!==undefined&&(!body.variables||typeof body.variables!=='object'||Array.isArray(body.variables))))return json({error:'invalid_graphql_request'},400);
  // One Idempotency-Key per client mutation (@afbin/apollo): a generated-API write replays its receipt under it.
  const idempotencyKey=request.headers.get('idempotency-key')??undefined;
  if(idempotencyKey!==undefined&&!IDEMPOTENCY_KEY.test(idempotencyKey))return json({error:'invalid_idempotency_key'},400);
  const operationKind=pageOperationKind(body.query,typeof body.operationName==='string'?body.operationName:undefined);
  if(!operationKind||(body.operation!==undefined&&body.operation!==operationKind))return json({error:'invalid_graphql_operation'},400);
  const head=await readHtmlPage(actor,pageId);
  if(operationKind==='mutation'&&head.revision!==body.revision)return json({error:'archived_page_readonly'},403);
  // The head just read is this revision when the request names it: one read of the page's source, not two.
  const page=body.revision===head.revision?head:await readHtmlPage(actor,pageId,body.revision);
  const operation:PageOperationRequest={pageId,revision:body.revision,query:body.query,...(body.variables?{variables:body.variables as HtmlJsonObject}:{}),...(typeof body.operationName==='string'?{operationName:body.operationName}:{})};
  const scope={revalidateActor:()=>requestOrSessionActor(request,{revalidate:true}),signal:request.signal};
  if(operationKind==='mutation')return json(await operations(actor,page,{...scope,...(idempotencyKey?{idempotencyKey}:{})}).execute(actor,operation,request.signal));
  // A read's fences withhold its result when a linked dataset moved while it ran (another reader's write, say).
  // Reads have no effects, so a moved dataset re-runs the whole read on the new head, a bounded number of times.
  for(let attempt=1;;attempt++){
   const readFences:Array<()=>Promise<void>>=[];
   try{
    const result=await operations(actor,page,{...scope,retainReadFence:verify=>{readFences.push(verify);}}).execute(actor,operation,request.signal);
    for(const verify of readFences)await verify();
    await verifyPage(page.revision);
    return json(result,200,readHeaders);
   }catch(error){
    if(attempt<RACED_READ_ATTEMPTS&&error instanceof Error&&error.message==='dataset_changed'&&!request.signal.aborted)continue;
    throw error;
   }
  }
 }catch{return json({error:'page_operation_unavailable'},404);}
}
