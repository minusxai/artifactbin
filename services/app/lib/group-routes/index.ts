/** HTTP identity adapter; group persistence never imports authentication modules. */
import {browserActor,withTokenAuth} from '../accounts';
import {json} from '../http';
import {GroupError} from '../groups';
export function groupRoute(handler:(request:Request,userId:string,params:Record<string,string>)=>Promise<Response>,readOnly=false){
 const run=async(request:Request,userId:string|null|undefined,params:Record<string,string>)=>{
  if(!userId)return json({error:'account_required'},403);
  try{return await handler(request,userId,params);}catch(error){if(error instanceof GroupError)return json({error:error.code},error.status);throw error;}
 };
 const bearer=withTokenAuth((request,{userId,credential,params})=>credential==='bearer'?run(request,userId,params):Promise.resolve(json({error:'auth_required'},401)),{readOnly});
 return async(request:Request,context?:{params:Promise<Record<string,string>>}):Promise<Response>=>{
  // Explicit bearer always wins and cannot fall back to browser authority.
  if(request.headers.has('authorization'))return bearer(request,context);
  const actor=await browserActor(request);if(actor instanceof Response)return actor;
  return run(request,actor.viewer?.userId,context?await context.params:{});
 };
}
