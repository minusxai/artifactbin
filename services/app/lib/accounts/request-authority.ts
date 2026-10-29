import {hostedCredentialDescriptor} from './tokens';
import type {RunnerJson} from '@artifactbin/contracts';
/** What a request's credential allows; resolved from token identity, never from caller headers. */
export type HostedOperationAuthorization =
 | {kind:'ordinary'}
 | {kind:'allowed';requestScope?:string}
 | {kind:'denied';code:string;message:string}
 | {kind:'deferred';body:RunnerJson};
/** Default grants are resolved by their trusted owner from token identity. Headers
 * and transcript contents cannot promote a credential into request authority. */
export async function hostedAuthorization(owner:string|null|undefined,tokenId:string|null|undefined,_name:string,_input:unknown):Promise<HostedOperationAuthorization>{
 if(!owner||!tokenId)return {kind:'ordinary'};
 const credential=await hostedCredentialDescriptor(owner,tokenId);
 if(!credential)return {kind:'denied',code:'agent_credential_invalid',message:'The request credential is no longer available.'};
 if(!credential.scoped)return {kind:'ordinary'};
 return {kind:'denied',code:'agent_authority_unavailable',message:'Request authority is unavailable.'};
}

export function hostedRefusal(decision:HostedOperationAuthorization):Response|null{
 if(decision.kind==='denied')return Response.json({error:decision.code,message:decision.message,admission_refused:true},{status:403});
 if(decision.kind==='deferred')return Response.json(decision.body,{status:202});
 return null;
}
export async function hostedRequestRefusal(owner:string|null|undefined,tokenId:string|null|undefined,request:Request,browser=false):Promise<Response|null>{
 return hostedRefusal(await hostedAuthorization(owner,tokenId,browser?'browser_request':'http_request',{method:request.method,path:new URL(request.url).pathname}));
}
export async function hostedOperationCompleted(_owner:string|null|undefined,_tokenId:string|null|undefined,_name:string,_input:unknown,_response:Response):Promise<void>{}
