import { withTokenAuth } from '@/lib/authentication';
import {PUBLISH_BODY_LIMIT,readJson,json} from '@/lib/http';
import {preflightPublication} from '@/lib/publish';
import {authoredHtml} from '@/lib/operations';
export const POST=withTokenAuth(async(request,{ actor })=>{
 const body=await readJson(request,{limit:PUBLISH_BODY_LIMIT});
 if(!body)return json({error:'invalid_json'},400);
 // An export is checked as the source it carries, as create and replace store it (lib/operations authoredHtml).
 const input=body.input&&typeof body.input==='object'&&!Array.isArray(body.input)?authoredHtml(body.input as Record<string,unknown>):body.input;
 if(input instanceof Response)return input;
 return preflightPublication(request,actor,{...body,input});
},{readOnly:true});
