import {withTokenAuth} from '@/lib/accounts';
import {readJson,json} from '@/lib/http';
import {preflightPublication} from '@/lib/publish/publish';
export const POST=withTokenAuth(async(request,{tokenId,userId})=>{
 const body=await readJson(request);
 return body?preflightPublication(request,{tokenId,userId},body):json({error:'invalid_json'},400);
},{readOnly:true});
