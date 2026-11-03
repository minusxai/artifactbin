import { requestOrSessionActor, refusesCrossSite } from '@/lib/authentication';
import { accountOf } from '@/lib/accounts';
import {getOwnedArtifactFor} from '@/lib/artifacts';
import {readHtmlPage} from '@/lib/html-publication';
import {getHtmlBackendVersion} from '@/lib/html-backends';
import {backendSecrets} from '@/lib/html-backend-secrets';
import {declaresResolverTest} from '@/lib/page-operations';
import {json,unauthorized} from '@/lib/http';
type Context={params:Promise<{id:string}>};
/**
 * GET — the page owner's Resolvers panel: each resolver on the head revision with its declared secrets (name → bound
 * host), which of them have a value, and whether it offers Test connection.
 * Values are never read. `revision` is what Test connection runs the `test` field against.
 */
export async function GET(request:Request,context:Context){
 const actor=await requestOrSessionActor(request);if(refusesCrossSite(request,actor))return json({error:'forbidden'},403);if(!actor.userId&&!actor.tokenId)return unauthorized(request);
 const {id}=await context.params;
 try{
  if(!await getOwnedArtifactFor(actor,id))return json({error:'not_found'},404);
  const page=await readHtmlPage(actor,id),account=accountOf(actor);
  const resolvers=await Promise.all(page.links.flatMap(link=>link.kind==='backend'?[link]:[]).map(async link=>{
   const backend=await getHtmlBackendVersion(link.backendId,link.version);
   if(!backend||backend.pageId!==id)return null;
   const secrets=backend.secretHosts??{};
   const set=backend.ownerId===account?(await backendSecrets.names({ownerId:backend.ownerId,backendId:backend.backendId})).filter(name=>name in secrets):[];
   return {name:link.name,backendId:link.backendId,version:link.version,test:declaresResolverTest(backend.typeDefs),secrets,set};
  }));
  return json({revision:page.revision,resolvers:resolvers.filter(Boolean)},200,{'Cache-Control':'no-store'});
 }catch{return json({error:'not_found'},404);}
}
