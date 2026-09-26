import {withTokenAuth} from '@/lib/auth';
import {readJson,json} from '@/lib/http';
import {prepareDocumentAuthoringContext} from '@/lib/story/document-authoring-context';
export const POST=withTokenAuth(async(request,{tokenId,userId,params})=>{
 const body=await readJson(request);
 return body?prepareDocumentAuthoringContext({tokenId,userId},params.id!,body):json({error:'invalid_json'},400);
});
