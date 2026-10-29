import { withTokenAuth } from '@/lib/authentication';
import { runOperation } from '@/lib/operations/http';
import { json, readJson } from '@/lib/http';
export const GET=withTokenAuth(async(request,{ actor,params })=>{
 const query=new URL(request.url).searchParams.get('query');
 return runOperation('get_artifact_members',request,actor,{id:params.id,...(query===null?{}:{query})});
});
export const POST=withTokenAuth(async(request,{ actor,params })=>{
 const body=await readJson(request);
 return body?runOperation('change_artifact_membership',request,actor,{...body,id:params.id}):json({error:'invalid_json'},400);
});
