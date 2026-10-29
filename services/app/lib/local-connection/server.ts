import {createHash,randomBytes} from 'node:crypto';
import {attachActor} from '@artifactbin/utils';
import { ANONYMOUS_ACTOR } from '@/lib/accounts';
import { effectiveRole } from '@/lib/artifact-access';
import { getArtifactHeaderById } from '@/lib/artifacts';
import {readHtmlPage} from '@/lib/html-publication';
import {isCrossSiteRequest,json,readJson,baseUrl} from '@/lib/http';
import {pageOperationKind} from '@/lib/page-operations';
import {pageGraphql} from '@/lib/page-graphql';
import { currentRequest, runWithRequest } from '@/lib/platform';
import {rejectLocalMutation} from './read-only-operation';
import {createConnectionRegistry,validLinkedDocument} from './registry';
import {LocalConnectionError,type SourceObservation,type ConnectionStatus} from './contracts';
const registry=createConnectionRegistry({random:()=>randomBytes(32).toString('base64url'),async inspect(identity){
 const request=currentRequest();if(!request||identity.platformOrigin!==baseUrl(request))throw new LocalConnectionError('invalid_identity');
 const actor=ANONYMOUS_ACTOR;
 let page;try{page=await readHtmlPage(actor,identity.artifactId);}catch{throw new LocalConnectionError('unavailable');}
 const row=await getArtifactHeaderById(identity.artifactId);if(!row)throw new LocalConnectionError('unavailable');
 const role=await effectiveRole(row,actor);if(role==='none')throw new LocalConnectionError('unavailable');
 // Include identity attributes that can affect admission; never forward this key to local files.
 return {identity:{...identity,baseRevision:page.revision,sourceDigest:createHash('sha256').update(page.html).digest('hex')},role:'viewer',authenticated:false,actor:JSON.stringify(actor)};
}});
const refusal=(error:unknown):Response=>{
 const code=error instanceof LocalConnectionError?error.code:'unavailable';
 return json({error:code},code==='signin_required'?401:code==='permission_required'?403:code==='stale'?409:code==='revoked'?410:code==='capacity'?429:code==='invalid_identity'?400:404,{'Cache-Control':'no-store'});
};
/** These are browser same-origin doors, never a cross-origin capability minting API. */
function sameOrigin(request:Request):boolean{
 if(isCrossSiteRequest(request))return false;
 const origin=request.headers.get('origin');if(origin&&origin!==baseUrl(request))return false;
 const site=request.headers.get('sec-fetch-site');return !site||site==='same-origin'||site==='none';
}
export async function grantLocalConnection(request:Request):Promise<Response>{
 if(!sameOrigin(request))return json({error:'forbidden'},403);
 return runWithRequest(request,async()=>{try{
  const body=await readJson(request);if(!validLinkedDocument(body?.identity))throw new LocalConnectionError('invalid_identity');
  if(body.authorizePrivate===true||body.checkSession===true)return json({error:'local_read_only'},403,{'Cache-Control':'no-store'});
  return json(await registry.grant(body.identity),200,{'Cache-Control':'no-store'});
 }catch(error){return refusal(error);}});
}
export async function revokeLocalConnection(request:Request):Promise<Response>{
 if(!sameOrigin(request))return json({error:'forbidden'},403);
 registry.revoke(request.headers.get('X-Af-Local-Capability')??'');return json({disconnected:true},200,{'Cache-Control':'no-store'});
}
export async function localConnectionGraphql(request:Request,artifactId:string):Promise<Response>{
 if(!sameOrigin(request))return json({error:'forbidden'},403);
 return runWithRequest(request,async()=>{try{
  const capability=request.headers.get('X-Af-Local-Capability')??'';
  const admission=await registry.authorize(capability,artifactId);
  const payload=await request.clone().json() as {revision?:unknown;query?:unknown;operationName?:unknown};
  if(payload.revision!==admission.identity.baseRevision)return json({error:'stale'},409);
  const kind=typeof payload.query==='string'?pageOperationKind(payload.query,typeof payload.operationName==='string'?payload.operationName:undefined):null;
  if(!kind)return json({error:'invalid_operation'},400,{'Cache-Control':'no-store'});
  // Deny before schema/backend execution, even for legacy grants or ambient owner cookies.
  if(kind==='mutation')return json(rejectLocalMutation(payload.query as string,typeof payload.operationName==='string'?payload.operationName:undefined),200,{'Cache-Control':'no-store'});
  const guestHeaders=new Headers(request.headers);guestHeaders.delete('authorization');guestHeaders.delete('cookie');
  const execution=attachActor(new Request(request,{headers:guestHeaders}),{credential:'none'});
  const response=await runWithRequest(execution,()=>pageGraphql(execution,artifactId));
  if(response.ok)await registry.authorize(capability,artifactId);
  return response;
 }catch(error){return refusal(error);}});
}

/** Read only current head evidence; a stale claimed base never becomes a grant. */
export async function observeLocalSource(request:Request):Promise<Response>{
 if(!sameOrigin(request))return json({error:'forbidden'},403);
 return runWithRequest(request,async()=>{try{
  const body=await readJson(request);
  if(!validLinkedDocument(body?.identity)||body.identity.platformOrigin!==baseUrl(request))throw new LocalConnectionError('invalid_identity');
  if(body.authorizePrivate===true||body.checkSession===true)return json({error:'local_read_only'},403,{'Cache-Control':'no-store'});
  const actor=ANONYMOUS_ACTOR;
  try{
   await readHtmlPage(actor,body.identity.artifactId);
   const currentActor=ANONYMOUS_ACTOR;
   const current=await readHtmlPage(currentActor,body.identity.artifactId);
   const observation:SourceObservation={remoteDigest:createHash('sha256').update(current.html).digest('hex'),remoteRevision:current.revision};
   return json(observation,200,{'Cache-Control':'no-store'});
  }catch(error){if(error instanceof LocalConnectionError)throw error;throw new LocalConnectionError('unavailable');}
 }catch(error){return refusal(error);}});
}

/** Idle grant validation observes current ACL/account/head without minting new authority. */
export async function localConnectionStatus(request:Request,artifactId:string):Promise<Response>{
 if(!sameOrigin(request))return json({error:'forbidden'},403);
 return runWithRequest(request,async()=>{try{
  const result=await registry.status(request.headers.get('X-Af-Local-Capability')??'',artifactId);
  const status:ConnectionStatus={compatible:result.compatible,role:result.admission.role,remoteDigest:result.admission.identity.sourceDigest,remoteRevision:result.admission.identity.baseRevision};
  return json(status,200,{'Cache-Control':'no-store'});
 }catch(error){return refusal(error);}});
}
