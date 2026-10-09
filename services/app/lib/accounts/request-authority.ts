import {hostedCredentialDescriptor} from './tokens';
import type {RunnerJson,HostedOperationAuthorization} from '@artifactbin/contracts';
import type {HostedRemoteAgent} from '@artifactbin/contracts';
let hosted:HostedRemoteAgent|undefined;
export function setHostedRequestAuthority(agent:HostedRemoteAgent|undefined){hosted=agent;}
const hostedRemoteAgent=()=>hosted;
/** Default grants are resolved by their trusted owner from token identity. Headers
 * and transcript contents cannot promote a credential into request authority. */
export async function hostedAuthorization(owner:string|null|undefined,tokenId:string|null|undefined,name:string,input:unknown):Promise<HostedOperationAuthorization>{
 const agent=hostedRemoteAgent();
 if(!owner||!tokenId)return {kind:'ordinary'};
 const credential=await hostedCredentialDescriptor(owner,tokenId);
 if(!credential)return {kind:'denied',code:'agent_credential_invalid',message:'The request credential is no longer available.'};
 if(!credential.scoped)return {kind:'ordinary'};
 if(!agent?.authorizeOperation)return credential.scoped?{kind:'denied',code:'agent_authority_unavailable',message:'Request authority is unavailable.'}:{kind:'ordinary'};
 let decision:HostedOperationAuthorization;
 try{decision=await agent.authorizeOperation(owner,tokenId,name,input as RunnerJson,credential);}catch{return {kind:'denied',code:'agent_authority_unavailable',message:'Request authority is unavailable.'};}
 if(!decision||!['allowed','denied','deferred'].includes(decision.kind)||(decision.kind==='denied'&&(typeof decision.code!=='string'||typeof decision.message!=='string'))||(decision.kind==='deferred'&&!('body' in decision)))return {kind:'denied',code:'agent_authority_invalid',message:'Request authority is unavailable.'};
 return decision;
}
export function hostedRefusal(decision:HostedOperationAuthorization):Response|null{
 if(decision.kind==='denied')return Response.json({error:decision.code,message:decision.message,admission_refused:true},{status:403});
 if(decision.kind==='deferred')return Response.json(decision.body,{status:202});
 return null;
}
export async function hostedRequestRefusal(owner:string|null|undefined,tokenId:string|null|undefined,request:Request,browser=false):Promise<Response|null>{
 return hostedRefusal(await hostedAuthorization(owner,tokenId,browser?'browser_request':'http_request',{method:request.method,path:new URL(request.url).pathname}));
}
export async function hostedOperationCompleted(owner:string|null|undefined,tokenId:string|null|undefined,name:string,input:unknown,response:Response):Promise<void>{
 if(!owner||!tokenId||!response.ok||!response.headers.get('content-type')?.includes('application/json'))return;
 const agent=hostedRemoteAgent();const credential=await hostedCredentialDescriptor(owner,tokenId);
 if(agent?.operationCompleted&&credential)await agent.operationCompleted(owner,tokenId,name,input as RunnerJson,await response.clone().json() as RunnerJson,credential);
}
