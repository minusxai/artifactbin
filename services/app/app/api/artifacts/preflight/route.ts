import { withTokenAuth } from '@/lib/authentication';
import {PUBLISH_BODY_LIMIT,readJson,json} from '@/lib/http';
import {preflightPublication} from '@/lib/publish';
export const POST=withTokenAuth(async(request,{ actor })=>{
 const body=await readJson(request,{limit:PUBLISH_BODY_LIMIT});
 return body?preflightPublication(request,actor,body):json({error:'invalid_json'},400);
},{readOnly:true});
