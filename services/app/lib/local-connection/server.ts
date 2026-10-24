import {createHash,randomBytes} from 'node:crypto';
import {attachActor} from '@artifactbin/utils';
import {ANONYMOUS_ACTOR,requestOrSessionActor} from '@/lib/accounts';
import {effectiveRole,getArtifactHeaderById} from '@/lib/artifacts';
import {readHtmlPage} from '@/lib/html-publication';
import {isCrossSiteRequest,json,readJson,baseUrl} from '@/lib/http';
import {pageOperationKind} from '@/lib/page-operations';
import {pageGraphql} from '@/lib/page-graphql';
import {currentRequest,runWithRequest} from '@/lib/platform/request-context';
import {createConnectionRegistry,validLinkedDocument} from './registry';
import {LocalConnectionError} from './contracts';
const approved=new WeakSet<Request>();
const registry=createConnectionRegistry({random:()=>randomBytes(32).toString('base64url'),async inspect(identity,previous){
 const request=currentRequest();if(!request||identity.platformOrigin!==baseUrl(request))throw new LocalConnectionError('invalid_identity');
 const authenticated=previous?.authenticated??approved.has(request);
 const actor=authenticated?await requestOrSessionActor(request,{revalidate:true}):ANONYMOUS_ACTOR;
 let page;try{page=await readHtmlPage(actor,identity.artifactId);}catch{throw new LocalConnectionError(actor.userId||actor.tokenId?'unavailable':'signin_required');}
 if(page.revision!==identity.baseRevision||createHash('sha256').update(page.html).digest('hex')!==identity.sourceDigest)throw new LocalConnectionError('stale');
 const row=await getArtifactHeaderById(identity.artifactId);if(!row)throw new LocalConnectionError('unavailable');
 const role=await effectiveRole(row,actor);if(role==='none')throw new LocalConnectionError('unavailable');
 // Include identity attributes that can affect admission; never forward this key to local files.
 return {identity,role,authenticated,actor:JSON.stringify(actor)};
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
  if(body.authorizePrivate===true)approved.add(request);
  else if(body.checkSession===true){const actor=await requestOrSessionActor(request,{revalidate:true});if(actor.userId||actor.tokenId)throw new LocalConnectionError('permission_required');}
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
  const guestHeaders=new Headers(request.headers);guestHeaders.delete('authorization');guestHeaders.delete('cookie');
  const execution=admission.authenticated?request:attachActor(new Request(request,{headers:guestHeaders}),{credential:'none'});
  const response=await runWithRequest(execution,()=>pageGraphql(execution,artifactId));
  // Existing page operation authority owns commit checks and durable mutation receipts.
  // Reads get another live connection fence; no response/transport failure is replayed.
  if(response.ok){
   const isQuery=typeof payload.query==='string'&&pageOperationKind(payload.query,typeof payload.operationName==='string'?payload.operationName:undefined)==='query';
   if(isQuery)await registry.authorize(capability,artifactId);
  }
  return response;
 }catch(error){return refusal(error);}});
}
