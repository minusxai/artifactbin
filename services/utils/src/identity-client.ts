/**
 * The identity module over HTTP (contracts `IdentityService` at `IDENTITY_CALL_PATH` on the auth host): the same
 * methods and answers as the in-process store. A refusal comes back as the same `IdentityError` the store throws;
 * a transport failure (unreachable, non-2xx, an unreadable answer, the deadline) throws `identity_unavailable`,
 * never a guessed answer. No credential enters the URL: the service secret rides SERVICE_AUTH_HEADER.
 */
import {IDENTITY_CALL_PATH,IDENTITY_METHODS,IdentityError,SERVICE_AUTH_HEADER,type IdentityService} from '@artifactbin/contracts';

export function identityClient(origin:string,options:{serviceSecret:string;deadlineMs?:number;fetch?:(request:Request)=>Promise<Response>}):IdentityService {
 if(!options.serviceSecret.trim())throw Error('the identity service requires a service secret');
 const url=new URL(origin);
 if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw Error('invalid auth service origin');
 const call=async(method:string,input:unknown):Promise<unknown>=>{
  let body:{result?:unknown;refused?:{code:string;status:number;retry_after?:number;detail?:string}}|null;
  try{
   const request=new Request(new URL(IDENTITY_CALL_PATH,url),{method:'POST',redirect:'error',headers:{'content-type':'application/json',[SERVICE_AUTH_HEADER]:options.serviceSecret},
    body:JSON.stringify({method,input:input??{}}),signal:AbortSignal.timeout(options.deadlineMs??10_000)});
   const response=await (options.fetch??fetch)(request);
   if(!response.ok){await response.body?.cancel();throw Error(`status ${response.status}`);}
   body=await response.json() as typeof body;
  }catch(error){throw Object.assign(new Error('identity_unavailable'),{cause:error});}
  if(body?.refused)throw new IdentityError(body.refused.code,body.refused.status,body.refused.retry_after,body.refused.detail);
  if(!body||!('result' in body))throw new Error('identity_unavailable');
  return body.result;
 };
 return Object.fromEntries(IDENTITY_METHODS.map(method=>[method,(input:unknown)=>call(method,input)])) as unknown as IdentityService;
}
