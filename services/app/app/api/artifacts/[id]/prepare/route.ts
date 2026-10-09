import {withTokenAuth} from '@/lib/accounts';
import {readJson,json} from '@/lib/http';
import {prepareDocumentAuthoringContext} from '@/lib/artifacts/write/document-authoring-context';
import {prepareDocumentSource} from '@/lib/artifacts/write/document-source-preparation';
export const POST=withTokenAuth(async(request,{tokenId,userId,params})=>{
 const body=await readJson(request);
 if(!body)return json({error:'invalid_json'},400);
 const prepare=Object.hasOwn(body,'edit_id')||Object.hasOwn(body,'expectedVersion')||Object.hasOwn(body,'metadata')?prepareDocumentSource:prepareDocumentAuthoringContext;
 return prepare({tokenId,userId},params.id!,body);
});
