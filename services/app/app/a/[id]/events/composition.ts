/** HTTP composition, not a new authority: document reads and browser region sessions each
 * pass their existing door. Only explicitly requested editor channels are multiplexed.
 * Each producer emits complete SSE frames; two backpressured pumps hold at most one chunk
 * per channel. Losing either producer reconnects the union from its independent cursors.
 */
import { openDocumentEvents } from '@/lib/publish';
import { isRegionId } from '@/lib/live-regions';
import { REGION_STREAM_EVENT } from '@artifactbin/contracts';
import { json } from '@/lib/http';
import { browserEditor, notFound, regionSessions } from '@/app/api/artifacts/[id]/regions/doors';

function mergeFrames(streams:ReadableStream<Uint8Array>[],signal:AbortSignal):ReadableStream<Uint8Array> {
 const readers=streams.map(stream=>stream.getReader());
 const {readable,writable}=new TransformStream<Uint8Array,Uint8Array>();
 const writer=writable.getWriter();let closed=false;
 const close=()=>{
  if(closed)return;closed=true;signal.removeEventListener('abort',close);
  for(const reader of readers)void reader.cancel().catch(()=>{});
  void writer.close().catch(()=>{});
 };
 signal.addEventListener('abort',close,{once:true});
 void writer.closed.catch(close);
 for(const reader of readers)void (async()=>{try{while(!closed){const next=await reader.read();if(next.done)break;await writer.write(next.value);}}catch{/* reconnect both channels */}finally{close();}})();
 if(signal.aborted)close();
 return readable;
}
const busy=()=>new Response('too many live documents',{status:503,headers:{'Retry-After':'30'}});
export async function documentEventBody(request:Request,id:string):Promise<ReadableStream<Uint8Array>|Response> {
 const params=new URL(request.url).searchParams;
 const after=params.get('regions');
 let regions:ReadableStream<Uint8Array>|undefined;
 if(after!==null){
  // Anonymous reader mode never inherits the ambient account's editor capability.
  if(params.get('anonymous')==='1')return notFound();
  const actor=await browserEditor(request);if(actor instanceof Response)return actor;
  const entries=after.split(',');
  if(!after||entries.length>64||entries.some(pair=>!isRegionId(pair.slice(0,pair.lastIndexOf(':')))))return json({error:'invalid_cursor'},400);
  const opened=await regionSessions().stream(actor,id,after,request.signal,REGION_STREAM_EVENT);
  if(opened.status==='not_found')return notFound();
  if(opened.status==='invalid')return json({error:'invalid_cursor'},400);
  if(opened.status==='busy')return busy();
  regions=opened.stream;
 }
 try {
  const document=await openDocumentEvents(request,id);
  if(document.status!=='open'){
   await regions?.cancel();
   return document.status==='busy'?busy():new Response('not found',{status:404});
  }
  return regions?mergeFrames([document.stream,regions],request.signal):document.stream;
 } catch(error){await regions?.cancel();throw error;}
}
