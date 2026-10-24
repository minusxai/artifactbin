import {DEFAULT_UPLOAD_MAX_BYTES,type DatasetUploadResult} from '@artifactbin/contracts';
import {runtimeId} from '@artifactbin/utils/runtime-id';
import type {FileUploader,FileUploadTransport} from './upload-contract';
export function createFileUploader(options:FileUploadTransport&{readOnly():boolean;datasetId(name:string):string|undefined}):FileUploader {
 const keys=new WeakMap<File,Map<string,string>>();
 return {async upload(file,context){
  if(options.readOnly())throw Error('Uploads are read-only in portable documents');
  context.signal?.throwIfAborted();
  const datasetId=options.datasetId(context.dataset);if(!datasetId)throw Error('Upload requires a linked dataset namespace');
  if(!file.name||file.name.length>255||/[\x00-\x1f\x7f/\\]/.test(file.name))throw Error('Invalid upload filename');
  if(!file.size||file.size>DEFAULT_UPLOAD_MAX_BYTES)throw Error('Upload is empty or exceeds the 50 MB limit');
  let scoped=keys.get(file);if(!scoped)keys.set(file,scoped=new Map());
  const requestId=context.requestId??scoped.get(datasetId)??runtimeId();if(!/^[\w.-]{8,120}$/.test(requestId))throw Error('Invalid upload requestId');scoped.set(datasetId,requestId);
  const bytes=new Uint8Array(await file.arrayBuffer());context.signal?.throwIfAborted();
  return options.send({datasetId,filename:file.name,contentType:file.type||'application/octet-stream',requestId,bytes},context.signal);
 }};
}
/** Validate the real product receipt before it can become authored state. */
export function fileUploadResult(value:unknown):DatasetUploadResult {
 const result=value as DatasetUploadResult|null;
 if(!result||!/^dfile:[a-z0-9]+$/.test(result.ref)||typeof result.name!=='string'||!result.name||typeof result.url!=='string'||!result.url||typeof result.contentType!=='string'||!Number.isSafeInteger(result.size)||result.size<0)throw Error('Upload response incomplete; retry the same File to recover');
 return result;
}
