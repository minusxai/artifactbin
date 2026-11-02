import {runOperation} from '../operations';
/** HTTP identity adapter; group persistence never imports authentication modules. */
import { browserActor, withTokenAuth } from '@/lib/authentication';
import { type RequestIdentity } from '@/lib/accounts';
import {json,readJson} from '../http';
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
