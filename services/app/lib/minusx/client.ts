/**
 * THE MINUSX CONTROL CLIENT (contract §4.2), as Artifactbin's server calls it: every request carries a delegation
 * minted for exactly that request (./delegation) and nothing else that identifies anyone. A refusal becomes a
 * `MinusxRefusal` carrying MinusX's error code and HTTP status only; a network failure, a timeout or an answer of
 * the wrong shape (a connection session without a `tls` of `verify-full` or `disable` included) is `unavailable`. No error, log line or URL ever carries the token.
 */
import {MINUSX_API_PREFIX,type DelegationPurpose,type MinusxErrorBody,type MinusxCatalog,type MinusxConnectionSession,type MinusxConnections,type MinusxContext} from '@artifactbin/contracts';
import type {MinusxSettings} from '@/lib/platform';
import {mintDelegation,type DelegationSubject} from './delegation';

/** A MinusX answer other than success: its error code (or `unavailable`) and status (0 when nothing answered). */
export class MinusxRefusal extends Error {
 constructor(readonly code:string,readonly status:number){super(code);this.name='MinusxRefusal';}
}
const DEADLINE_MS=10_000;
const CODE=/^[a-z][a-z0-9_]{0,63}$/;
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);

export interface MinusxClient {
 connections(subject:DelegationSubject):Promise<MinusxConnections>;
 catalog(subject:DelegationSubject,connectionId:string):Promise<MinusxCatalog>;
 context(subject:DelegationSubject,connectionId:string):Promise<MinusxContext>;
 connectionSession(subject:DelegationSubject,connectionId:string,signal?:AbortSignal):Promise<MinusxConnectionSession>;
}

export function createMinusxClient(settings:MinusxSettings,fetcher:(request:Request)=>Promise<Response>=fetch):MinusxClient{
 async function call(subject:DelegationSubject,purpose:DelegationPurpose,method:'GET'|'POST',path:string,body:unknown,signal?:AbortSignal):Promise<unknown>{
  // The body is serialized once: the digest the token carries is of these exact bytes, and these bytes are sent.
  const bytes=body===undefined?'':JSON.stringify(body);
  const token=await mintDelegation(settings,subject,purpose,bytes);
  const deadline=AbortSignal.timeout(DEADLINE_MS);
  let response:Response;
  try{
   response=await fetcher(new Request(settings.baseUrl+MINUSX_API_PREFIX+path,{method,redirect:'error',headers:{authorization:`Bearer ${token}`,accept:'application/json',...(bytes?{'content-type':'application/json'}:{})},...(bytes?{body:bytes}:{}),signal:signal?AbortSignal.any([signal,deadline]):deadline}));
  }catch{throw new MinusxRefusal('unavailable',0);}
  const answer=await response.json().catch(()=>undefined) as unknown;
  if(!response.ok){
   const said=object(answer)&&object(answer.error)?(answer as unknown as MinusxErrorBody).error.code:undefined;
   const code=typeof said==='string'&&CODE.test(said)?said:response.status>=500?'unavailable':'refused';
   throw new MinusxRefusal(code,response.status);
  }
  if(!object(answer))throw new MinusxRefusal('unavailable',response.status);
  return answer;
 }
 const query=(connectionId:string)=>`?connection_id=${encodeURIComponent(connectionId)}`;
 return {
  async connections(subject){
   const answer=await call(subject,'catalog.read','GET','/connections',undefined) as Record<string,unknown>;
   if(!Array.isArray(answer.connections)||answer.connections.some(c=>!object(c)||typeof c.id!=='string'))throw new MinusxRefusal('unavailable',200);
   return answer as unknown as MinusxConnections;
  },
  async catalog(subject,connectionId){
   const answer=await call(subject,'catalog.read','GET','/catalog'+query(connectionId),undefined) as Record<string,unknown>;
   if(!Array.isArray(answer.schemas))throw new MinusxRefusal('unavailable',200);
   return answer as unknown as MinusxCatalog;
  },
  async context(subject,connectionId){
   const answer=await call(subject,'context.read','GET','/context'+query(connectionId),undefined) as Record<string,unknown>;
   if(!Array.isArray(answer.docs))throw new MinusxRefusal('unavailable',200);
   return answer as unknown as MinusxContext;
  },
  async connectionSession(subject,connectionId,signal){
   const answer=await call(subject,'database.connect','POST','/connection-sessions',{connection_id:connectionId},signal) as Record<string,unknown>;
   if(typeof answer.host!=='string'||typeof answer.port!=='number'||typeof answer.user!=='string'||typeof answer.password!=='string'||typeof answer.database!=='string'||typeof answer.protocol!=='string'||(answer.tls!=='verify-full'&&answer.tls!=='disable'))throw new MinusxRefusal('unavailable',200);
   return answer as unknown as MinusxConnectionSession;
  },
 };
}
