import { requestOrSessionActor, refusesCrossSite } from '@/lib/authentication';
import { accountOf } from '@/lib/accounts';
import {getOwnedArtifactFor} from '@/lib/artifacts';
import {getHtmlBackendVersion} from '@/lib/html-backends';
import {backendSecrets} from '@/lib/html-backend-secrets';
import {declaresResolverTest} from '@/lib/page-operations';
import {json,readJson,unauthorized} from '@/lib/http';
import {isResolverDatabaseKind,parseViewerBinding,VIEWER_CONNECTION_KIND} from '@artifactbin/contracts';
import {validateViewerBinding,ViewerBindingError,VIEWER_BINDING_STATUS} from '@/lib/data-services';
type Context={params:Promise<{id:string;version:string}>};
async function handle(request:Request,context:Context){
 const actor=await requestOrSessionActor(request);if(refusesCrossSite(request,actor))return json({error:'forbidden'},403);if(!actor.userId&&!actor.tokenId)return unauthorized(request);
 const {id,version}=await context.params,backend=await getHtmlBackendVersion(id,version);
 if(!backend)return json({error:'not_found'},404);
 // WHO MAY: a personal page's backend owner (still owning the page to change anything), or, on a GROUP-owned page
 // (its backends owned by the group), a direct editor of the owning group, for its 'viewer' bindings only:
 // a binding holds no credential and reads data as each viewer, while every other name is a person's credential.
 const owner=backend.ownerId===accountOf(actor),page=owner&&request.method==='GET'?null:await getOwnedArtifactFor(actor,backend.pageId);
 const group=!!page?.group_id&&backend.ownerId===page.group_id;
 if(!group&&(!owner||(request.method==='PUT'&&!page)))return json({error:'not_found'},404);
 const scope={ownerId:backend.ownerId,backendId:backend.backendId};
 try{
  // Names and bound hosts only, never values; `test` says whether the owner can run Test connection.
  if(request.method==='GET')return json({names:await backendSecrets.names(scope),secrets:backend.secretHosts??{},test:declaresResolverTest(backend.typeDefs)});
  const body=await readJson(request);if(!body||typeof body.name!=='string'||!backend.secretBindings?.includes(body.name))return json({error:'invalid_secret_binding'},400);
  // A name bound to a database kind holds a connection ({host,port,database,user,password,tls?,ca?}) of that kind,
  // stored sealed like a value; a body `kind` other than the declared one is refused.
  const kind=backend.secretHosts?.[body.name];
  if(group&&kind!==VIEWER_CONNECTION_KIND)return json({error:'backend_credentials_owner_required'},403);
  // A name declared 'viewer' holds the author's binding ({service, params}: a configured data service and parameters
  // only it reads), no credential; the service must grant the account setting it a session with those params first.
  if(request.method==='PUT'&&kind===VIEWER_CONNECTION_KIND){
   let binding;try{binding=parseViewerBinding(body.binding);}catch{return json({error:'invalid_binding'},400);}
   try{await validateViewerBinding(accountOf(actor),binding,backend.pageId);}catch(error){if(error instanceof ViewerBindingError)return json({error:error.code},VIEWER_BINDING_STATUS[error.code]);throw error;}
   await backendSecrets.put(scope,body.name,JSON.stringify(binding));
  }
  else if(request.method==='PUT'&&isResolverDatabaseKind(kind)){try{await backendSecrets.putConnection(scope,body.name,kind,body.connection);}catch{return json({error:'invalid_connection'},400);}}
  else if(request.method==='PUT'){if(typeof body.value!=='string')return json({error:'invalid_secret'},400);await backendSecrets.put(scope,body.name,body.value);}else await backendSecrets.remove(scope,body.name);
  return json({names:await backendSecrets.names(scope)});
 }catch{return json({error:'backend_secret_failed'},400);}
}
export const GET=handle,PUT=handle,DELETE=handle;
