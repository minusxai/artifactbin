import { requestOrSessionActor, refusesCrossSite } from '@/lib/authentication';
import { accountOf } from '@/lib/accounts';
import {getOwnedArtifactFor} from '@/lib/artifacts';
import {readHtmlPage} from '@/lib/html-publication';
import {getHtmlBackendVersion} from '@/lib/html-backends';
import {backendSecrets} from '@/lib/html-backend-secrets';
import {declaresResolverTest} from '@/lib/page-operations';
import {functionSchedulesOf} from '@/lib/function-schedules';
import {json,unauthorized} from '@/lib/http';
import {dataServices} from '@/lib/platform';
import {parseViewerBinding,VIEWER_CONNECTION_KIND,type ViewerBinding} from '@artifactbin/contracts';
type Context={params:Promise<{id:string}>};
/**
 * GET — the page owner's Resolvers panel: each resolver on the head revision with its declared secrets (name → bound
 * host), which of them have a value, whether it offers Test connection, and its scheduled functions with their last
 * outcome (lib/function-schedules: a failure's code, the function's message and the owner-only detail).
 * Values are never read. `revision` is what Test connection runs `test` against: a legacy file's GraphQL field, or a
 * function file's (`functions`: typeDefs-free) `test` function through `/fn/test`.
 *
 * `bindings`: each set viewer name (`'viewer'`) with what it is bound to, `{service, params}`. It holds no credential,
 * so the panel shows it. `data_services`: the ids a viewer name may be bound to (DATA_SERVICES__TRUSTED). A group-owned
 * page's backends are the group's: its direct editors see what is set, as they may set its bindings (the secrets route).
 */
export async function GET(request:Request,context:Context){
 const actor=await requestOrSessionActor(request);if(refusesCrossSite(request,actor))return json({error:'forbidden'},403);if(!actor.userId&&!actor.tokenId)return unauthorized(request);
 const {id}=await context.params;
 try{
  const owned=await getOwnedArtifactFor(actor,id);
  if(!owned)return json({error:'not_found'},404);
  const page=await readHtmlPage(actor,id),account=accountOf(actor),schedules=await functionSchedulesOf(id);
  const resolvers=await Promise.all(page.links.flatMap(link=>link.kind==='backend'?[link]:[]).map(async link=>{
   const backend=await getHtmlBackendVersion(link.backendId,link.version);
   if(!backend||backend.pageId!==id)return null;
   const secrets=backend.secretHosts??{};
   const scope={ownerId:backend.ownerId,backendId:backend.backendId};
   const set=backend.ownerId===account||(!!owned.group_id&&backend.ownerId===owned.group_id)?(await backendSecrets.names(scope)).filter(name=>name in secrets):[];
   const bindings:Record<string,ViewerBinding>={};
   for(const name of set.filter(name=>secrets[name]===VIEWER_CONNECTION_KIND)){
    try{bindings[name]=parseViewerBinding(JSON.parse(await backendSecrets.get(scope,[name],name)));}catch{/* unreadable: shown as set, without what it binds */}
   }
   const scheduled=schedules.filter(schedule=>schedule.link===link.name).map(({link:_link,...schedule})=>schedule);
   const functions=!backend.typeDefs;
   return {name:link.name,backendId:link.backendId,version:link.version,functions,test:functions?Object.hasOwn(backend.functions??{},'test'):declaresResolverTest(backend.typeDefs),secrets,set,bindings,schedules:scheduled};
  }));
  return json({revision:page.revision,resolvers:resolvers.filter(Boolean),data_services:dataServices().map(service=>service.id)},200,{'Cache-Control':'no-store'});
 }catch{return json({error:'not_found'},404);}
}
