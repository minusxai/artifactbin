import type {FrameBridgeFramePayload,FrameBridgeParentPayload} from '../html-reader/contract';
import type {FunctionReply,FunctionRequest} from './fn-fetch';
/**
 * The reader's half of a page function call (./fn-fetch): one bridge `fetch` to this page's function path per call,
 * its raw answer back (status, kept headers, body text); the parent bounds the body (413). Abort posts `fetch-cancel` (the parent aborts the request)
 * and rejects with the signal's reason; a lost connection rejects with TypeError, as fetch does.
 */
export function createFunctionRelay(post:(payload:FrameBridgeFramePayload)=>void,nextCall:()=>number,pageId:string){
 const pending=new Map<number,{resolve(reply:FunctionReply):void;reject(error:unknown):void}>();
 return {
  call(request:FunctionRequest,signal:AbortSignal|null):Promise<FunctionReply>{
   return new Promise((resolve,reject)=>{
    if(signal?.aborted){reject(signal.reason);return;}
    const id=nextCall();
    const abort=()=>{if(!pending.delete(id))return;post({kind:'fetch-cancel',call:id});reject(signal!.reason);};
    const done=()=>signal?.removeEventListener('abort',abort);
    pending.set(id,{resolve:reply=>{done();resolve(reply);},reject:error=>{done();reject(error);}});
    signal?.addEventListener('abort',abort,{once:true});
    post({kind:'fetch',call:id,path:`/api/artifacts/${encodeURIComponent(pageId)}/fn/${request.name}${request.search}`,method:request.method,headers:request.contentType?{'content-type':request.contentType}:{},body:request.body});
   });
  },
  receive(payload:FrameBridgeParentPayload):boolean{
   if(payload.kind!=='fetch-result')return false;
   const current=pending.get(payload.call);if(!current)return false;
   pending.delete(payload.call);
   if('error' in payload)current.reject(new TypeError('Failed to fetch: outcome unknown'));
   else current.resolve({status:payload.status,headers:payload.headers,body:payload.body});
   return true;
  },
  dispose(){for(const current of [...pending.values()])current.reject(new TypeError('Failed to fetch: page connection closed'));pending.clear();},
 };
}
