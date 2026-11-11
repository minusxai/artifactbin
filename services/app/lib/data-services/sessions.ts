/**
 * A DATA SERVICE'S SESSION ENDPOINT (contracts ./viewer-connections), as this server calls it: one POST with a viewer
 * token as the bearer and the binding's params as the JSON body; a 2xx answer of exactly the session shape is the
 * connection. Anything else is a `SessionRefusal` carrying only the HTTP status (0 when nothing answered); the body of
 * a refusal is never read into an error, a log line or a URL, and neither is the token.
 */
import type {DataService,ViewerSession} from '@artifactbin/contracts';

export class SessionRefusal extends Error {
 constructor(readonly status:number){super(`session_refused_${status}`);this.name='SessionRefusal';}
}
const DEADLINE_MS=10_000;
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const session=(v:Record<string,unknown>):v is Record<string,unknown>&ViewerSession=>
 (v.protocol==='postgres'||v.protocol==='mysql')&&typeof v.host==='string'&&!!v.host&&Number.isInteger(v.port)&&(v.port as number)>0&&(v.port as number)<65536
 &&typeof v.user==='string'&&typeof v.password==='string'&&typeof v.database==='string'&&(v.tls==='verify-full'||v.tls==='disable')&&typeof v.expires_at==='string';

export async function requestSession(service:DataService,token:string,params:Record<string,unknown>,options:{signal?:AbortSignal;fetcher?:(request:Request)=>Promise<Response>}={}):Promise<ViewerSession>{
 const deadline=AbortSignal.timeout(DEADLINE_MS);
 let response:Response;
 try{
  response=await (options.fetcher??fetch)(new Request(service.sessionUrl,{method:'POST',redirect:'error',
   headers:{authorization:`Bearer ${token}`,accept:'application/json','content-type':'application/json'},body:JSON.stringify(params),
   signal:options.signal?AbortSignal.any([options.signal,deadline]):deadline}));
 }catch{throw new SessionRefusal(0);}
 if(!response.ok){await response.body?.cancel().catch(()=>{});throw new SessionRefusal(response.status);}
 const answer=await response.json().catch(()=>undefined) as unknown;
 if(!object(answer)||!session(answer))throw new SessionRefusal(502);
 return {protocol:answer.protocol,host:answer.host,port:answer.port,user:answer.user,password:answer.password,database:answer.database,tls:answer.tls,expires_at:answer.expires_at};
}
