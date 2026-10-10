/** A transport-independent, cancellable new-human-comment feed. No durable checkpoint is implied. */
import type {CommentChangeEvent,CommentChangesPage} from '@artifactbin/contracts';
export class WatchResponseError extends Error {
 constructor(readonly status:number){super(`Comment watch refused (HTTP ${status}).`);}
}
export interface CommentWatchOptions {
 artifactId:string;
 request:(path:string,options:{signal?:AbortSignal;timeoutMs:number})=>Promise<CommentChangesPage>;
 signal?:AbortSignal;
 cursor?:string;
 /** Called after the consumer has accepted every event in the page. Persist explicitly to resume. */
 onCheckpoint?:(cursor:string)=>void|Promise<void>;
 onRetry?:(attempt:number)=>void;
 /** Consecutive transient failures, reset by a successful page. */
 maxRetries?:number;
 retryDelayMs?:number;
}
function retryable(error:unknown):boolean{
 const value=error as {status?:number;details?:{http_status?:number};code?:string};
 if(value?.code==='refresh_unavailable')return true;
 const status=value?.status??value?.details?.http_status;
 if(status!==undefined)return status===429||(status>=500&&status<=599);
 return error instanceof TypeError||value?.code==='transport_error'||value?.code==='refresh_unavailable'||(error instanceof Error&&error.name==='TimeoutError');
}
async function pause(ms:number,signal?:AbortSignal):Promise<void>{
 signal?.throwIfAborted();
 await new Promise<void>((resolve,reject)=>{
  const finish=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);resolve();};
  const abort=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);reject(signal?.reason);};
  const timer=setTimeout(finish,ms);signal?.addEventListener('abort',abort,{once:true});
 });
}
/** Stable event IDs permit deduplication; crashes before a saved checkpoint can replay accepted output. */
export async function* watchComments(options:CommentWatchOptions):AsyncGenerator<CommentChangeEvent,void,void>{
 if(!/^[A-Za-z0-9]{6,12}$/.test(options.artifactId))throw new Error('Use a published artifact ID.');
 let cursor=options.cursor??'now',immediate=false,failures=0;
 while(!options.signal?.aborted){
  const query=new URLSearchParams({after:cursor,wait:immediate?'0':'60',limit:'100'});
  let page:CommentChangesPage;
  try{
   page=await options.request(`/api/artifacts/${options.artifactId}/annotations/changes?${query}`,{signal:options.signal,timeoutMs:70000});
   if(options.signal?.aborted)return;
   if(!page||!Array.isArray(page.events)||typeof page.next_cursor!=='string'||!page.next_cursor||typeof page.has_more!=='boolean')throw new Error('The comment feed returned an invalid page.');
   failures=0;
  }catch(error){
   if(options.signal?.aborted)return;
   if(!retryable(error)||failures>=(options.maxRetries??5))throw error;
   options.onRetry?.(++failures);
   try{await pause(Math.min(30000,(options.retryDelayMs??500)*2**(failures-1)),options.signal);}catch(error){if(options.signal?.aborted)return;throw error;}
   continue;
  }
  for(const event of page.events){if(options.signal?.aborted)return;yield event;}
  if(options.signal?.aborted)return;
  await options.onCheckpoint?.(page.next_cursor);
  cursor=page.next_cursor;immediate=page.has_more;
 }
}
