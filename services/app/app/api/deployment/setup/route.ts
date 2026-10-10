import { withTokenAuth } from '@/lib/accounts';
import { json, readJson } from '@/lib/http';
import { DeploymentError, setupDeployment } from '@/lib/deployment';
export const POST=withTokenAuth(async(request,{userId,credential})=>{
 if(request.headers.has('authorization')&&credential!=='bearer')return json({error:'auth_required'},401);
 if(!userId)return json({error:'account_required'},403);
 const body=await readJson(request);
 if(typeof body?.group_id!=='string'||!body.group_id)return json({error:'group_id_required'},400);
 try{return json(await setupDeployment(userId,body.group_id),200,{'Cache-Control':'no-store'});}
 catch(error){if(error instanceof DeploymentError)return json({error:error.code,message:error.message},error.status);throw error;}
});
