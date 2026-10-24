import {expect,it,vi} from 'vitest';
import {createFrameBridgeParent} from '../../story-runtime/frame-bridge/parent';
it('an accepted upload completing after a frame reload cannot satisfy a replacement frame call',async()=>{
 const frame=document.createElement('iframe');document.body.append(frame);const messages:any[]=[];
 vi.spyOn(frame.contentWindow!,'postMessage').mockImplementation(message=>messages.push(message));
 let finish!:(response:Response)=>void;
 const parent=createFrameBridgeParent({win:window,frame,frameOrigin:'https://runner.example',id:'Page123',nodes:[],editId:()=> 'trusted-edit',source:()=>null,htmlContext:()=>({revision:'1',readOnly:false,uploadSession:{state:'signed-in',subject:'owner'}}),appFetch:()=>new Promise(resolve=>{finish=resolve;})});
 const send=(key:string,payload:unknown)=>window.dispatchEvent(new MessageEvent('message',{data:{type:'mx:frame-bridge',key,payload},origin:'https://runner.example',source:frame.contentWindow}));
 try{
  const oldKey=messages[0].key;send(oldKey,{kind:'ready',nonce:'old'});send(oldKey,{kind:'upload-file',call:1,datasetId:'Dataset123',filename:'sample.txt',contentType:'text/plain',requestId:'request-123',bytes:new Uint8Array([1])});await vi.waitFor(()=>expect(finish).toBeTypeOf('function'));
  send(oldKey,{kind:'hello'});const nextKey=messages.at(-1).key;expect(nextKey).not.toBe(oldKey);send(nextKey,{kind:'ready',nonce:'new'});
  finish(Response.json({ref:'dfile:abc123def456',url:'/file',name:'sample.txt',contentType:'text/plain',size:1},{status:201}));
  await vi.waitFor(()=>{expect(messages.filter(message=>message.key===nextKey&&message.payload.kind==='fetch-result')).toHaveLength(0);});
  await new Promise(resolve=>setTimeout(resolve,10));expect(messages.filter(message=>message.key===nextKey&&message.payload.kind==='fetch-result')).toHaveLength(0);
 }finally{parent.dispose();frame.remove();vi.restoreAllMocks();}
});
it('a trusted same-frame session change aborts pending upload, suppresses its late answer and refuses guests',async()=>{
 const frame=document.createElement('iframe');document.body.append(frame);const messages:any[]=[];
 vi.spyOn(frame.contentWindow!,'postMessage').mockImplementation(message=>messages.push(message));
 let session:{state:'signed-in'|'signed-out';subject?:string}={state:'signed-in',subject:'first'};
 let finish!:(response:Response)=>void;let signal:AbortSignal|undefined;
 const appFetch=vi.fn((_path:string,init:RequestInit)=>{signal=init.signal as AbortSignal;return new Promise<Response>(resolve=>{finish=resolve;});});
 const parent=createFrameBridgeParent({win:window,frame,frameOrigin:'https://runner.example',id:'Page123',nodes:[],editId:()=> 'trusted-edit',source:()=>null,htmlContext:()=>({revision:'1',readOnly:false,uploadSession:session}),appFetch});
 const send=(payload:unknown)=>window.dispatchEvent(new MessageEvent('message',{data:{type:'mx:frame-bridge',key:messages[0].key,payload},origin:'https://runner.example',source:frame.contentWindow}));
 try{
  expect(messages[0].payload.uploadContext).toMatchObject({state:'signed-in'});expect(JSON.stringify(messages[0])).not.toContain('first');
  send({kind:'ready',nonce:'same'});send({kind:'upload-file',call:1,datasetId:'Dataset123',filename:'sample.txt',contentType:'text/plain',requestId:'request-123',bytes:new Uint8Array([1])});await vi.waitFor(()=>expect(appFetch).toHaveBeenCalledTimes(1));
  session={state:'signed-out'};parent.refreshUploadContext();expect(signal?.aborted).toBe(true);expect(messages.at(-1).payload.context.state).toBe('signed-out');
  finish(Response.json({ref:'dfile:abc123',url:'/file',name:'sample.txt',contentType:'text/plain',size:1},{status:201}));
  await new Promise(resolve=>setTimeout(resolve,10));expect(messages.some(message=>message.payload.kind==='fetch-result'&&message.payload.call===1)).toBe(false);
  send({kind:'upload-file',call:2,datasetId:'Dataset123',filename:'sample.txt',contentType:'text/plain',requestId:'request-456',bytes:new Uint8Array([1])});expect(appFetch).toHaveBeenCalledTimes(1);expect(messages.at(-1).payload.status).toBe(403);
 }finally{parent.dispose();frame.remove();vi.restoreAllMocks();}
});

it('does not start an upload when trusted scope changes while its relay module loads',async()=>{
 const frame=document.createElement('iframe');document.body.append(frame);const messages:any[]=[];
 vi.spyOn(frame.contentWindow!,'postMessage').mockImplementation(message=>messages.push(message));
 let subject='first';const appFetch=vi.fn(async()=>Response.json({}));
 const parent=createFrameBridgeParent({win:window,frame,frameOrigin:'https://runner.example',id:'Page123',nodes:[],editId:()=> 'trusted-edit',source:()=>null,htmlContext:()=>({revision:'1',readOnly:false,uploadSession:{state:'signed-in',subject}}),appFetch});
 const send=(payload:unknown)=>window.dispatchEvent(new MessageEvent('message',{data:{type:'mx:frame-bridge',key:messages[0].key,payload},origin:'https://runner.example',source:frame.contentWindow}));
 try{
  send({kind:'ready',nonce:'same'});send({kind:'upload-file',call:1,datasetId:'Dataset123',filename:'sample.txt',contentType:'text/plain',requestId:'request-123',bytes:new Uint8Array([1])});
  subject='replacement';parent.refreshUploadContext();
  await new Promise(resolve=>setTimeout(resolve,20));
  expect(appFetch).not.toHaveBeenCalled();expect(messages.some(message=>message.payload.kind==='fetch-result')).toBe(false);
 }finally{parent.dispose();frame.remove();vi.restoreAllMocks();}
});
