import { withTokenAuth } from '@/lib/auth';
import { runOperation } from '@/lib/operations/http';
import { json, readJson } from '@/lib/http';
export const GET=withTokenAuth(async(request,{tokenId,userId,params})=>{
 const query=new URL(request.url).searchParams.get('query');
 return runOperation('get_artifact_members',request,{tokenId,userId},{id:params.id,...(query===null?{}:{query})});
});
export const POST=withTokenAuth(async(request,{tokenId,userId,params})=>{
 const body=await readJson(request);
 return body?runOperation('change_artifact_membership',request,{tokenId,userId},{...body,id:params.id}):json({error:'invalid_json'},400);
});
