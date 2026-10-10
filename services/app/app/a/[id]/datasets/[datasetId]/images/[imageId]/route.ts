import { sessionActor } from '@/lib/accounts';
import { readDatasetImage } from '@/lib/artifacts';
import { ID_RE } from '@/lib/platform';
import { json } from '@/lib/http';

const headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox",'Vary':'Origin'};
export async function GET(request:Request,ctx:{params:Promise<{id:string;datasetId:string;imageId:string}>}) {
  const {id,datasetId,imageId}=await ctx.params;
  if(!ID_RE.test(id)||!ID_RE.test(datasetId))return json({error:'not_found'},404,headers);
  const actor=await sessionActor(request);
  const image=await readDatasetImage({actor:{...actor.viewer,userId:actor.viewer?.userId??null,tokenId:actor.tokenId??null},documentId:id,datasetId,imageId});
  if(!image)return json({error:'not_found'},404,headers);
  return new Response(new Uint8Array(image.body),{status:200,headers:{...headers,'Content-Type':image.contentType,'Content-Disposition':'inline'}});
}
