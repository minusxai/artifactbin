/**
 * A PLAIN `fetch('/fn/<name>')` in a page (./fn-fetch, installed by core before any author script): only a `/fn/`
 * path on the page's own origin is a function call, answered as a real Response; every other fetch reaches the
 * browser's own fetch with the very arguments it was given.
 */
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {installFunctionFetch,type FunctionCaller,type FunctionRequest} from '../fn-fetch';

let uninstall:()=>void;
let native:ReturnType<typeof vi.fn>;
let calls:Array<{request:FunctionRequest;signal:AbortSignal|null}>;
let answer:FunctionCaller;
beforeEach(()=>{
 native=vi.fn(async()=>new Response('native'));
 window.fetch=native as unknown as typeof fetch;
 calls=[];
 answer=async()=>({status:200,headers:{'content-type':'application/json'},body:'{"ok":true}'});
 uninstall=installFunctionFetch(window,async()=>({callFunction:(request,signal)=>{calls.push({request,signal});return answer(request,signal);}}));
});
afterEach(()=>uninstall());

describe('only /fn/ on the page origin is intercepted',()=>{
 it.each([
  ['an external origin','https://api.example.com/fn/items'],
  ['an external origin URL object',new URL('https://api.example.com/fn/items')],
  ['another path on this origin','/api/data.json'],
  ['a /fn lookalike','/fnord/items'],
  ['a dot segment that leaves /fn/','/fn/../graphql'],
  ['an encoded dot segment','/fn/%2e%2e/graphql'],
 ])('%s goes to the native fetch with the same arguments',async(_label,input)=>{
  const init={method:'POST',body:'x',credentials:'include' as const};
  const response=await window.fetch(input as string,init);
  expect(await response.text()).toBe('native');
  expect(native).toHaveBeenCalledTimes(1);
  expect(native.mock.calls[0]![0]).toBe(input);expect(native.mock.calls[0]![1]).toBe(init);
  expect(calls).toHaveLength(0);
 });
 it('a native rejection (CSP, network) reaches the caller unchanged',async()=>{
  const refusal=new TypeError('Failed to fetch');native.mockRejectedValueOnce(refusal);
  await expect(window.fetch('https://blocked.example/x')).rejects.toBe(refusal);
 });
});

describe('a function call answers a real Response',()=>{
 it('POST with a JSON string body: name, body and content type cross; ok, status, headers, json()',async()=>{
  const response=await window.fetch('/fn/items',{method:'POST',body:JSON.stringify({limit:50})});
  expect(response).toBeInstanceOf(Response);
  expect(response.ok).toBe(true);expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toBe('application/json');
  expect(await response.json()).toEqual({ok:true});
  expect(native).not.toHaveBeenCalled();
  expect(calls[0]!.request).toEqual({name:'items',method:'POST',search:'',body:'{"limit":50}',contentType:'text/plain;charset=UTF-8'});
 });
 it('GET with a query string; text()',async()=>{
  answer=async()=>({status:200,headers:{'content-type':'application/json'},body:'"hi"'});
  const response=await window.fetch('/fn/hello?name=ada&n=1');
  expect(await response.text()).toBe('"hi"');
  expect(calls[0]!.request).toMatchObject({name:'hello',method:'GET',search:'?name=ada&n=1',body:null});
 });
 it('a Request object and a URL object (absolute on this origin) are calls too',async()=>{
  await window.fetch(new Request(new URL('/fn/a',location.href),{method:'POST',body:'{"x":1}',headers:{'content-type':'application/json'}}));
  await window.fetch(new URL('/fn/b?q=1',location.href));
  expect(calls.map(call=>call.request)).toEqual([
   {name:'a',method:'POST',search:'',body:'{"x":1}',contentType:'application/json'},
   {name:'b',method:'GET',search:'?q=1',body:null,contentType:null},
  ]);
 });
 it('errors are statuses, not throws: 403, 404 and 500 are Responses',async()=>{
  for(const status of [400,403,404,500]){
   answer=async()=>({status,headers:{'content-type':'application/json'},body:JSON.stringify({error:'e'+status})});
   const response=await window.fetch('/fn/items',{method:'POST',body:'{}'});
   expect(response.ok).toBe(false);expect(response.status).toBe(status);expect(await response.json()).toEqual({error:'e'+status});
  }
 });
 it('an unusable name or method answers locally, never reaching the page connection',async()=>{
  const bad=await window.fetch('/fn/a.b');
  expect(bad.status).toBe(404);expect(await bad.json()).toEqual({error:'unknown_function'});
  const nested=await window.fetch('/fn/a/b');expect(nested.status).toBe(404);
  const put=await window.fetch('/fn/items',{method:'PUT',body:'{}'});
  expect(put.status).toBe(405);expect(await put.json()).toEqual({error:'method_not_allowed'});
  expect(calls).toHaveLength(0);
 });
 it('a 204 answer has no body',async()=>{
  answer=async()=>({status:204,headers:{},body:''});
  const response=await window.fetch('/fn/items',{method:'POST'});
  expect(response.status).toBe(204);expect(await response.text()).toBe('');
 });
 it('GET with a body is the TypeError native fetch gives',async()=>{
  await expect(window.fetch('/fn/items',{method:'GET',body:'{}'})).rejects.toBeInstanceOf(TypeError);
 });
});

describe('cancellation and an absent connection',()=>{
 it('an AbortSignal reaches the call; an aborted call rejects with AbortError',async()=>{
  answer=(_request,signal)=>new Promise((_resolve,reject)=>signal!.addEventListener('abort',()=>reject(signal!.reason)));
  const controller=new AbortController();
  const pending=window.fetch('/fn/slow',{method:'POST',signal:controller.signal});
  await vi.waitFor(()=>expect(calls).toHaveLength(1));
  controller.abort();
  await expect(pending).rejects.toMatchObject({name:'AbortError'});
  expect(calls[0]!.signal!.aborted).toBe(true);
 });
 it('an already aborted signal never makes the call',async()=>{
  const controller=new AbortController();controller.abort();
  await expect(window.fetch('/fn/items',{signal:controller.signal})).rejects.toMatchObject({name:'AbortError'});
  expect(calls).toHaveLength(0);
 });
 it('no connection (an offline copy) rejects as a network failure does: TypeError',async()=>{
  answer=async()=>{throw new TypeError('Failed to fetch: page functions run only on Artifactbin');};
  await expect(window.fetch('/fn/items',{method:'POST',body:'{}'})).rejects.toBeInstanceOf(TypeError);
 });
 it('uninstalling restores the native fetch',()=>{
  uninstall();
  expect(window.fetch).toBe(native);
  uninstall=()=>{};
 });
});

// Adversarial review: cancellation must also work before the lazy reader loads.
it('aborts promptly while loading the reader',async()=>{
 uninstall();
 uninstall=installFunctionFetch(window,()=>new Promise(()=>{}));
 const controller=new AbortController();
 const pending=window.fetch('/fn/items',{signal:controller.signal});
 let settled=false;
 void pending.catch(()=>{settled=true;});
 controller.abort();
 await new Promise(resolve=>setTimeout(resolve,20));
 expect(settled).toBe(true);
});

it('does not coerce a non-function fetch input twice',async()=>{
 let coercions=0;
 const input={toString(){coercions++;return 'https://api.example.com/data';}};
 native.mockImplementationOnce(async(value:unknown)=>{String(value);return new Response('native');});
 await window.fetch(input as unknown as string);
 expect(coercions).toBe(1);
});

it.each([
 {credentials:'include' as const,mode:'cors' as const,redirect:'follow' as const},
 {credentials:'omit' as const,mode:'same-origin' as const,redirect:'error' as const},
 {credentials:'same-origin' as const,mode:'no-cors' as const,redirect:'manual' as const},
])('Request options carry no credentials or transport options into the bridge: %j',async(options)=>{
 await window.fetch(new Request(new URL('/fn/items',location.href),{...options,headers:{authorization:'Bearer forged','x-http-method-override':'DELETE'}}));
 expect(calls[0]!.request).toEqual({name:'items',method:'GET',search:'',body:null,contentType:null});
});

it('a fetch captured before installation remains native and has no bridge authority',async()=>{
 await (native as unknown as typeof fetch)('/fn/items');
 expect(calls).toHaveLength(0);
});
