/** Auth-owner transport. No session credentials or service secrets enter URLs. */
import {HUMAN_SESSION_LIVE_PATH,SERVICE_AUTH_HEADER,type HumanSessionAuthority} from '@artifactbin/contracts';
export function humanSessionClient(origin:string,options:{serviceSecret:string;deadlineMs?:number;fetch?:(request:Request)=>Promise<Response>}):HumanSessionAuthority {
 if(!options.serviceSecret.trim())throw Error('human session authority requires a service secret');
 const url=new URL(origin);
 if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw Error('invalid auth service origin');
 return {async live(sessionId,userId){
  try{
   const request=new Request(new URL(HUMAN_SESSION_LIVE_PATH,url),{method:'POST',redirect:'error',headers:{'content-type':'application/json',[SERVICE_AUTH_HEADER]:options.serviceSecret},body:JSON.stringify({sessionId,userId}),signal:AbortSignal.timeout(options.deadlineMs??3000)});
   const response=await (options.fetch??fetch)(request);
   if(!response.ok)return false;
   const result=await response.json() as {live?:unknown}|null;
   return result?.live===true;
  }catch{return false;}
 }};
}
