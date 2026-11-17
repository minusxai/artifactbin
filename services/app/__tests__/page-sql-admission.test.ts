/** Common request admission may expire, but a late body cannot revive it and dispatch a write. */
import { expect, it, vi } from 'vitest';
import { request, useAppHarness } from './harness';
import { fixture, params, stored } from './page-sql-door-fixture';
import { POST } from '@/app/api/artifacts/[id]/sql/route';
import * as authentication from '@/lib/authentication';
import {services,getDb} from '@/lib/platform';
import {ownerHostSqlRead} from '@/lib/page-doors';
useAppHarness();

it('refuses stalled mixed-operation admission and never writes after the late body arrives', async () => {
  const f=await fixture();
  const before=await stored(f.staff);
  let stream!:ReadableStreamDefaultController<Uint8Array>;
  const body=new ReadableStream<Uint8Array>({start(c){stream=c;c.enqueue(new TextEncoder().encode('{'));}});
  const base=request(`/api/artifacts/${f.page}/sql`,{method:'POST',token:f.owner.token});
  const req=new Request(base,{body,duplex:'half'} as RequestInit & {duplex:'half'});
  const originalTimeout=AbortSignal.timeout.bind(AbortSignal);
  const originalTimer=setTimeout;
  const signalSpy=vi.spyOn(AbortSignal,'timeout').mockImplementation(ms=>originalTimeout(ms===20000?40:ms));
  const timerSpy=vi.spyOn(globalThis,'setTimeout').mockImplementation(((handler:Parameters<typeof setTimeout>[0],ms?:number,...args:unknown[])=>originalTimer(handler,ms===20000?40:ms,...args)) as typeof setTimeout);
  let guard:ReturnType<typeof setTimeout>|undefined;
  const pending=POST(req,params(f.page));
  const finish=()=>{try{stream.enqueue(new TextEncoder().encode('"revision":"1","sql":"insert into staff(name) values (\'late\')"}'));stream.close();}catch{/* admission may cancel the input stream */}};
  try {
    const result=await Promise.race([pending,new Promise<'waiting'>(resolve=>{guard=originalTimer(()=>resolve('waiting'),250);})]);
    expect(result).toBeInstanceOf(Response);
    if(result==='waiting')return;
    expect([404,408]).toContain(result.status);
    finish();
    await new Promise(resolve=>originalTimer(resolve,80));
    expect(await stored(f.staff)).toEqual(before);
  } finally {clearTimeout(guard);finish();await pending;timerSpy.mockRestore();signalSpy.mockRestore();}
});

it('keeps an already dispatched write on the original signal past admission expiry',async()=>{
 const f=await fixture(),engine=services().sql,mutate=engine.mutate.bind(engine);
 const timer=setTimeout;
 const timerSpy=vi.spyOn(globalThis,'setTimeout').mockImplementation(((handler:Parameters<typeof setTimeout>[0],ms?:number,...args:unknown[])=>timer(handler,ms===20000?100:ms,...args)) as typeof setTimeout);
 let dispatched=0;
 const spy=vi.spyOn(engine,'mutate').mockImplementation(async input=>{dispatched++;await new Promise(resolve=>timer(resolve,150));return mutate(input);});
 try{
  const reply=await POST(request(`/api/artifacts/${f.page}/sql`,{method:'POST',token:f.owner.token,json:{revision:'1',sql:"insert into staff(name) values ('admitted')"}}),params(f.page));
  expect(dispatched).toBeGreaterThan(0);expect(reply.status).toBe(200);
  expect((await stored(f.staff)).some(row=>row.name==='admitted')).toBe(true);
 }finally{spy.mockRestore();timerSpy.mockRestore();}
});

it.each(['opaque','owner'])('bounds %s wrapper admission before any dispatch',async mode=>{
 const f=await fixture();
 let release!:()=>void;
 const stalled=new Promise<void>(resolve=>{release=resolve;});
 const timer=setTimeout;
 const spy=vi.spyOn(globalThis,'setTimeout').mockImplementation(((handler:Parameters<typeof setTimeout>[0],ms?:number,...args:unknown[])=>timer(handler,ms===20000?30:ms,...args)) as typeof setTimeout);
 let stream!:ReadableStreamDefaultController<Uint8Array>;
 const body=new ReadableStream<Uint8Array>({start(c){stream=c;}});
 const req=new Request(request(`/api/artifacts/${f.page}/sql`,{method:'POST',headers:{origin:'null'}}),{body,duplex:'half'} as RequestInit);
 try{
  const response=await (mode==='opaque'?POST(req,params(f.page)):ownerHostSqlRead(req,f.page,async()=>{await stalled;return true;}));
  expect(response.status).toBe(404);
 }finally{release();stream.close();spy.mockRestore();}
});

it('expires stalled actor admission without continuing into SQL',async()=>{
 const f=await fixture();let release!:()=>void;
 const stalled=new Promise<void>(resolve=>{release=resolve;});
 const original=authentication.requestOrSessionActor;
 const actorSpy=vi.spyOn(authentication,'requestOrSessionActor').mockImplementation(async req=>{await stalled;return original(req);});
 const timer=setTimeout;
 const timerSpy=vi.spyOn(globalThis,'setTimeout').mockImplementation(((handler:Parameters<typeof setTimeout>[0],ms?:number,...args:unknown[])=>timer(handler,ms===20000?30:ms,...args)) as typeof setTimeout);
 try{
  const response=await POST(request(`/api/artifacts/${f.page}/sql`,{method:'POST',token:f.owner.token,json:{revision:'1',sql:"insert into staff(name) values ('late actor')"}}),params(f.page));
  expect(response.status).toBe(404);release();await new Promise(resolve=>timer(resolve,60));
  expect((await stored(f.staff)).some(row=>row.name==='late actor')).toBe(false);
 }finally{release();actorSpy.mockRestore();timerSpy.mockRestore();}
});

it('includes the final owner-host fence in the read lifetime',async()=>{
 const f=await fixture(),timer=setTimeout;
 // The shortened lifetime must outlast the first two fences on a loaded runner and expire inside the stalled third.
 const timerSpy=vi.spyOn(globalThis,'setTimeout').mockImplementation(((handler:Parameters<typeof setTimeout>[0],ms?:number,...args:unknown[])=>timer(handler,ms!==undefined&&ms>40000&&ms<=45000?400:ms,...args)) as typeof setTimeout);
 let checks=0;
 try{
  const response=await ownerHostSqlRead(request(`/api/artifacts/${f.page}/sql`,{method:'POST',json:{revision:'1',sql:'select name from staff'}}),f.page,async()=>{if(++checks===3)await new Promise(resolve=>timer(resolve,1000));return true;});
  expect(checks).toBe(3);expect(response.status).toBe(404);
 }finally{timerSpy.mockRestore();}
});

it('bounds linked metadata admission and cannot dispatch after its late completion',async()=>{
 const f=await fixture(),db=await getDb(),query=db.query.bind(db),timer=setTimeout;
 let release!:()=>void,blocked=0;
 const stalled=new Promise<void>(resolve=>{release=resolve;});
 const dbSpy=vi.spyOn(db,'query').mockImplementation((async(text:string,values?:unknown[])=>{if(values?.includes(f.staff)&&/^\s*select/i.test(text)){blocked++;await stalled;}return query(text,values);}) as typeof db.query);
 const timerSpy=vi.spyOn(globalThis,'setTimeout').mockImplementation(((handler:Parameters<typeof setTimeout>[0],ms?:number,...args:unknown[])=>timer(handler,ms===20000?40:ms,...args)) as typeof setTimeout);
 try{
  const response=await POST(request(`/api/artifacts/${f.page}/sql`,{method:'POST',token:f.owner.token,json:{revision:'1',sql:"insert into staff(name) values ('late metadata')"}}),params(f.page));
  expect(blocked).toBeGreaterThan(0);expect(response.status).toBe(404);
  release();await new Promise(resolve=>timer(resolve,100));
  expect((await stored(f.staff)).some(row=>row.name==='late metadata')).toBe(false);
 }finally{release();dbSpy.mockRestore();timerSpy.mockRestore();}
});
