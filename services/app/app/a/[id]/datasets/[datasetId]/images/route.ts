import { sessionActor, refusesCrossSite } from '@/lib/accounts';
import { DatasetError } from '@/lib/datasets/errors';
import { uploadDatasetImage } from '@/lib/artifacts/feedback-images';
import { MAX_IMAGE_BYTES } from '@/lib/platform/config';
import { ID_RE } from '@/lib/platform';
import { json } from '@/lib/http';
import { canReadArtifact, getArtifactById } from '@/lib/artifacts';

const headers={'Cache-Control':'no-store','Vary':'Origin'};
export async function POST(request:Request,ctx:{params:Promise<{id:string;datasetId:string}>}) {
  const {id,datasetId}=await ctx.params;
  if(!ID_RE.test(id)||!ID_RE.test(datasetId))return json({error:'not_found'},404,headers);
  const actor=await sessionActor(request);
  if(refusesCrossSite(request,actor))return json({error:'forbidden'},403,headers);
  const doc=await getArtifactById(id);
  if(!doc||!(await canReadArtifact(doc,actor.viewer)))return json({error:'not_found'},404,headers);
  const advertised=Number(request.headers.get('content-length'));
  if(advertised>MAX_IMAGE_BYTES)return json({error:'image_too_large',maxBytes:MAX_IMAGE_BYTES},413,headers);
  const editId=request.headers.get('X-Edit-Id')??'',contentType=(request.headers.get('content-type')??'').split(';')[0]!.trim().toLowerCase();
  if(!editId)return json({error:'invalid_image_upload'},400,headers);
  const reader=request.body?.getReader();if(!reader)return json({error:'invalid_image_upload'},400,headers);
  const chunks:Uint8Array[]=[];let total=0;
  try {for(;;){const {value,done}=await reader.read();if(done)break;total+=value.byteLength;if(total>MAX_IMAGE_BYTES){await reader.cancel();return json({error:'image_too_large',maxBytes:MAX_IMAGE_BYTES},413,headers);}chunks.push(value);}}finally{reader.releaseLock();}
  if(total===0)return json({error:'invalid_image_upload'},400,headers);
  try {
    const result=await uploadDatasetImage({actor:{...actor.viewer,userId:actor.viewer?.userId??null,tokenId:actor.tokenId??null},documentId:id,datasetId,editId,bytes:Buffer.concat(chunks,total),contentType,operationKey:request.headers.get('Idempotency-Key')??''});
    return json(result,201,headers);
  } catch(error) {
    if(error instanceof DatasetError)return json({error:'dataset_image_upload_failed',detail:error.message},error.status,headers);
    throw error;
  }
}
