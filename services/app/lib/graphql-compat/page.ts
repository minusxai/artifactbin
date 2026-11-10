/** DEPRECATED: GraphQL compatibility for pages published before SQL. Do not use in new code; do not extend. */
/**
 * THE PAGE GRAPHQL DOOR (`/api/artifacts/<page>/graphql`): the page schema composed from its backend files' typeDefs
 * and its dataset links' generated APIs, read and executed as the request's reader, and a resolver's `caps.query`.
 * Admission, verification and the commit guard are the plain doors' own (lib/page-doors).
 */
import {getHtmlBackendVersion} from '@/lib/html-backends';
import {REVALIDATE_ACTOR_HEADER,type HtmlDatasetLink,type HtmlJsonObject,type HtmlPageLink,type HtmlPageVersion,type PageNamespaceSource,type PageOperationRequest} from '@artifactbin/contracts';
import type { AccessActor } from '@/lib/accounts';
import { getArtifactById, getArtifactHeaderById, editablePage } from '@/lib/artifacts';
import { pageRole } from '@/lib/dataset-permissions';
import {readHtmlPage} from '@/lib/html-publication';
import {createPageOperations,createBackendInvoker,createResolverQuery,pageOperationKind,type ResolverDatasets} from '@/lib/page-operations';
import {admittedCommitGuard,CREDENTIAL_HEADERS,datasetLinks,headDatasetLinks,IDEMPOTENCY_KEY,pageCommitGuard,pageVerifier,RACED_READ_ATTEMPTS,resolverPorts} from '@/lib/page-doors';
import {executeLinkedDatasetGraphql,loadPageDatasets,type PageCommitGuard,type PageDatasets} from './dataset/hasura';
import {DatasetError,people} from '@/lib/datasets';
import {getDb,runWithRequest,services} from '@/lib/platform';
import {json,readJson} from '@/lib/http';
import { requestOrSessionActor, refusesCrossSite } from '@/lib/authentication';
import {DOMAIN_READ_ONLY_MESSAGE} from '@artifactbin/contracts/domain-footer';
import {exportKeyReader} from '@/lib/export';
async function backendSources(page:HtmlPageVersion):Promise<PageNamespaceSource[]>{
 return Promise.all(page.links.filter(link=>link.kind==='backend').map(async link=>{
  const backend=await getHtmlBackendVersion(link.backendId,link.version);
  if(!backend||backend.pageId!==page.pageId)throw Error('backend_link_mismatch');
  return {name:link.name,fileId:link.backendId,version:link.version,typeDefs:backend.typeDefs};
 }));
}
interface OperationScope{retainReadFence?:(verify:()=>Promise<void>)=>void;idempotencyKey?:string;signal?:AbortSignal;commitGuard?:PageCommitGuard}
function operations(actor:AccessActor,page:HtmlPageVersion,scope:OperationScope){
 const {retainReadFence}=scope;
 const backend=createBackendInvoker(services().runner,getHtmlBackendVersion);
 const linked=datasetLinks(page);
 // The dataset links load once per request, for this reader's role through this page: the composed SDL and the execution share it.
 let loaded:Promise<PageDatasets>|undefined;
 const datasets=()=>loaded??=loadPageDatasets(actor,linked,{pageId:page.pageId,...(retainReadFence?{retainReadFence}:{}),...(scope.idempotencyKey?{idempotencyKey:scope.idempotencyKey}:{}),...(scope.commitGuard?{commitGuard:scope.commitGuard}:{})},scope.signal??new AbortController().signal);
 const sources=async(_actor:AccessActor,current:HtmlPageVersion):Promise<readonly PageNamespaceSource[]>=>[
  ...await backendSources(current),
  ...(linked.length?(await datasets()).sources.map(source=>({...source,kind:'dataset-hasura' as const})):[]),
 ];
 // The page this request already read for this reader and revision is not read again (its source is the costly part).
 const readPage:typeof readHtmlPage=(reader,id,revision)=>reader===actor&&id===page.pageId&&revision===page.revision?Promise.resolve(page):readHtmlPage(reader,id,revision);
 // The built-in viewer's name is the reader's own person card (never another person's, never an email).
 const viewerName=async(subject:string)=>(await people(await getDb(),[subject]))[subject]?.name??null;
 return createPageOperations({readPage,role:async(a,id)=>{const row=await getArtifactHeaderById(id);return row?pageRole(row,a):null;},sources,datasets:async()=>linked.length?datasets():undefined,viewerName,
  // The live-region editor's own check (lib/region-sessions opens a region only on an `editablePage`).
  canEdit:async(reader,id)=>!!await editablePage(await getDb(),reader,id),
  invoke:async call=>{
  const link=page.links.find(link=>link.name===call.namespace);
  // Dataset roots never reach invoke: page operations run them through `datasets`.
  if(link?.kind!=='backend')throw Error('namespace_not_linked');
  return backend(call);
 }});
}
/**
 * A resolver's caps.query and caps.sql, composed here so page operations stay below datasets and artifacts: the
 * datasets the page head links, run as the caller the run was admitted for, as one Hasura-style API (query) or as
 * read-only SQL tables on the SQL service's read door (sql).
 */
export const resolverDatasets:ResolverDatasets={
 query:createResolverQuery({links:headDatasetLinks,execute:executeLinkedDatasetGraphql,
  // A resolver's write goes through the page head it read the links from: the same guard as every page write. A page
  // function call's write (SECURITY FIX, README "Fixes, not features") commits under its admission instead, decided
  // inside the commit exactly as a caps.sql write's is (lib/page-doors `admittedCommitGuard`).
  page:async(pageId,actor,admission)=>{
   const row=await getArtifactById(pageId);
   const links=!row||row.format!=='html'?[]:((row.meta as {htmlLinks?:HtmlPageLink[]}).htmlLinks??[]).filter((link):link is HtmlDatasetLink=>link.kind==='dataset');
   return {links,commitGuard:admission?admittedCommitGuard(admission,actor):row?pageCommitGuard(pageId,actor,row):async()=>{throw new DatasetError('The page is unavailable; nothing was written.',404);}};
  }}),
 ...resolverPorts,
};
/** Original request identity and ACLs guard both SDL and executions. */
export async function pageGraphql(request:Request,pageId:string):Promise<Response>{
 if(request.method==='POST'&&request.headers.get('origin')==='null')return opaqueOriginRead(request,pageId);
 return answer(request,pageId);
}
/** An opaque origin's read is never credentialed by the browser: no cookie-borne answer is exposed. */
const READ_CORS={'Access-Control-Allow-Origin':'*','Cache-Control':'no-store'};
/**
 * AN OPAQUE ORIGIN'S READ: a sandboxed document no app frame relays for (the exporter's capture, document-serving/raw;
 * an anonymous owner host's page) reads its own page's data here directly (html-runtime/domain-reads). Every
 * credential header is dropped, so no cookie or bearer the browser attaches ever reads here; only queries run.
 *
 * It reads as NOBODY, or as the requester an EXPORT KEY was minted for (lib/export read-key, carried in the body from
 * the capture's own address): the export door admitted that requester and the capture shows what they may read, so
 * the read runs under their access, re-checked at read time like any reader's, and never anyone else's. A key that
 * does not verify for this page reads as nobody. The `*` CORS exposes the answer to that capture page alone: the key
 * is seconds-long, scoped to this page and never shown to a reader.
 */
async function opaqueOriginRead(request:Request,pageId:string):Promise<Response>{
 const headers=new Headers(request.headers);
 for(const name of CREDENTIAL_HEADERS)headers.delete(name);
 const body=await request.text();
 let parsed:unknown=null;try{parsed=JSON.parse(body);}catch{/* refused below */}
 const {query,operationName}=(parsed&&typeof parsed==='object'?parsed:{}) as {query?:unknown;operationName?:unknown};
 const kind=typeof query==='string'?pageOperationKind(query,typeof operationName==='string'?operationName:undefined):null;
 if(kind==='mutation')return json({data:null,errors:[{message:DOMAIN_READ_ONLY_MESSAGE}]},403,READ_CORS);
 if(kind!=='query')return json({error:'invalid_graphql_operation'},400,READ_CORS);
 const key=(parsed as {key?:unknown}|null)?.key;
 const reader=typeof key==='string'?exportKeyReader(pageId,key):null;
 const guest=new Request(request.url,{method:'POST',headers,body,signal:request.signal});
 const answered=await runWithRequest(guest,()=>answer(guest,pageId,reader??undefined));
 const cors=new Headers(answered.headers);
 cors.set('access-control-allow-origin','*');cors.delete('access-control-allow-credentials');
 return new Response(answered.body,{status:answered.status,statusText:answered.statusText,headers:cors});
}
/** `reader`: an export capture's requester (opaqueOriginRead), read as given; otherwise the request's own credential. */
async function answer(request:Request,pageId:string,reader?:AccessActor):Promise<Response>{
 const requested=reader?null:await requestOrSessionActor(request);
 // An export reader carries no cookie, so no same-site guard applies; its writes were refused before it got here.
 if(requested&&refusesCrossSite(request,requested))return json({error:'forbidden'},403);
 const actor:AccessActor=reader??requested!;
 try{
  const admitted=await getArtifactHeaderById(pageId);if(!admitted)throw Error('page_unavailable');
  const verifyPage=pageVerifier(request,pageId,actor,reader,admitted);
  const readHeaders={'Cache-Control':'no-store',[REVALIDATE_ACTOR_HEADER]:'1'};
  if(request.method==='GET'){
   const revision=new URL(request.url).searchParams.get('revision')??undefined;
   const page=await readHtmlPage(actor,pageId,revision);
   const sdl=await operations(actor,page,{signal:request.signal}).schema(actor,pageId,page.revision);
   await verifyPage(page.revision);
   return json({sdl,revision:page.revision},200,readHeaders);
  }
  // Readership first: a page this reader cannot read answers exactly as a missing one (the uniform 404), whatever
  // the body or Idempotency-Key; only then is the request itself judged.
  const head=await readHtmlPage(actor,pageId);
  const body=await readJson(request);
  if(!body||typeof body.query!=='string'||typeof body.revision!=='string'||(body.operationName!==undefined&&typeof body.operationName!=='string')||(body.variables!==undefined&&(!body.variables||typeof body.variables!=='object'||Array.isArray(body.variables))))return json({error:'invalid_graphql_request'},400);
  // One Idempotency-Key per client mutation (@afbin/apollo): a generated-API write replays its receipt under it.
  const idempotencyKey=request.headers.get('idempotency-key')??undefined;
  if(idempotencyKey!==undefined&&!IDEMPOTENCY_KEY.test(idempotencyKey))return json({error:'invalid_idempotency_key'},400);
  const operationKind=pageOperationKind(body.query,typeof body.operationName==='string'?body.operationName:undefined);
  if(!operationKind||(body.operation!==undefined&&body.operation!==operationKind))return json({error:'invalid_graphql_operation'},400);
  // An export reader reads; never more (opaqueOriginRead refused its writes already).
  if(reader&&operationKind!=='query')return json({data:null,errors:[{message:DOMAIN_READ_ONLY_MESSAGE}]},403);
  if(operationKind==='mutation'&&head.revision!==body.revision)return json({error:'archived_page_readonly'},403);
  // The head just read is this revision when the request names it: one read of the page's source, not two.
  const page=body.revision===head.revision?head:await readHtmlPage(actor,pageId,body.revision);
  const operation:PageOperationRequest={pageId,revision:body.revision,query:body.query,...(body.variables?{variables:body.variables as HtmlJsonObject}:{}),...(typeof body.operationName==='string'?{operationName:body.operationName}:{})};
  const scope={signal:request.signal};
  if(operationKind==='mutation'){
   const written=await operations(actor,page,{...scope,...(idempotencyKey?{idempotencyKey}:{}),commitGuard:pageCommitGuard(pageId,actor,admitted)}).execute(actor,operation,request.signal);
   // A write's reply (fresh, replayed or refused) leaves only while the reader may still read the page.
   await verifyPage(page.revision);
   return json(written);
  }
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
