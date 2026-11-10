import {runOperation} from '../operations';
/** HTTP identity adapter; group persistence never imports authentication modules. */
import { browserActor, withTokenAuth } from '@/lib/authentication';
import { type RequestIdentity } from '@/lib/accounts';
import {json,readJson,PayloadTooLarge,SMALL_BODY_LIMIT} from '../http';
import {SERVICE_AUTH_HEADER} from '@artifactbin/contracts';
import {serviceSecretMatches} from '@artifactbin/utils';
import {INTERNAL_SERVICE_SECRET} from '../platform';
import {GroupError} from '../groups';
export function groupRoute(handler:(request:Request,userId:string,params:Record<string,string>,actor:RequestIdentity)=>Promise<Response>,readOnly=false){
 const run=async(request:Request,actor:RequestIdentity,params:Record<string,string>)=>{
  const userId=actor.userId;
  if(!userId)return json({error:'account_required'},403);
  try{return await handler(request,userId,params,actor);}catch(error){if(error instanceof GroupError)return json({error:error.code},error.status);throw error;}
 };
 const bearer=withTokenAuth((request,{actor,params})=>actor.credential==='bearer'?run(request,actor,params):Promise.resolve(json({error:'auth_required'},401)),{readOnly});
 return async(request:Request,context?:{params:Promise<Record<string,string>>}):Promise<Response>=>{
  // Explicit bearer always wins and cannot fall back to browser authority.
  if(request.headers.has('authorization'))return bearer(request,context);
  const actor=await browserActor(request);if(actor instanceof Response)return actor;
  return run(request,actor,context?await context.params:{});
 };
}

/** HTTP input collection only; group protocol lives in the operation registry. */
export function groupOperation(name:string,readOnly=false){return groupRoute(async(request,_user,params,actor)=>{
 const input:Record<string,unknown>={...Object.fromEntries(new URL(request.url).searchParams)};
 if(!['GET','HEAD'].includes(request.method)){const body=await readJson(request,{allowEmpty:true});if(!body)return json({error:'invalid_json'},400);Object.assign(input,body);}
 return runOperation(name,request,actor,{...input,...params});
},readOnly);}

/**
 * An IDENTITY endpoint (contracts `IDENTITY_PATHS`): refused without the service secret, exactly as the auth
 * host's session-live; then one JSON object in, `answer`'s JSON out (null: the input is malformed). Never cached.
 */
export function identityServiceRoute(answer:(body:Record<string,unknown>)=>Promise<unknown>){
 return async(request:Request):Promise<Response>=>{
  const noStore={'Cache-Control':'no-store'};
  if(!serviceSecretMatches(request.headers.get(SERVICE_AUTH_HEADER),INTERNAL_SERVICE_SECRET))return json({error:'unauthorized'},401,noStore);
  let body:Record<string,unknown>|null;
  try{body=await readJson(request,{limit:SMALL_BODY_LIMIT});}catch(error){if(error instanceof PayloadTooLarge)return json({error:'too_large'},413,noStore);throw error;}
  const result=body&&await answer(body);
  return result?json(result,200,noStore):json({error:'invalid_request'},400,noStore);
 };
}
