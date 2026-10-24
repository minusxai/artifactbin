import {afterEach,expect,it,vi} from 'vitest';
import {createUploadRelay} from '../upload-relay';
const request={datasetId:'Dataset123',filename:'sample.txt',contentType:'text/plain',requestId:'request-123',bytes:new Uint8Array([1])};
afterEach(()=>vi.useRealTimers());
it('caps pending uploads and owns cancellation, timeout, late replies and disconnect without retrying',async()=>{
 vi.useFakeTimers();let call=0;const posted:any[]=[];const relay=createUploadRelay(p=>posted.push(p),()=>++call);
 const controller=new AbortController(),first=relay.send(request,controller.signal);const canceled=expect(first).rejects.toThrow('canceled');controller.abort();await canceled;
 expect(relay.receive({kind:'fetch-result',call:1,status:201,headers:{},body:'{}'})).toBe(false);
 const jobs=Array.from({length:4},()=>relay.send(request));const timeouts=jobs.map(job=>expect(job).rejects.toThrow('timed out'));
 await expect(relay.send(request)).rejects.toThrow('Too many');await vi.advanceTimersByTimeAsync(30_000);await Promise.all(timeouts);
 const last=relay.send(request),closed=expect(last).rejects.toThrow('connection closed');relay.dispose();await closed;
 expect(posted).toHaveLength(6);
});
it('refuses incomplete success responses and propagates actual server errors',async()=>{
 let call=0;const relay=createUploadRelay(()=>{},()=>++call);
 const incomplete=relay.send(request),bad=expect(incomplete).rejects.toThrow('incomplete');relay.receive({kind:'fetch-result',call:1,status:201,headers:{},body:'{}'});await bad;
 const denied=relay.send(request),failure=expect(denied).rejects.toThrow('No insert grant');relay.receive({kind:'fetch-result',call:2,status:403,headers:{},body:JSON.stringify({detail:'No insert grant'})});await failure;
});
