/** Service delegation contracts (operator configuration and trusted transport):

- Delegated canonical reads use only the auth-owned `artifact-read-grant` and `artifact-read` identity RPCs.
  A service must opt in with `artifact_reads: true` in `IDENTITY__SERVICE_AUDIENCES` and present its own
  introspection secret. Issue accepts only `{token}` (a live exchanged service token); read accepts only
  `{grant, artifact_id}`. Grants last one hour, remain bound to the original person/service/parent, and are
  never general API bearers. Keep them in trusted encrypted service storage, never agent sandboxes.
  The fixed app read seam returns allowlisted current canonical source without checkpoints or invitation
  stamping; the auth owner buffers at most 200 KiB and rechecks parent/account and current artifact access
  before delivery. Absent and inaccessible artifacts both answer 404.

- Chart drawing for a relay is `/api/internal/identity/chart-image` (contracts `CHART_IMAGE_PATH`), with the same
  `artifact_reads` opt-in and per-service introspection secret, and no grant: it reads no data, so a scheduled run
  with no personal grant may use it. The body is exactly a subset of `{chart, rows, width, height, theme,
  designSystem}` holding `chart` and `rows`, at most 512 KiB. Identity forwards it to the fixed app seam
  `/api/internal/chart-image` as the anonymous actor; the seam refuses any other caller, draws it with the
  renderer `render_chart_image` uses (lib/viz chart-image.server: 5,000 rows, 160-1600 x 120-1200 px, a PNG of at
  most 140,000 bytes, one worker thread with a 5 s deadline) and answers `{mime, width, height, bytes, data}` or
  `{error, message, hint?}`. Identity passes the status and JSON through, buffered to at most 200 KiB.

- Saved-page evidence adds exact operations `{kind:'page-evidence-schema',pageId,revision}` and
  `{kind:'page-evidence-sql',pageId,revision,sql,params}` (digest fields in that order). Both callbacks must
  supply a viewer/private/null-root scope, page readership AND `pageDatasetSelect:{pageId,revision,
  links:[{name,datasetId,revision}],role:'viewer'}`. Only approved canonical pinned stored links mount;
  the page must still be at that exact current revision and every dataset in its exact live owning group.
  The invocation-only dataset viewer decision uses current select policies, never a human or editor bypass.
  Final callback, buffered-result cap (200 KiB), fresh dataset/archive/policy fences and canonical page fence
  precede delivery. No connection, default/live binding, author code or generic dataset authority is added.
- Personal evidence: `/api/internal/identity/page-evidence` accepts exactly `{grant,operation}` using the
  existing artifact_reads opt-in, per-service introspection secret and purpose-only arg_ grant. Identity
  checks account, grant expiry and original parent before/after bounded buffering. Its fixed internal app
  seam POST `/api/internal/page-evidence` accepts `{operation}` then `{operation,fingerprint}`: the first
  returns internal `{body,fingerprint}`, the second recomputes schema/access/policy identity without row
  SQL. The digest covers page identity, current dataset metadata and canonical policy decisions; it conveys
  no authority and never leaves identity. Both use the actual verified human and ordinary current ACLs.

- Service workload RPC is `/api/internal/identity/artifact-workload`, authenticated only by the opted-in service's
  own introspection secret. `artifact_workloads` in that audience config holds the operator's fixed
  `authorization_url` and `authorization_secret`; both identity and app hosts need the same configuration.
  The app calls that URL with Bearer callback authorization, no redirects, a 10-second timeout and a 32-KiB
  response cap. Only a signed auth-owned service-workload principal crosses the internal transport; caller
  scopes and human impersonation are refused. Native host workload authority retains its independently admitted publication capabilities.
  The request is exactly `{principal,operation}`. Operations are canonical group HTML read
  `{kind:'artifact-read',artifactId,source:'canonical'}` or new private static HTML
  `{kind:'artifact-create',title,html}`. HTML/output are bounded at 200 KiB, title at 500 characters.
  Each callback receives `{principal,operation,digest,nonce,phase}` (`admission` then `final`); digest is SHA-256
  of JSON with operation fields in the order shown. It must echo digest/nonce and a fresh scope containing
  `allowed:true`, exact `principal`, `role`, `readArtifactIds`, `rootFolderId`, `visibility:'private'`, and for
  creation an opaque stable `creationKey` (at most 200 characters), trusted `publication:{maxArtifacts,maxBytes}`
  (positive integers, at most 10,000 artifacts and 1 GiB cumulatively across that grant), optionally trusted `expectedTitle`.
  The stable key is the canonical publication slot; existing group/operator quotas additionally apply. The RPC
  uses the same canonical workload actor, placement validation, publication intent, cumulative charge and output
  graph as native host publication; no separate group writer or identity bypass exists.
  Scope comes from the service's persisted current authority, never caller assertions. Creation requires editor,
  exact same-group live folder/ancestry, no data declarations, references, remote ingestion or bundles.
  Author scripts, event handlers, embedded contexts, forms, automatic URL loads and CSS URL/imports are refused;
  the exact platform core loader and inert safe navigation links remain allowed.
  Durable creation receipts bind issuer/subject/grant/group and stable slot/action key, survive deletion and
  atomically commit with the page. Same payload replays its original ID; changed payload conflicts; a deleted
  result returns 410 with its ID and is never recreated. Cancellation before final admission refuses dispatch;
  after final admission it cannot retract committed creation. Callback credentials remain operator secrets.

 */
/** Service workload door: fixed callback, fresh admission/final fences and canonical bounded static operations.
 * Final creation admission precedes dispatch; cancellation cannot retract an already committed result.
 */
import {pageEvidenceStep,preparePageEvidence} from '@/lib/page-doors';
import {isPageDatasetSelect} from '@artifactbin/contracts';
import {createHash,randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {artifactWorkloadOperationJson,ARTIFACT_WORKLOAD_LIMIT,isArtifactWorkloadOperation,isWorkloadBinding,type Actor,type ArtifactWorkloadScope,type ArtifactWorkloadOperation} from '@artifactbin/contracts';
import {readBody,BodyTooLargeError} from '@artifactbin/utils';
import {SQL_READ_WALL_TIMEOUT_MS,serviceAudiences,getDb,PUBLIC_BASE_URL} from '@/lib/platform';
import {readWorkloadOutputPage,createWorkloadArtifact,getArtifactById,WorkloadCreationRefusal} from '@/lib/artifacts';
import {readArtifactSnapshot} from '@/lib/annotations';
import {withReadOnlyAccessFacts} from '@/lib/artifact-access';
import {parseContentInput} from '@/lib/publish';
import {htmlPageDeclarations,htmlAssetLinks,htmlPwaSettings,isStaticWorkloadHtml} from '@/lib/html-page';
const reply=(body:unknown,status=200)=>Response.json(body,{status,headers:{'cache-control':'no-store'}});
export async function artifactWorkload(request:Request,actor:Actor|null|undefined):Promise<Response>{
 const started=performance.now(),original=request;
 request=new Request(original,{signal:AbortSignal.any([original.signal,AbortSignal.timeout(20000)])});
 const denied=()=>reply({error:'forbidden'},403);
 if(actor?.credential!=='workload'||!isWorkloadBinding(actor.workload)||request.signal.aborted)return denied();
 const principal=actor.workload,config=serviceAudiences().find(service=>service.id===principal.issuerId)?.artifactWorkloads;
 if(!config)return denied();
 try{
  const body=JSON.parse(await pageEvidenceStep(request.signal,readBody(request,{limit:ARTIFACT_WORKLOAD_LIMIT+8192,as:'text'})));
  if(!body||Object.keys(body).length!==1||!isArtifactWorkloadOperation(body.operation))return reply({error:'bad_request'},400);
  const operation:ArtifactWorkloadOperation=body.operation;
  if(operation.kind==='page-evidence-schema'||operation.kind==='page-evidence-sql'){
   const remaining=Math.floor(SQL_READ_WALL_TIMEOUT_MS-(performance.now()-started));
   if(remaining<1)return denied();
   // Body admission retains its old ceiling; evidence execution uses the original caller signal.
   request=new Request(original.url,{headers:original.headers,signal:AbortSignal.any([original.signal,AbortSignal.timeout(remaining)])});
  }
  const digest=createHash('sha256').update(artifactWorkloadOperationJson(operation)).digest('hex');
  const authorize=async(phase:'admission'|'final'):Promise<ArtifactWorkloadScope|null>=>{
   if(request.signal.aborted)return null;
   const nonce=randomUUID();
   const callbackSignal=AbortSignal.any([request.signal,AbortSignal.timeout(10000)]);
   const response=await pageEvidenceStep(callbackSignal,fetch(config.authorizationUrl,{method:'POST',redirect:'error',headers:{'content-type':'application/json',authorization:'Bearer '+config.authorizationSecret},body:JSON.stringify({principal,operation,digest,nonce,phase}),signal:callbackSignal}));
   if(!response.ok){void response.body?.cancel().catch(()=>{});return null;}
   const answer=JSON.parse(await pageEvidenceStep(callbackSignal,readBody(response,{limit:32768,as:'text'}))),scope=answer?.scope;
   if(request.signal.aborted||answer.digest!==digest||answer.nonce!==nonce||!scope||scope.allowed!==true||!isWorkloadBinding(scope.principal)||!isDeepStrictEqual(scope.principal,principal)||!['viewer','editor'].includes(scope.role)||scope.visibility!=='private'||!Array.isArray(scope.readArtifactIds)||scope.readArtifactIds.length>128||scope.readArtifactIds.some((id:unknown)=>typeof id!=='string'||id.length>128)||(scope.rootFolderId!==null&&(typeof scope.rootFolderId!=='string'||!scope.rootFolderId||scope.rootFolderId.length>128)))return null;
   if(operation.kind==='artifact-outputs'&&(scope.outputLookup!==true||scope.role!=='viewer'||scope.readArtifactIds.length!==0||scope.rootFolderId!==null||Object.keys(scope).some(key=>!['allowed','principal','role','readArtifactIds','rootFolderId','visibility','outputLookup'].includes(key))))return null;
   if(operation.kind==='artifact-read'&&!scope.readArtifactIds.includes(operation.artifactId))return null;
   if((operation.kind==='page-evidence-schema'||operation.kind==='page-evidence-sql')&&(scope.role!=='viewer'||scope.rootFolderId!==null||new Set(scope.readArtifactIds).size!==scope.readArtifactIds.length||scope.readArtifactIds.some((id:string)=>!/^[A-Za-z0-9_-]{1,128}$/.test(id))||!scope.readArtifactIds.includes(operation.pageId)||!isPageDatasetSelect(scope.pageDatasetSelect)||scope.pageDatasetSelect.pageId!==operation.pageId||scope.pageDatasetSelect.revision!==operation.revision||Object.keys(scope).some(key=>!['allowed','principal','role','readArtifactIds','rootFolderId','visibility','pageDatasetSelect'].includes(key))))return null;
   if(operation.kind==='artifact-create'&&(!scope.publication||!Number.isSafeInteger(scope.publication.maxArtifacts)||scope.publication.maxArtifacts<1||scope.publication.maxArtifacts>10000||!Number.isSafeInteger(scope.publication.maxBytes)||scope.publication.maxBytes<1||scope.publication.maxBytes>1024*1024*1024||scope.role!=='editor'||!scope.rootFolderId||typeof scope.creationKey!=='string'||!scope.creationKey||scope.creationKey.length>200||(scope.expectedTitle!==undefined&&scope.expectedTitle!==operation.title)))return null;
   return scope;
  };
  const scope=await authorize('admission');if(!scope)return denied();
  if(operation.kind==='page-evidence-schema'||operation.kind==='page-evidence-sql'){
   const reader={userId:null,tokenId:null,email:null,documentEditor:false,workload:{...scope,writeArtifactIds:[],publication:undefined}};
   const result=await pageEvidenceStep(request.signal,preparePageEvidence(request,reader,operation,scope.pageDatasetSelect));
   const final=await authorize('final');
   if(!final||!isDeepStrictEqual(final.pageDatasetSelect,scope.pageDatasetSelect))return denied();
   await pageEvidenceStep(request.signal,result.verify());
   return new Response(result.encoded,{status:result.status,headers:{'content-type':'application/json','cache-control':'no-store'}});
  }
  if(operation.kind==='artifact-outputs'){
   const page=await readWorkloadOutputPage(principal,operation.after);
   if(!await authorize('final')||!isDeepStrictEqual(page,await readWorkloadOutputPage(principal,operation.after)))return denied();
   return reply(page);
  }
  if(operation.kind==='artifact-read'){
   const read=async()=>{
    if(!(await (await getDb()).query('SELECT 1 FROM groups WHERE id=$1 AND deleted_at IS NULL',[principal.groupId])).rows.length)return null;
    const row=await getArtifactById(operation.artifactId);
    if(!row||row.deleted_at||row.group_id!==principal.groupId||row.format!=='html')return null;
    const snapshot:Record<string,unknown>|null=await withReadOnlyAccessFacts(()=>readArtifactSnapshot({userId:null,tokenId:null,email:null,documentEditor:false,workload:{...scope,writeArtifactIds:[],publication:undefined}},operation.artifactId,PUBLIC_BASE_URL,{currentReadOnly:true}));
    return snapshot?{id:snapshot.id,title:snapshot.title,format:snapshot.format,version:snapshot.version,html:snapshot.html}:null;
   };
   const source=await read();if(!source)return reply({error:'not_found'},404);
   const encoded=JSON.stringify(source);if(Buffer.byteLength(encoded)>ARTIFACT_WORKLOAD_LIMIT)return reply({error:'too_large'},413);
   if(!await authorize('final')||!isDeepStrictEqual(source,await read()))return denied();
   return new Response(encoded,{headers:{'content-type':'application/json','cache-control':'no-store'}});
  }
  // Canonical HTML admission does no remote ingestion. Dependencies/data doors are excluded.
  const declarations=htmlPageDeclarations(operation.html),assets=htmlAssetLinks(operation.html),pwa=htmlPwaSettings(operation.html);
  if(!isStaticWorkloadHtml(operation.html)||assets.imageUrls.length||declarations.datasets.length||declarations.connections.length||declarations.queries.length||assets.refs.length||pwa.icon||/\b(?:ref:|default:)|data-af\s*=\s*["'](?:dataset|sql|mutation|publication|offline-data|offline-sql)/i.test(operation.html))return reply({error:'static_html_required'},400);
  const prepared=await parseContentInput({html:operation.html},{creating:true,loadRef:async()=>null});
  if(prepared instanceof Response)return prepared;
  if(prepared.format!=='html')return reply({error:'static_html_required'},400);
  const final=await authorize('final');
  if(!final||final.rootFolderId!==scope.rootFolderId||final.creationKey!==scope.creationKey||request.signal.aborted)return denied();
  const result=await createWorkloadArtifact(final,{...prepared,title:operation.title},digest);
  return reply(result.body,result.status);
 }catch(error){if(error instanceof WorkloadCreationRefusal)return reply({error:error.status===413?'too_large':'forbidden'},error.status);return reply({error:error instanceof BodyTooLargeError?'too_large':'workload_unavailable'},error instanceof BodyTooLargeError?413:503);}
}
