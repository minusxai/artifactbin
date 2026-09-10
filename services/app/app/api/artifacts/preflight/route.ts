import {withTokenAuth} from '@/lib/auth';
import {readJson,json} from '@/lib/http';
import {preflightPublication} from '@/lib/publication-preflight';
export const POST=withTokenAuth(async(request,{tokenId,userId})=>{
 const body=await readJson(request);
 return body?preflightPublication(request,{tokenId,userId},body):json({error:'invalid_json'},400);
},{readOnly:true});
