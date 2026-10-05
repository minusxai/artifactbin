import {it,expect} from 'vitest';
import {PREVIEW_CONNECT_MAX_BYTES} from '@artifactbin/contracts';
import {readConnectBody} from '../connect-body';
it('bounds declared and unknown/chunked lengths before allocating decoded JSON',async()=>{
 const declared=await readConnectBody(new Request('http://localhost/connect/import',{method:'POST',headers:{'content-length':String(2*PREVIEW_CONNECT_MAX_BYTES+1)},body:'{}'}));expect(declared).toBeInstanceOf(Response);expect((declared as Response).status).toBe(413);
 let cancelled=false;
 const stream=new ReadableStream<Uint8Array>({start(controller){for(let i=0;i<51;i++)controller.enqueue(new Uint8Array(1024*1024));},cancel(){cancelled=true;}});
 const chunked=await readConnectBody(new Request('http://localhost/connect/import',{method:'POST',body:stream,duplex:'half'} as RequestInit));expect((chunked as Response).status).toBe(413);expect(cancelled).toBe(true);
 expect(await readConnectBody(new Request('http://localhost/connect/inspect',{method:'POST',body:'{"html":"inert"}'}))).toEqual({html:'inert'});
});
