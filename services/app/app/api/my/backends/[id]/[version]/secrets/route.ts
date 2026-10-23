import {requestOrSessionActor,refusesCrossSite,accountOf} from '@/lib/accounts';
import {getOwnedArtifactFor} from '@/lib/artifacts';
import {getHtmlBackendVersion} from '@/lib/html-backends';
import {backendSecrets} from '@/lib/html-backend-secrets';
import {json,readJson,unauthorized} from '@/lib/http';
type Context={params:Promise<{id:string;version:string}>};
async function handle(request:Request,context:Context){
 const actor=await requestOrSessionActor(request);if(refusesCrossSite(request,actor))return json({error:'forbidden'},403);if(!actor.userId&&!actor.tokenId)return unauthorized(request);
 const {id,version}=await context.params,backend=await getHtmlBackendVersion(id,version);
 if(!backend||backend.ownerId!==accountOf(actor)||(request.method==='PUT'&&!await getOwnedArtifactFor(actor,backend.pageId)))return json({error:'not_found'},404);
 const scope={ownerId:backend.ownerId,backendId:backend.backendId};
 try{
  if(request.method==='GET')return json({names:await backendSecrets.names(scope)});
  const body=await readJson(request);if(!body||typeof body.name!=='string'||!backend.secretBindings?.includes(body.name))return json({error:'invalid_secret_binding'},400);
  if(request.method==='PUT'){if(typeof body.value!=='string')return json({error:'invalid_secret'},400);await backendSecrets.put(scope,body.name,body.value);}else await backendSecrets.remove(scope,body.name);
  return json({names:await backendSecrets.names(scope)});
 }catch{return json({error:'backend_secret_failed'},400);}
}
export const GET=handle,PUT=handle,DELETE=handle;
