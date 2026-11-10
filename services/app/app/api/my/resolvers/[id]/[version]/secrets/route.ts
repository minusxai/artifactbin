import { requestOrSessionActor, refusesCrossSite } from '@/lib/authentication';
import { accountOf } from '@/lib/accounts';
import {getOwnedArtifactFor} from '@/lib/artifacts';
import {getHtmlBackendVersion} from '@/lib/html-backends';
import {backendSecrets} from '@/lib/html-backend-secrets';
import {declaresResolverTest} from '@/lib/page-operations';
import {json,readJson,unauthorized} from '@/lib/http';
import {isResolverDatabaseKind,MINUSX_CONNECTION_KIND} from '@artifactbin/contracts';
import {minusxBinding,MinusxBindingError,validateMinusxBinding} from '@/lib/minusx';
type Context={params:Promise<{id:string;version:string}>};
async function handle(request:Request,context:Context){
 const actor=await requestOrSessionActor(request);if(refusesCrossSite(request,actor))return json({error:'forbidden'},403);if(!actor.userId&&!actor.tokenId)return unauthorized(request);
 const {id,version}=await context.params,backend=await getHtmlBackendVersion(id,version);
 if(!backend||backend.ownerId!==accountOf(actor)||(request.method==='PUT'&&!await getOwnedArtifactFor(actor,backend.pageId)))return json({error:'not_found'},404);
 const scope={ownerId:backend.ownerId,backendId:backend.backendId};
 try{
  // Names and bound hosts only, never values; `test` says whether the owner can run Test connection.
  if(request.method==='GET')return json({names:await backendSecrets.names(scope),secrets:backend.secretHosts??{},test:declaresResolverTest(backend.typeDefs)});
  const body=await readJson(request);if(!body||typeof body.name!=='string'||!backend.secretBindings?.includes(body.name))return json({error:'invalid_secret_binding'},400);
  // A name bound to a database kind holds a connection ({host,port,database,user,password,tls?,ca?}) of that kind,
  // stored sealed like a value; a body `kind` other than the declared one is refused.
  const kind=backend.secretHosts?.[body.name];
  // A name declared 'minusx' holds the author's binding ({connection_id, group_id}: a MinusX connection and the group
  // its data is pinned to), no password; it is validated for this owner through MinusX before it is stored.
  if(request.method==='PUT'&&kind===MINUSX_CONNECTION_KIND){
   let binding;try{binding=minusxBinding(body.binding);}catch{return json({error:'invalid_binding'},400);}
   try{await validateMinusxBinding(backend.ownerId,binding);}catch(error){if(error instanceof MinusxBindingError)return json({error:error.code},error.code==='minusx_unavailable'?503:error.code==='minusx_not_configured'?400:403);throw error;}
   await backendSecrets.put(scope,body.name,JSON.stringify(binding));
  }
  else if(request.method==='PUT'&&isResolverDatabaseKind(kind)){try{await backendSecrets.putConnection(scope,body.name,kind,body.connection);}catch{return json({error:'invalid_connection'},400);}}
  else if(request.method==='PUT'){if(typeof body.value!=='string')return json({error:'invalid_secret'},400);await backendSecrets.put(scope,body.name,body.value);}else await backendSecrets.remove(scope,body.name);
  return json({names:await backendSecrets.names(scope)});
 }catch{return json({error:'backend_secret_failed'},400);}
}
export const GET=handle,PUT=handle,DELETE=handle;
