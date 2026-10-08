/** HTTP translation for browser and bearer dataset uploads; policy lives in the service. */
import { requestOrSessionActor, refusesCrossSite } from '@/lib/accounts';
import { DatasetError } from './errors';
import { uploadDatasetFile, readDatasetFile } from './feedback-images';
import { readFileUpload } from '@/lib/story/assets/file-store';
import { json } from '@/lib/http';

const headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox",'Referrer-Policy':'no-referrer','Vary':'Origin'};
export async function uploadFileRequest(request:Request, documentId:string, datasetId:string):Promise<Response> {
  const actor=await requestOrSessionActor(request);
  if(refusesCrossSite(request,actor))return json({error:'forbidden'},403,headers);
  if(!actor.viewer?.userId&&!actor.tokenId)return json({error:'dataset_file_upload_failed',detail:'Sign in to upload a file'},403,headers);
  let filename:string;
  try { filename=decodeURIComponent(request.headers.get('X-Filename')??''); } catch { return json({error:'invalid_filename'},400,headers); }
  const bytes=await readFileUpload(request);
  if(bytes instanceof Response)return bytes;
  try {
    return json(await uploadDatasetFile({actor:{...actor.viewer,userId:actor.viewer?.userId??null,tokenId:actor.tokenId??null},documentId,datasetId,editId:request.headers.get('X-Edit-Id')??'',bytes,contentType:(request.headers.get('content-type')??'application/octet-stream').split(';')[0]!.trim().toLowerCase(),filename,operationKey:request.headers.get('Idempotency-Key')??''}),201,headers);
  } catch(error) {
    if(error instanceof DatasetError)return json({error:'dataset_file_upload_failed',detail:error.message},error.status,headers);
    throw error;
  }
}
export async function readFileRequest(request:Request,documentId:string,datasetId:string,fileId:string):Promise<Response> {
  const actor=await requestOrSessionActor(request);
  const file=await readDatasetFile({actor:{...actor.viewer,userId:actor.viewer?.userId??null,tokenId:actor.tokenId??null},documentId,datasetId,fileId});
  if(!file)return json({error:'not_found'},404,headers);
  const ascii=file.filename.replace(/[^a-zA-Z0-9._ -]/g,'_');
  const encoded=encodeURIComponent(file.filename).replace(/['()*]/g,c=>`%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return new Response(new Uint8Array(file.body),{headers:{...headers,'Content-Type':file.contentType,'Content-Disposition':`${file.image?'inline':'attachment'}; filename="${ascii}"; filename*=UTF-8''${encoded}`}});
}
