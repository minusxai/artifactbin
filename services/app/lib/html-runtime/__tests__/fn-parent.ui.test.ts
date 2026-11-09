/**
 * The page (parent) half of a function call: a frame's `fetch` to this page's function path is made with the
 * reader's own session, pinned to the shell's revision, carrying no header the frame chose but its content type;
 * a refused one is still an answer (a status), a cancelled one aborts the request.
 */
import {afterEach,expect,it,vi} from 'vitest';
import {createFrameBridgeParent} from '../../html-reader/frame-bridge/parent';

let cleanup:()=>void=()=>{};
afterEach(()=>{cleanup();vi.restoreAllMocks();});
function world(context:{revision:string;readOnly:boolean}|null={revision:'7',readOnly:false}){
 const frame=document.createElement('iframe');document.body.append(frame);const messages:any[]=[];
 vi.spyOn(frame.contentWindow!,'postMessage').mockImplementation(message=>messages.push(message));
 const requests:Array<{path:string;init:RequestInit}>=[];
 let reply:(path:string,init:RequestInit)=>Promise<Response>=async()=>new Response('{"ok":1}',{status:200,headers:{'content-type':'application/json','set-cookie':'a=b','x-secret':'s'}});
 const appFetch=vi.fn((path:string,init:RequestInit)=>{requests.push({path,init});return reply(path,init);});
 const parent=createFrameBridgeParent({win:window,frame,frameOrigin:'https://runner.example',id:'Page123',editId:()=>'e',source:()=>null,...(context?{htmlContext:()=>context}:{}),appFetch});
 cleanup=()=>{parent.dispose();frame.remove();};
 const send=(payload:unknown)=>window.dispatchEvent(new MessageEvent('message',{data:{type:'mx:frame-bridge',key:messages[0].key,payload},origin:'https://runner.example',source:frame.contentWindow}));
 send({kind:'ready',nonce:'n'});
 const results=()=>messages.filter(message=>message.payload.kind==='fetch-result').map(message=>message.payload);
 return {send,requests,results,setReply:(next:typeof reply)=>{reply=next;}};
}

it('relays POST and GET with the session, the shell revision and only content-type',async()=>{
 const w=world();
 w.send({kind:'fetch',call:1,path:'/api/artifacts/Page123/fn/items',method:'POST',headers:{'content-type':'text/plain','authorization':'Bearer forged','x-page-revision':'1','cookie':'c'},body:'{"limit":5}'});
 w.send({kind:'fetch',call:2,path:'/api/artifacts/Page123/fn/items?limit=5',method:'GET',headers:{},body:null});
 await vi.waitFor(()=>expect(w.results()).toHaveLength(2));
 expect(w.requests[0]!.path).toBe('/api/artifacts/Page123/fn/items');
 expect(w.requests[0]!.init).toMatchObject({method:'POST',body:'{"limit":5}',headers:{'content-type':'text/plain','x-page-revision':'7'}});
 expect(Object.keys(w.requests[0]!.init.headers as object).sort()).toEqual(['content-type','x-page-revision']);
 expect(w.requests[1]!.path).toBe('/api/artifacts/Page123/fn/items?limit=5');
 expect(w.requests[1]!.init.body).toBeUndefined();
 expect(w.results()[0]).toEqual({kind:'fetch-result',call:1,status:200,headers:{'content-type':'application/json'},body:'{"ok":1}'});
});

it.each([
 ['another page',{path:'/api/artifacts/Other/fn/items',method:'POST',body:'{}'},'refused'],
 ['a dot name',{path:'/api/artifacts/Page123/fn/a.b',method:'POST',body:'{}'},404],
 ['a nested name',{path:'/api/artifacts/Page123/fn/a/b',method:'POST',body:'{}'},404],
 ['an encoded slash',{path:'/api/artifacts/Page123/fn/a%2Fb',method:'POST',body:'{}'},404],
 ['a GET with a body',{path:'/api/artifacts/Page123/fn/a',method:'GET',body:'{}'},400],
 ['an oversized body',{path:'/api/artifacts/Page123/fn/a',method:'POST',body:'x'.repeat(1_000_001)},413],
 ['another origin',{path:'https://evil.example/api/artifacts/Page123/fn/a',method:'POST',body:'{}'},'refused'],
])('refuses %s without a request',async(_label,request,outcome)=>{
 const w=world();
 w.send({kind:'fetch',call:9,headers:{},...request});
 await vi.waitFor(()=>expect(w.results()).toHaveLength(1));
 expect(w.requests).toHaveLength(0);
 if(outcome==='refused')expect(w.results()[0]).toMatchObject({call:9,error:'refused'});
 else expect(w.results()[0]).toMatchObject({call:9,status:outcome,headers:{'content-type':'application/json'}});
});

it('a reader without an HTML shell context cannot call functions',async()=>{
 const w=world(null);
 w.send({kind:'fetch',call:1,path:'/api/artifacts/Page123/fn/items',method:'POST',headers:{},body:'{}'});
 await vi.waitFor(()=>expect(w.results()).toHaveLength(1));
 expect(w.requests).toHaveLength(0);expect(w.results()[0]).toMatchObject({status:403});
});

it('fetch-cancel aborts the request and nothing is answered for it',async()=>{
 const w=world();
 let seen:AbortSignal|undefined;
 w.setReply((_path,init)=>new Promise((_resolve,reject)=>{seen=init.signal!;init.signal!.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')));}));
 w.send({kind:'fetch',call:3,path:'/api/artifacts/Page123/fn/slow',method:'POST',headers:{},body:'{}'});
 await vi.waitFor(()=>expect(seen).toBeDefined());
 w.send({kind:'fetch-cancel',call:3});
 expect(seen!.aborted).toBe(true);
 await new Promise(resolve=>setTimeout(resolve,0));
 expect(w.results()).toHaveLength(0);
});
