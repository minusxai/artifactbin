import {it,expect,vi} from 'vitest';
import {observeUploadRequests} from '../lib/component-upload-route.mjs';
it('uses the later page route so the capture guard cannot bypass real upload observation',async()=>{
 const page={route:vi.fn()},proof={requests:0,statuses:[],requestIds:[],refs:[]};
 const records=await observeUploadRequests({page,origin:'http://localhost:3030',proof,discardFirstSuccess:true});
 const handler=page.route.mock.calls[0][1];expect(page.route.mock.calls[0][0]).toBe('**/a/*/datasets/*/files');
 const route=(status,url='http://localhost:3030/a/Page123/datasets/Data123/files',method='POST')=>{
  const response={status:()=>status,body:async()=>Buffer.from(JSON.stringify({ref:'dfile:one',replayed:status===201}))};
  return {request:()=>({url:()=>url,method:()=>method,headers:()=>({'idempotency-key':'same-request'})}),fetch:vi.fn(async()=>response),fallback:vi.fn(),abort:vi.fn(),fulfill:vi.fn(),response};
 };
 const foreign=route(201,'https://example.test/a/Page123/datasets/Data123/files');await handler(foreign);expect(foreign.fallback).toHaveBeenCalledOnce();expect(foreign.fetch).not.toHaveBeenCalled();
 const read=route(200,undefined,'GET');await handler(read);expect(read.fallback).toHaveBeenCalledOnce();
 const denied=route(403);await handler(denied);expect(denied.fulfill).toHaveBeenCalledWith({response:denied.response});expect(denied.abort).not.toHaveBeenCalled();
 const accepted=route(201);await handler(accepted);expect(accepted.fetch).toHaveBeenCalledOnce();expect(accepted.abort).toHaveBeenCalledWith('failed');expect(accepted.fulfill).not.toHaveBeenCalled();
 const replay=route(201);await handler(replay);expect(replay.fulfill).toHaveBeenCalledWith({response:replay.response});expect(replay.abort).not.toHaveBeenCalled();
 expect(records.map(record=>record.status)).toEqual([403,201,201]);expect(proof.requestIds).toEqual(['same-request','same-request','same-request']);
});
it('fails the canary immediately on a real unexpected status and bounds a missing response',async()=>{
 const {requireUploadResponse}=await import('../lib/component-upload-route.mjs');
 await expect(requireUploadResponse([{status:403}],1,201)).rejects.toThrow('expected 201, received 403');
 await expect(requireUploadResponse([{status:201}],1,201)).resolves.toMatchObject({status:201});
 vi.useFakeTimers();try{const pending=requireUploadResponse([],1,201),failure=expect(pending).rejects.toThrow('No upload response');await vi.advanceTimersByTimeAsync(10_000);await failure;}finally{vi.useRealTimers();}
});
