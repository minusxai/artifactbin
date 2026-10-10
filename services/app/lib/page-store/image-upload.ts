import { runtimeId } from '@artifactbin/utils/runtime-id';
import type { ImageUploadContext } from './store';

const keys=new WeakMap<ImageUploadContext,WeakMap<File,Map<string,string>>>();

export async function uploadDatasetImage(context:ImageUploadContext|undefined,datasetId:string,editId:string,file:File):Promise<{ref:string;url:string}> {
  if(!context)throw new Error('page.uploadImage requires a signed-in reader');
  let files=keys.get(context);
  if(!files)keys.set(context,files=new WeakMap());
  let scoped=files.get(file);
  if(!scoped)files.set(file,scoped=new Map());
  const scope=`${datasetId}:${editId}`,key=scoped.get(scope)??runtimeId(); scoped.set(scope,key);
  const url=context[0].replace('/query',`/datasets/${datasetId}/images`);
  const response=await context[1](url,{method:'POST',credentials:context[2],headers:{'Content-Type':file.type,'X-Edit-Id':editId,'Idempotency-Key':key},body:file});
  const body=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(body.detail??body.error??`image upload failed (${response.status})`);
  return body as {ref:string;url:string};
}
