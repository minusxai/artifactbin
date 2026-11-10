import { requestOrSessionActor, refusesCrossSite } from '@/lib/authentication';
import { accountOf } from '@/lib/accounts';
import {getOwnedArtifactFor} from '@/lib/artifacts';
import {readHtmlPage} from '@/lib/html-publication';
import {getHtmlBackendVersion} from '@/lib/html-backends';
import {backendSecrets} from '@/lib/html-backend-secrets';
import {declaresResolverTest} from '@/lib/page-operations';
import {functionSchedulesOf} from '@/lib/function-schedules';
import {json,unauthorized} from '@/lib/http';
type Context={params:Promise<{id:string}>};
/**
 * GET — the page owner's Resolvers panel: each resolver on the head revision with its declared secrets (name → bound
 * host), which of them have a value, whether it offers Test connection, and its scheduled functions with their last
 * outcome (lib/function-schedules: a failure's code, the function's message and the owner-only detail).
 * Values are never read. `revision` is what Test connection runs `test` against: a legacy file's GraphQL field, or a
 * function file's (`functions`: typeDefs-free) `test` function through `/fn/test`.
 */
export async function GET(request:Request,context:Context){
 const actor=await requestOrSessionActor(request);if(refusesCrossSite(request,actor))return json({error:'forbidden'},403);if(!actor.userId&&!actor.tokenId)return unauthorized(request);
 const {id}=await context.params;
 try{
  if(!await getOwnedArtifactFor(actor,id))return json({error:'not_found'},404);
  const page=await readHtmlPage(actor,id),account=accountOf(actor),schedules=await functionSchedulesOf(id);
  const resolvers=await Promise.all(page.links.flatMap(link=>link.kind==='backend'?[link]:[]).map(async link=>{
   const backend=await getHtmlBackendVersion(link.backendId,link.version);
   if(!backend||backend.pageId!==id)return null;
   const secrets=backend.secretHosts??{};
   const set=backend.ownerId===account?(await backendSecrets.names({ownerId:backend.ownerId,backendId:backend.backendId})).filter(name=>name in secrets):[];
   const scheduled=schedules.filter(schedule=>schedule.link===link.name).map(({link:_link,...schedule})=>schedule);
   const functions=!backend.typeDefs;
   return {name:link.name,backendId:link.backendId,version:link.version,functions,test:functions?Object.hasOwn(backend.functions??{},'test'):declaresResolverTest(backend.typeDefs),secrets,set,schedules:scheduled};
  }));
  return json({revision:page.revision,resolvers:resolvers.filter(Boolean)},200,{'Cache-Control':'no-store'});
 }catch{return json({error:'not_found'},404);}
}
