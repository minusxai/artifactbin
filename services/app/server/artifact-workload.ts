/** Service workload door: fixed callback, fresh admission/final fences and canonical bounded static operations.
 * Final creation admission precedes dispatch; cancellation cannot retract an already committed result.
 */
import {createHash,randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {artifactWorkloadOperationJson,ARTIFACT_WORKLOAD_LIMIT,isArtifactWorkloadOperation,isWorkloadBinding,type Actor,type ArtifactWorkloadScope,type ArtifactWorkloadOperation} from '@artifactbin/contracts';
import {readBody,BodyTooLargeError} from '@artifactbin/utils';
import {serviceAudiences,getDb,PUBLIC_BASE_URL} from '@/lib/platform';
import {createWorkloadArtifact,getArtifactById,WorkloadCreationRefusal} from '@/lib/artifacts';
import {readArtifactSnapshot} from '@/lib/annotations';
import {withReadOnlyAccessFacts} from '@/lib/artifact-access';
import {parseContentInput} from '@/lib/publish';
import {htmlPageDeclarations,htmlAssetLinks,htmlPwaSettings,isStaticWorkloadHtml} from '@/lib/html-page';
const reply=(body:unknown,status=200)=>Response.json(body,{status,headers:{'cache-control':'no-store'}});
export async function artifactWorkload(request:Request,actor:Actor|null|undefined):Promise<Response>{
 const denied=()=>reply({error:'forbidden'},403);
 if(actor?.credential!=='workload'||!isWorkloadBinding(actor.workload)||request.signal.aborted)return denied();
 const principal=actor.workload,config=serviceAudiences().find(service=>service.id===principal.issuerId)?.artifactWorkloads;
 if(!config)return denied();
 try{
  const body=JSON.parse(await readBody(request,{limit:ARTIFACT_WORKLOAD_LIMIT+8192,as:'text'}));
  if(!body||Object.keys(body).length!==1||!isArtifactWorkloadOperation(body.operation))return reply({error:'bad_request'},400);
  const operation:ArtifactWorkloadOperation=body.operation;
  const digest=createHash('sha256').update(artifactWorkloadOperationJson(operation)).digest('hex');
  const authorize=async(phase:'admission'|'final'):Promise<ArtifactWorkloadScope|null>=>{
   if(request.signal.aborted)return null;
   const nonce=randomUUID();
   const response=await fetch(config.authorizationUrl,{method:'POST',redirect:'error',headers:{'content-type':'application/json',authorization:'Bearer '+config.authorizationSecret},body:JSON.stringify({principal,operation,digest,nonce,phase}),signal:AbortSignal.any([request.signal,AbortSignal.timeout(10000)])});
   if(!response.ok){await response.body?.cancel();return null;}
   const answer=JSON.parse(await readBody(response,{limit:32768,as:'text'})),scope=answer?.scope;
   if(request.signal.aborted||answer.digest!==digest||answer.nonce!==nonce||!scope||scope.allowed!==true||!isWorkloadBinding(scope.principal)||!isDeepStrictEqual(scope.principal,principal)||!['viewer','editor'].includes(scope.role)||scope.visibility!=='private'||!Array.isArray(scope.readArtifactIds)||scope.readArtifactIds.length>128||scope.readArtifactIds.some((id:unknown)=>typeof id!=='string'||id.length>128)||(scope.rootFolderId!==null&&(typeof scope.rootFolderId!=='string'||!scope.rootFolderId||scope.rootFolderId.length>128)))return null;
   if(operation.kind==='artifact-read'&&!scope.readArtifactIds.includes(operation.artifactId))return null;
   if(operation.kind==='artifact-create'&&(scope.role!=='editor'||!scope.rootFolderId||typeof scope.creationKey!=='string'||!scope.creationKey||scope.creationKey.length>200||(scope.expectedTitle!==undefined&&scope.expectedTitle!==operation.title)))return null;
   return scope;
  };
  const scope=await authorize('admission');if(!scope)return denied();
  if(operation.kind==='artifact-read'){
   const read=async()=>{
    if(!(await (await getDb()).query('SELECT 1 FROM groups WHERE id=$1 AND deleted_at IS NULL',[principal.groupId])).rows.length)return null;
    const row=await getArtifactById(operation.artifactId);
    if(!row||row.deleted_at||row.group_id!==principal.groupId||row.format!=='html')return null;
    const snapshot:Record<string,unknown>|null=await withReadOnlyAccessFacts(()=>readArtifactSnapshot({userId:null,tokenId:null,email:null,documentEditor:false,workload:{...scope,writeArtifactIds:[]}},operation.artifactId,PUBLIC_BASE_URL,{currentReadOnly:true}));
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
