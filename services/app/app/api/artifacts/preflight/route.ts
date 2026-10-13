import {withTokenAuth} from '@/lib/accounts';
import {readJson,json} from '@/lib/http';
import {preflightPublication} from '@/lib/publish/publish';
export const POST=withTokenAuth(async(request,{ actor })=>{
 const body=await readJson(request);
 return body?preflightPublication(request,actor,body):json({error:'invalid_json'},400);
},{readOnly:true});
