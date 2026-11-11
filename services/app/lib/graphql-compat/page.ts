/** DEPRECATED: GraphQL compatibility for pages published before SQL. Do not use in new code; do not extend. */
/**
 * THE PAGE GRAPHQL DOOR (`/api/artifacts/<page>/graphql`): the page schema composed from its dataset links'
 * generated APIs, read and executed as the request's reader.
 * Admission, verification and the commit guard are the plain doors' own (lib/page-doors).
 */
import {REVALIDATE_ACTOR_HEADER,type HtmlJsonObject,type HtmlPageVersion,type PageNamespaceSource,type PageOperationRequest} from '@artifactbin/contracts';
import type { AccessActor } from '@/lib/accounts';
import { getArtifactHeaderById, editablePage } from '@/lib/artifacts';
import { pageRole } from '@/lib/dataset-permissions';
import {readHtmlPage} from '@/lib/html-publication';
import {createPageOperations,pageOperationKind} from '@/lib/page-operations';
import {CREDENTIAL_HEADERS,datasetLinks,IDEMPOTENCY_KEY,pageCommitGuard,pageVerifier,RACED_READ_ATTEMPTS} from '@/lib/page-doors';
import {loadPageDatasets,type PageCommitGuard,type PageDatasets} from './dataset/hasura';
import {people} from '@/lib/datasets';
import {getDb,runWithRequest} from '@/lib/platform';
import {json,readJson} from '@/lib/http';
import { requestOrSessionActor, refusesCrossSite } from '@/lib/authentication';
import {DOMAIN_READ_ONLY_MESSAGE} from '@artifactbin/contracts/domain-footer';
import {exportKeyReader} from '@/lib/export';
interface OperationScope{retainReadFence?:(verify:()=>Promise<void>)=>void;idempotencyKey?:string;signal?:AbortSignal;commitGuard?:PageCommitGuard}
function operations(actor:AccessActor,page:HtmlPageVersion,scope:OperationScope){
 const {retainReadFence}=scope;
 const linked=datasetLinks(page);
 // The dataset links load once per request, for this reader's role through this page: the composed SDL and the execution share it.
 let loaded:Promise<PageDatasets>|undefined;
 const datasets=()=>loaded??=loadPageDatasets(actor,linked,{pageId:page.pageId,...(retainReadFence?{retainReadFence}:{}),...(scope.idempotencyKey?{idempotencyKey:scope.idempotencyKey}:{}),...(scope.commitGuard?{commitGuard:scope.commitGuard}:{})},scope.signal??new AbortController().signal);
 const sources=async():Promise<readonly PageNamespaceSource[]>=>linked.length?(await datasets()).sources.map(source=>({...source,kind:'dataset-hasura' as const})):[];
 // The page this request already read for this reader and revision is not read again (its source is the costly part).
 const readPage:typeof readHtmlPage=(reader,id,revision)=>reader===actor&&id===page.pageId&&revision===page.revision?Promise.resolve(page):readHtmlPage(reader,id,revision);
 // The built-in viewer's name is the reader's own person card (never another person's, never an email).
 const viewerName=async(subject:string)=>(await people(await getDb(),[subject]))[subject]?.name??null;
 return createPageOperations({readPage,role:async(a,id)=>{const row=await getArtifactHeaderById(id);return row?pageRole(row,a):null;},sources,datasets:async()=>linked.length?datasets():undefined,viewerName,
  // The live-region editor's own check (lib/region-sessions opens a region only on an `editablePage`).
  canEdit:async(reader,id)=>!!await editablePage(await getDb(),reader,id)});
}
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
