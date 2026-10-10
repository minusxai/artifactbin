import { groupRoute } from '@/lib/group-routes';
import { json, readJson } from '@/lib/http';
import { DeploymentError, setupDeployment } from '@/lib/deployment';
export const POST=groupRoute(async(request,userId)=>{
 const body=await readJson(request);
 if(typeof body?.group_id!=='string'||!body.group_id)return json({error:'group_id_required'},400);
 try{return json(await setupDeployment(userId,body.group_id),200,{'Cache-Control':'no-store'});}
 catch(error){if(error instanceof DeploymentError)return json({error:error.code,message:error.message},error.status);throw error;}
});
