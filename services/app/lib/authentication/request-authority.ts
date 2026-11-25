import {hostedCredentialDescriptor} from '@/lib/accounts';
import type {HtmlJson} from '@artifactbin/contracts/html-page';
/** What a request's credential allows; resolved from token identity, never from caller headers. */
export type HostedOperationAuthorization =
 | {kind:'ordinary'}
 | {kind:'allowed';requestScope?:string}
 | {kind:'denied';code:string;message:string}
 | {kind:'deferred';body:HtmlJson};
/** Default grants are resolved by their trusted owner from token identity. Headers
 * and transcript contents cannot promote a credential into request authority. */
export async function hostedAuthorization(owner:string|null|undefined,tokenId:string|null|undefined,_name:string,_input:unknown):Promise<HostedOperationAuthorization>{
 if(!owner||!tokenId)return {kind:'ordinary'};
 return credentialAuthorization(await hostedCredentialDescriptor(owner,tokenId));
}

function credentialAuthorization(credential:{scoped:boolean}|null):HostedOperationAuthorization{
 if(!credential)return {kind:'denied',code:'agent_credential_invalid',message:'The request credential is no longer available.'};
 if(!credential.scoped)return {kind:'ordinary'};
 return {kind:'denied',code:'agent_authority_unavailable',message:'Request authority is unavailable.'};
}

export function hostedRefusal(decision:HostedOperationAuthorization):Response|null{
 if(decision.kind==='denied')return Response.json({error:decision.code,message:decision.message,admission_refused:true},{status:403});
 if(decision.kind==='deferred')return Response.json(decision.body,{status:202});
 return null;
}
export async function hostedRequestAdmission(owner:string|null,tokenId:string|null,{revalidate}: {revalidate:boolean}):Promise<{refusal:Response|null;touchDue?:boolean}>{
 if(!owner||!tokenId)return {refusal:null};
 const credential=await hostedCredentialDescriptor(owner,tokenId,{revalidate});
 return {refusal:hostedRefusal(credentialAuthorization(credential)),touchDue:credential?.touchDue};
}
export async function hostedOperationCompleted(_owner:string|null|undefined,_tokenId:string|null|undefined,_name:string,_input:unknown,_response:Response):Promise<void>{}
