import {withTokenAuth} from '@/lib/auth';
import {json,readJson} from '@/lib/http';
import {accountProfile,updateAccountProfile} from '@/lib/account-profile';
import {durableMutation} from '@/lib/mutation-receipt';

export const GET=withTokenAuth(async(request,{userId,credential})=>{
 if(request.headers.has('authorization')&&credential!=='bearer')return json({error:'auth_required'},401);
 if(!userId)return json({error:'account_required',hint:'Sign in with an account using `afbin auth`.'},403);
 const profile=await accountProfile(userId);return profile?json(profile):json({error:'not_found'},404);
});
export const PATCH=withTokenAuth(async(request,{tokenId,userId,credential})=>{
 if(request.headers.has('authorization')&&credential!=='bearer')return json({error:'auth_required'},401);
 if(!userId)return json({error:'account_required'},403);
 const body=await readJson(request);if(!body)return json({error:'invalid_json'},400);
 const actor={tokenId,userId},key=request.headers.get('Idempotency-Key');
 const result=key?await durableMutation(actor,request.url,key,{operation:'profile',body},receipt=>updateAccountProfile(actor,body,receipt)):await updateAccountProfile(actor,body);
 const terminal=key&&!['operation_pending','outcome_unknown','idempotency_mismatch','invalid_idempotency_key'].includes(String(result.body.error));
 return json(result.body,result.status,terminal?{'X-Artifactbin-Mutation-Receipt':key}:{});
});
