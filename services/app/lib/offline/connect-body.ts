/** The browser JSON transport has its own bound; HTML is bounded again after decoding. Unknown/chunked lengths follow the same streaming cap. */
import {PREVIEW_CONNECT_MAX_BYTES} from '@artifactbin/contracts';
import {json} from '../http';
export async function readConnectBody(request:Request):Promise<Record<string,unknown>|Response>{
 const maximum=2*PREVIEW_CONNECT_MAX_BYTES;
 if(Number(request.headers.get('content-length'))>maximum)return json({error:'The connection body exceeds the 50 MB transport limit.'},413);
 if(!request.body)return json({error:'invalid_json'},400);
 const reader=request.body.getReader(),chunks:Uint8Array[]=[];let length=0;
 try{
  while(true){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>maximum){await reader.cancel();return json({error:'The connection body exceeds the 50 MB transport limit.'},413);}chunks.push(value);}
  const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  return value&&typeof value==='object'&&!Array.isArray(value)?value:json({error:'invalid_json'},400);
 }catch{return json({error:'invalid_json'},400);}finally{reader.releaseLock();}
}
