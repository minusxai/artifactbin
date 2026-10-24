import {it,expect,vi} from 'vitest';
import {createLocalDatasetTransport} from '../browser-local-datasets';
it('admits only trusted private loopback endpoint and omits credentials',async()=>{
 const send=vi.fn<typeof fetch>(async()=>new Response(JSON.stringify({data:{local:{}}}))),location={origin:'http://127.0.0.1:3456',protocol:'http:',hostname:'127.0.0.1'};
 const request={query:'{local{schema{revision}}}',variables:{},operation:'query' as const};
 const port=createLocalDatasetTransport({privatePreview:true,endpoint:'/__af_preview/datasets'},location,send);
 expect(port.online()).toBe(true);await port.execute(request);expect(send.mock.calls[0]![1]).toMatchObject({credentials:'omit',redirect:'error'});
 const blocked=createLocalDatasetTransport({privatePreview:true,endpoint:'https://example.invalid'},location,send);
 expect(blocked.online()).toBe(false);await expect(blocked.execute(request)).rejects.toThrow('unavailable');expect(send).toHaveBeenCalledTimes(1);
});
