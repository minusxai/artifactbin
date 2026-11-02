import {createHash} from 'node:crypto';
import {actorOf} from '@artifactbin/utils';
import type {RunnerJson,RunStart} from '@artifactbin/contracts';
import {getHtmlBackendVersion,getHtmlBackendStore,setHtmlBackendStore} from '@/lib/html-backends';
import {json} from '@/lib/http';
import {fetchPageBackendResource,fetchResolverResource,ResolverFetchError} from './public-fetch';
import {readPinnedBackendSecret} from '@/lib/html-backend-secrets';
import {pageBackendCapability} from './backend';
const store={get:getHtmlBackendStore,set:setHtmlBackendStore};
export async function localPageBackendCapability(request:RunStart,operation:string,input:RunnerJson,signal?:AbortSignal):Promise<RunnerJson>{
 return pageBackendCapability(store,request,operation,input,getHtmlBackendVersion,url=>fetchPageBackendResource(url,signal),readPinnedBackendSecret,(args,secrets)=>fetchResolverResource(args,secrets,signal));
}
/** Sole retained runner endpoint: accepts only host-attested, immutable file store calls. */
export async function pageBackendOperation(request:Request,operation:string,input:RunnerJson,documentSource?:string):Promise<Response>{
 const identity=actorOf(request),pin=identity?.runner;
 if(!pin||!identity?.userId||!operation.startsWith('pageBackend.')||typeof documentSource!=='string'||createHash('sha256').update(documentSource).digest('hex')!==pin.sourceHash)return json({error:'backend_capability_forbidden'},403);
 try{
  const backend=await getHtmlBackendVersion(pin.artifactId,pin.version);
  if(!backend||backend.ownerId!==identity.userId||backend.compiled!==documentSource)return json({error:'backend_capability_forbidden'},403);
  return json(await localPageBackendCapability({requestId:pin.runId,pageBackendOperation:pin.pageBackendOperation,userId:identity.userId,artifactId:pin.artifactId,artifactVersion:pin.version,program:{source:documentSource,language:'javascript'},input:{kind:'invoke',principal:{tenant:backend.pageId,subject:null}}},'artifactbin.'+operation,input,request.signal));
 }catch(error){
  // A resolver fetch refusal carries only a code and a fixed detail: the remote runner hands it to the resolver as the in-process host does.
  if(error instanceof ResolverFetchError)return json({error:error.message},400);
  return json({error:'backend_capability_failed'},403);
 }
}
