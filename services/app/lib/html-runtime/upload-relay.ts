import {fileUploadResult} from './upload';
import type {FileUploadRequest,FileUploadTransport} from './upload-contract';
import type {FrameBridgeParentPayload,FrameBridgeFramePayload} from '../story-runtime/contract';
/** Bounded in-flight ownership. Cancellation suppresses a result; it does not claim to undo a committed upload. */
export function createUploadRelay(post:(payload:FrameBridgeFramePayload)=>void,nextCall:()=>number){
 const pending=new Map<number,{finish(error:Error|null,value?:unknown):void}>();
 const send:FileUploadTransport['send']=(request:FileUploadRequest,signal)=>new Promise((resolve,reject)=>{
  if(signal?.aborted){reject(signal.reason);return;}if(pending.size>=4){reject(Error('Too many pending uploads'));return;}
  const call=nextCall();const abort=()=>finish(Error('Upload canceled; retry the same File to recover its outcome'));
  const timer=setTimeout(()=>finish(Error('Upload timed out; retry the same File to recover its outcome')),30_000);
  const finish=(error:Error|null,value?:unknown)=>{if(!pending.delete(call))return;clearTimeout(timer);signal?.removeEventListener('abort',abort);if(error)reject(error);else try{resolve(fileUploadResult(value));}catch(cause){reject(cause);}};
  pending.set(call,{finish});signal?.addEventListener('abort',abort,{once:true});
  try{post({kind:'upload-file',call,...request});}catch{finish(Error('Upload relay unavailable'));}
 });
 return {send,receive(payload:FrameBridgeParentPayload){if(payload.kind!=='fetch-result')return false;const current=pending.get(payload.call);if(!current)return false;
  if('error' in payload)current.finish(Error('Upload outcome unknown; retry the same File'));
  else {let result:any;try{result=JSON.parse(payload.body);}catch{}current.finish(payload.status>=200&&payload.status<300?null:Error(result?.detail??result?.error??`Upload failed (${payload.status})`),result);}return true;
 },dispose(){for(const current of [...pending.values()])current.finish(Error('Page connection closed; upload outcome unknown'));}};
}
