/** The frame bridge's upload relay (lib/story-runtime/frame-bridge/upload): what a page's file upload may ask the app to write. */
import {expect,it} from 'vitest';
import {relayedFileUpload} from '../frame-bridge/upload';
it('trusted upload admission pins document and edit, strips caller authority, bounds bytes and refuses historical writes',()=>{
 const request={datasetId:'Dataset1',filename:'sample.txt',contentType:'text/plain',requestId:'request-123',bytes:new Uint8Array([1,2])};
 const allowed=relayedFileUpload('Page1','trusted-edit',false,request)!;expect(allowed.path).toBe('/a/Page1/datasets/Dataset1/files');expect(allowed.init.headers).toEqual({'Content-Type':'text/plain','X-Filename':'sample.txt','X-Edit-Id':'trusted-edit','Idempotency-Key':'request-123'});expect(allowed.init.body).toEqual(request.bytes);
 expect(relayedFileUpload('Page1','trusted-edit',true,request)).toBeNull();expect(relayedFileUpload('Page1','',false,request)).toBeNull();
 expect(relayedFileUpload('Page1','trusted-edit',false,{...request,datasetId:'../other'})).toBeNull();expect(relayedFileUpload('Page1','trusted-edit',false,{...request,bytes:new Uint8Array(50_000_001)})).toBeNull();
});
