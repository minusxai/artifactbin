import {expect,it,vi} from 'vitest';
import {createFrameBridgeParent} from '../../story-runtime/frame-bridge/parent';
it.each(['response','transport-error','body-error'] as const)('a stale GraphQL %s cannot satisfy a replacement frame call',async outcome=>{
 const frame=document.createElement('iframe');document.body.append(frame);const messages:any[]=[];
 vi.spyOn(frame.contentWindow!,'postMessage').mockImplementation(message=>messages.push(message));
 const jobs:Array<{resolve:(response:Response)=>void;reject:(error:Error)=>void}>=[];
 const appFetch=vi.fn((_path:string,_init:RequestInit)=>new Promise<Response>((resolve,reject)=>jobs.push({resolve,reject})));
 let revision='1';
 const parent=createFrameBridgeParent({win:window,frame,frameOrigin:'https://runner.example',id:'Page123',nodes:[],editId:()=> 'trusted-edit',source:()=>null,htmlContext:()=>({revision,readOnly:false}),appFetch});
 const send=(key:string,payload:unknown)=>window.dispatchEvent(new MessageEvent('message',{data:{type:'mx:frame-bridge',key,payload},origin:'https://runner.example',source:frame.contentWindow}));
 const query={kind:'fetch',call:1,path:'/api/artifacts/Page123/graphql',method:'POST',headers:{authorization:'Bearer forged'},body:JSON.stringify({operation:'query',query:'{records{value}}',revision:'forged'})};
 try{
  const oldKey=messages[0].key;send(oldKey,{kind:'ready',nonce:'old'});send(oldKey,query);expect(jobs).toHaveLength(1);
  expect(JSON.parse(appFetch.mock.calls[0]![1].body as string).revision).toBe('1');expect(appFetch.mock.calls[0]![1].headers).not.toHaveProperty('authorization');
  send(oldKey,{kind:'hello'});const nextKey=messages.at(-1).key;expect(nextKey).not.toBe(oldKey);revision='2';send(nextKey,{kind:'ready',nonce:'new'});send(nextKey,query);expect(jobs).toHaveLength(2);expect(JSON.parse(appFetch.mock.calls[1]![1].body as string).revision).toBe('2');
  const oldText=vi.fn(async()=>{if(outcome==='body-error')throw Error('old body failed');return JSON.stringify({data:{records:{value:'old'}}});});
  if(outcome==='transport-error')jobs[0]!.reject(Error('old transport failed'));else jobs[0]!.resolve({status:200,headers:new Headers(),text:oldText} as unknown as Response);
  if(outcome!=='transport-error')await vi.waitFor(()=>expect(oldText).toHaveBeenCalledTimes(1));
  // Drain the accepted request and its body continuation, without completing the replacement request.
  await new Promise(resolve=>setTimeout(resolve,0));
  expect(messages.filter(message=>message.key===nextKey&&message.payload.kind==='fetch-result')).toHaveLength(0);
  jobs[1]!.resolve(Response.json({data:{records:{value:'current'}}}));
  await vi.waitFor(()=>expect(messages.filter(message=>message.key===nextKey&&message.payload.kind==='fetch-result')).toHaveLength(1));
  expect(JSON.parse(messages.at(-1).payload.body)).toEqual({data:{records:{value:'current'}}});expect(messages.at(-1).payload.call).toBe(1);
 }finally{parent.dispose();frame.remove();vi.restoreAllMocks();}
});
