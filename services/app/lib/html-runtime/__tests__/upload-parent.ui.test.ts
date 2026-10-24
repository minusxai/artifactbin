import {expect,it,vi} from 'vitest';
import {createFrameBridgeParent} from '../../story-runtime/frame-bridge/parent';
it('an accepted upload completing after a frame reload cannot satisfy a replacement frame call',async()=>{
 const frame=document.createElement('iframe');document.body.append(frame);const messages:any[]=[];
 vi.spyOn(frame.contentWindow!,'postMessage').mockImplementation(message=>messages.push(message));
 let finish!:(response:Response)=>void;
 const parent=createFrameBridgeParent({win:window,frame,frameOrigin:'https://runner.example',id:'Page123',nodes:[],editId:()=> 'trusted-edit',source:()=>null,htmlContext:()=>({revision:'1',readOnly:false}),appFetch:()=>new Promise(resolve=>{finish=resolve;})});
 const send=(key:string,payload:unknown)=>window.dispatchEvent(new MessageEvent('message',{data:{type:'mx:frame-bridge',key,payload},origin:'https://runner.example',source:frame.contentWindow}));
 try{
  const oldKey=messages[0].key;send(oldKey,{kind:'ready',nonce:'old'});send(oldKey,{kind:'upload-file',call:1,datasetId:'Dataset123',filename:'sample.txt',contentType:'text/plain',requestId:'request-123',bytes:new Uint8Array([1])});expect(finish).toBeTypeOf('function');
  send(oldKey,{kind:'hello'});const nextKey=messages.at(-1).key;expect(nextKey).not.toBe(oldKey);send(nextKey,{kind:'ready',nonce:'new'});
  finish(Response.json({ref:'dfile:abc123def456',url:'/file',name:'sample.txt',contentType:'text/plain',size:1},{status:201}));
  await vi.waitFor(()=>{expect(messages.filter(message=>message.key===nextKey&&message.payload.kind==='fetch-result')).toHaveLength(0);});
  await new Promise(resolve=>setTimeout(resolve,10));expect(messages.filter(message=>message.key===nextKey&&message.payload.kind==='fetch-result')).toHaveLength(0);
 }finally{parent.dispose();frame.remove();vi.restoreAllMocks();}
});
