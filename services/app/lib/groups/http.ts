/** Authenticated HTTP adapter; persistence does not depend on route or authentication modules. */
import {withTokenAuth} from '../accounts';
import {json} from '../http';
import {GroupError} from './index';
export function groupRoute(handler:(request:Request,userId:string,params:Record<string,string>)=>Promise<Response>,readOnly=false){return withTokenAuth(async(request,{userId,credential,params})=>{
 if(request.headers.has('authorization')&&credential!=='bearer')return json({error:'auth_required'},401);
 if(!userId)return json({error:'account_required'},403);
 try{return await handler(request,userId,params);}catch(error){if(error instanceof GroupError)return json({error:error.code},error.status);throw error;}
 },{readOnly});}
