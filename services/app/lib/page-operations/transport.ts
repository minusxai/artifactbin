import {createHash} from 'node:crypto';
import {actorOf} from '@artifactbin/utils';
import type {RunnerCaller,RunnerJson,RunStart} from '@artifactbin/contracts';
import {getHtmlBackendVersion} from '@/lib/html-backends';
import {json} from '@/lib/http';
import {fetchResolverResource,ResolverFetchError} from './public-fetch';
import {readPinnedBackendSecret} from '@/lib/html-backend-secrets';
import {pageBackendCapability,type ResolverDatasets} from './backend';
import {ResolverQueryError} from './query';
/** `datasets` is the composition's caps.query and caps.sql ports (lib/page-graphql `resolverDatasets`); without one, that capability is refused. */
export async function localPageBackendCapability(request:RunStart,operation:string,input:RunnerJson,signal?:AbortSignal,datasets?:ResolverDatasets):Promise<RunnerJson>{
 return pageBackendCapability(request,operation,input,getHtmlBackendVersion,readPinnedBackendSecret,(args,secrets)=>fetchResolverResource(args,secrets,signal),datasets,signal);
}
/**
 * The principal a remote run was admitted for, from the signed pin (resolver code cannot reach it). A pin without
 * a caller (a runner that predates it) keeps the old anonymous subject and no role, which caps.query and caps.sql refuse.
 */
function pinnedPrincipal(tenant:string,caller:RunnerCaller|undefined):RunnerJson{
 return caller?{tenant,subject:caller.subject,role:caller.role}:{tenant,subject:null};
}
/** Sole retained runner endpoint: accepts only host-attested, immutable file store calls. */
export async function pageBackendOperation(request:Request,operation:string,input:RunnerJson,documentSource?:string,datasets?:ResolverDatasets):Promise<Response>{
 const identity=actorOf(request),pin=identity?.runner;
 if(!pin||!identity?.userId||!operation.startsWith('pageBackend.')||typeof documentSource!=='string'||createHash('sha256').update(documentSource).digest('hex')!==pin.sourceHash)return json({error:'backend_capability_forbidden'},403);
 try{
  const backend=await getHtmlBackendVersion(pin.artifactId,pin.version);
  if(!backend||backend.ownerId!==identity.userId||backend.compiled!==documentSource)return json({error:'backend_capability_forbidden'},403);
  return json(await localPageBackendCapability({requestId:pin.runId,pageBackendOperation:pin.pageBackendOperation,userId:identity.userId,artifactId:pin.artifactId,artifactVersion:pin.version,program:{source:documentSource,language:'javascript'},input:{kind:'invoke',principal:pinnedPrincipal(backend.pageId,pin.caller)}},'artifactbin.'+operation,input,request.signal,datasets));
 }catch(error){
  // A resolver fetch refusal carries only a code and a fixed detail: the remote runner hands it to the resolver as the in-process host does.
  if(error instanceof ResolverFetchError||error instanceof ResolverQueryError)return json({error:error.message},400);
  return json({error:'backend_capability_failed'},403);
 }
}
