/**
 * The reader's half of a function call (./fn-relay): one bridge `fetch` per call to this page's function path,
 * its raw answer back, a `fetch-cancel` on abort, and a TypeError when the connection goes.
 */
import {describe,expect,it,vi} from 'vitest';
import {createDomainFunctionCall} from '../domain-reads';
import {createFunctionRelay} from '../fn-relay';
import type {FrameBridgeFramePayload} from '../../html-reader/contract';

const setup=()=>{let n=0;const posts:FrameBridgeFramePayload[]=[];const relay=createFunctionRelay((payload)=>posts.push(payload),()=>++n,'Page 1');return {posts,relay};};

describe('the reader relays a function call over the bridge',()=>{
 it('posts one fetch to the page function path and resolves the raw answer',async()=>{
  const {posts,relay}=setup();
  const pending=relay.call({name:'items',method:'POST',search:'?a=1',body:'{"limit":5}',contentType:'text/plain;charset=UTF-8'},null);
  expect(posts).toEqual([{kind:'fetch',call:1,path:'/api/artifacts/Page%201/fn/items?a=1',method:'POST',headers:{'content-type':'text/plain;charset=UTF-8'},body:'{"limit":5}'}]);
  expect(relay.receive({kind:'fetch-result',call:2,status:200,headers:{},body:'x'})).toBe(false);
  expect(relay.receive({kind:'fetch-result',call:1,status:403,headers:{'content-type':'application/json'},body:'{"error":"forbidden"}'})).toBe(true);
  expect(await pending).toEqual({status:403,headers:{'content-type':'application/json'},body:'{"error":"forbidden"}'});
 });
 it('a transport failure is a TypeError (the outcome is unknown)',async()=>{
  const {relay}=setup();
  const pending=relay.call({name:'a',method:'GET',search:'',body:null,contentType:null},null);
  relay.receive({kind:'fetch-result',call:1,error:'offline'});
  await expect(pending).rejects.toBeInstanceOf(TypeError);
 });
 it('abort posts fetch-cancel and rejects with the signal reason; a late answer is dropped',async()=>{
  const {posts,relay}=setup();const controller=new AbortController();
  const pending=relay.call({name:'a',method:'POST',search:'',body:'{}',contentType:null},controller.signal);
  controller.abort();
  await expect(pending).rejects.toMatchObject({name:'AbortError'});
  expect(posts.at(-1)).toEqual({kind:'fetch-cancel',call:1});
  expect(relay.receive({kind:'fetch-result',call:1,status:200,headers:{},body:'1'})).toBe(false);
 });
 it('dispose rejects every pending call with TypeError',async()=>{
  const {relay}=setup();
  const pending=relay.call({name:'a',method:'GET',search:'',body:null,contentType:null},null);
  relay.dispose();
  await expect(pending).rejects.toBeInstanceOf(TypeError);
 });
});

it('pins an unframed archived page function to its served revision',async()=>{
 const page={pageId:'Page123',revision:'1'};
 const send=vi.fn(async()=>new Response('{}'));
 await createDomainFunctionCall(page,{href:'https://page.example/report'},send)(
  {name:'items',method:'GET',search:'',body:null,contentType:null},null);
 const [url,init]=send.mock.calls[0] as unknown as [URL,RequestInit];
 expect(new Headers(init.headers).get('x-page-revision')??url.searchParams.get('revision')).toBe('1');
});
