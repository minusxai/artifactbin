import {withTokenAuth} from '@/lib/auth';
import {json,readJson} from '@/lib/http';
import {runOperation} from '@/lib/operations/http';

/** Native read-query contract; SQL and declared queries share domain authorization. */
export const POST=withTokenAuth(async(request,{tokenId,userId,params})=>{
 const body=await readJson(request);if(!body)return json({error:'invalid_json'},400);
 return runOperation('query_resource',request,{tokenId,userId},{...body,id:params.id});
});
