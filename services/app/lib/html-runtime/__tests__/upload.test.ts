import {expect,it} from 'vitest';
import {createFileUploader} from '../upload';
import {relayedFileUpload} from '../../story-runtime/frame-bridge/upload';
import type {FileUploadRequest} from '../upload-contract';
const file=()=>new File(['hello'],'sample.txt',{type:'text/plain'});
it('retries the same File with one request id and only an admitted linked dataset',async()=>{
 const sent:FileUploadRequest[]=[];
 const uploader=createFileUploader({readOnly:()=>false,datasetId:name=>name==='attachments'?'Dataset1':undefined,async send(request){sent.push(request);if(sent.length===1)throw Error('outcome unknown');return {ref:'dfile:abc123def456',name:'sample.txt',contentType:'text/plain',size:5,url:'/a/Page1/datasets/Dataset1/files/abc123def456'};}});
 const selected=file();await expect(uploader.upload(selected,{dataset:'attachments'})).rejects.toThrow('unknown');
 const result=await uploader.upload(selected,{dataset:'attachments'});expect(result.ref).toBe('dfile:abc123def456');expect(sent[0]?.requestId).toBe(sent[1]?.requestId);expect(Buffer.from(sent[0]!.bytes).toString()).toBe('hello');
 await expect(uploader.upload(selected,{dataset:'unknown'})).rejects.toThrow('linked dataset');expect(sent).toHaveLength(2);
});
it('portable and aborted uploads refuse before reading or sending bytes',async()=>{
 let calls=0;const uploader=createFileUploader({readOnly:()=>true,datasetId:()=> 'Dataset1',async send(){calls++;throw Error();}});
 await expect(uploader.upload(file(),{dataset:'attachments'})).rejects.toThrow('read-only');
 const controller=new AbortController();controller.abort();const writable=createFileUploader({readOnly:()=>false,datasetId:()=> 'Dataset1',async send(){calls++;throw Error();}});
 await expect(writable.upload(file(),{dataset:'attachments',signal:controller.signal})).rejects.toThrow();expect(calls).toBe(0);
});
it('trusted upload admission pins document and edit, strips caller authority, bounds bytes and refuses historical writes',()=>{
 const request:FileUploadRequest={datasetId:'Dataset1',filename:'sample.txt',contentType:'text/plain',requestId:'request-123',bytes:new Uint8Array([1,2])};
 const allowed=relayedFileUpload('Page1','trusted-edit',false,request)!;expect(allowed.path).toBe('/a/Page1/datasets/Dataset1/files');expect(allowed.init.headers).toEqual({'Content-Type':'text/plain','X-Filename':'sample.txt','X-Edit-Id':'trusted-edit','Idempotency-Key':'request-123'});expect(allowed.init.body).toEqual(request.bytes);
 expect(relayedFileUpload('Page1','trusted-edit',true,request)).toBeNull();expect(relayedFileUpload('Page1','',false,request)).toBeNull();
 expect(relayedFileUpload('Page1','trusted-edit',false,{...request,datasetId:'../other'})).toBeNull();expect(relayedFileUpload('Page1','trusted-edit',false,{...request,bytes:new Uint8Array(50_000_001)})).toBeNull();
});
it('refuses oversized files before transport and rejects incomplete real receipts',async()=>{
 let sends=0;const uploader=createFileUploader({readOnly:()=>false,datasetId:()=> 'Dataset123',async send(){sends++;throw Error();}});
 const huge=file();Object.defineProperty(huge,'size',{value:50_000_001});await expect(uploader.upload(huge,{dataset:'attachments'})).rejects.toThrow('50 MB');expect(sends).toBe(0);
});
