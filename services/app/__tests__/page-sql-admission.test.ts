/** Common request admission may expire, but a late body cannot revive it and dispatch a write. */
import { expect, it, vi } from 'vitest';
import { request, useAppHarness } from './harness';
import { fixture, params, stored } from './page-sql-door-fixture';
import { POST } from '@/app/api/artifacts/[id]/sql/route';
import * as authentication from '@/lib/authentication';
import {services,getDb} from '@/lib/platform';
import {ownerHostSqlRead} from '@/lib/page-doors';
import {SQL_FAILURES} from '@artifactbin/contracts';
/** A condition wait's bound (vi.waitFor's own default is 1 s): the condition decides; this only names one that never came. */
const WAIT_MS = 20_000;
useAppHarness();

/**
 * The door's lifetime timers, held by the test: each `setTimeout` whose delay `matches` still runs for real (it is
 * far off), and `expire()` fires every one not yet cleared, now, as if its time had passed. A timer the door cleared
 * never fires, as in production. No test here races a shortened real timer against the work.
 */
function heldTimers(matches:(ms:number)=>boolean){
 const set=setTimeout,clear=clearTimeout,held=new Map<unknown,()=>void>();
 const setSpy=vi.spyOn(globalThis,'setTimeout').mockImplementation(((handler:(...args:unknown[])=>void,ms?:number,...args:unknown[])=>{
  const handle=set(handler,ms,...args);if(ms!==undefined&&matches(ms))held.set(handle,()=>handler(...args));return handle;
 }) as typeof setTimeout);
 const clearSpy=vi.spyOn(globalThis,'clearTimeout').mockImplementation(((handle?:Parameters<typeof clearTimeout>[0])=>{held.delete(handle);clear(handle);}) as typeof clearTimeout);
 return {
  count:()=>held.size,
  expire:()=>{const due=[...held.values()];held.clear();for(const fire of due)fire();},
  restore:()=>{setSpy.mockRestore();clearSpy.mockRestore();},
 };
}
/** The 20 s admission lifetime (lib/page-doors `admission`). */
const ADMISSION=(ms:number)=>ms===20000;

it('refuses stalled mixed-operation admission and never writes after the late body arrives', async () => {
  const f=await fixture();
  const before=await stored(f.staff);
  let stream!:ReadableStreamDefaultController<Uint8Array>;
  const body=new ReadableStream<Uint8Array>({start(c){stream=c;c.enqueue(new TextEncoder().encode('{'));}});
  const base=request(`/api/artifacts/${f.page}/sql`,{method:'POST',token:f.owner.token});
  const req=new Request(base,{body,duplex:'half'} as RequestInit & {duplex:'half'});
  const timers=heldTimers(ADMISSION);
  const engine=services().sql,mutate=vi.spyOn(engine,'mutate');
  const pending=POST(req,params(f.page));
  const finish=()=>{try{stream.enqueue(new TextEncoder().encode('"revision":"1","sql":"insert into staff(name) values (\'late\')"}'));stream.close();}catch{/* admission may cancel the input stream */}};
  try {
    await vi.waitFor(()=>expect(timers.count()).toBe(1), { timeout: WAIT_MS });
    timers.expire();
    const result=await pending;
    expect([404,408]).toContain(result.status);
    finish();
    // The late body is now readable; anything still chained on it has run once the event loop drains.
    await new Promise(resolve=>setImmediate(resolve));
    expect(mutate).not.toHaveBeenCalled();
    expect(await stored(f.staff)).toEqual(before);
  } finally {finish();await pending;mutate.mockRestore();timers.restore();}
});

it('keeps an already dispatched write on the original signal past admission expiry',async()=>{
 const f=await fixture(),engine=services().sql,mutate=engine.mutate.bind(engine);
 const timers=heldTimers(ADMISSION);
 let dispatched=0;
 // The admission lifetime runs out the moment the write is dispatched: the write must not hear it.
 const spy=vi.spyOn(engine,'mutate').mockImplementation(async input=>{dispatched++;timers.expire();return mutate(input);});
 try{
  const reply=await POST(request(`/api/artifacts/${f.page}/sql`,{method:'POST',token:f.owner.token,json:{revision:'1',sql:"insert into staff(name) values ('admitted')"}}),params(f.page));
  expect(dispatched).toBeGreaterThan(0);expect(reply.status).toBe(200);
  expect((await stored(f.staff)).some(row=>row.name==='admitted')).toBe(true);
 }finally{spy.mockRestore();timers.restore();}
});

it.each(['opaque','owner'])('bounds %s wrapper admission before any dispatch',async mode=>{
 const f=await fixture();
 let release!:()=>void;
 const stalled=new Promise<void>(resolve=>{release=resolve;});
 const timers=heldTimers(ADMISSION);
 let stream!:ReadableStreamDefaultController<Uint8Array>;
 const body=new ReadableStream<Uint8Array>({start(c){stream=c;}});
 const req=new Request(request(`/api/artifacts/${f.page}/sql`,{method:'POST',headers:{origin:'null'}}),{body,duplex:'half'} as RequestInit);
 try{
  const answer=mode==='opaque'?POST(req,params(f.page)):ownerHostSqlRead(req,f.page,async()=>{await stalled;return true;});
  await vi.waitFor(()=>expect(timers.count()).toBe(1), { timeout: WAIT_MS });
  timers.expire();
  expect((await answer).status).toBe(404);
 }finally{release();stream.close();timers.restore();}
});

it('expires stalled actor admission without continuing into SQL',async()=>{
 const f=await fixture();let release!:()=>void;
 const stalled=new Promise<void>(resolve=>{release=resolve;});
 let actorAsked!:()=>void,actorReturned!:()=>void;
 const asked=new Promise<void>(resolve=>{actorAsked=resolve;}),returned=new Promise<void>(resolve=>{actorReturned=resolve;});
 const original=authentication.requestOrSessionActor;
 const actorSpy=vi.spyOn(authentication,'requestOrSessionActor').mockImplementation(async req=>{actorAsked();await stalled;try{return await original(req);}finally{actorReturned();}});
 const timers=heldTimers(ADMISSION);
 const engine=services().sql,mutate=vi.spyOn(engine,'mutate');
 try{
  const answer=POST(request(`/api/artifacts/${f.page}/sql`,{method:'POST',token:f.owner.token,json:{revision:'1',sql:"insert into staff(name) values ('late actor')"}}),params(f.page));
  await asked;timers.expire();
  expect((await answer).status).toBe(404);
  // The late actor arrives after the refusal: nothing chained on it may reach SQL.
  release();await returned;await new Promise(resolve=>setImmediate(resolve));
  expect(mutate).not.toHaveBeenCalled();
  expect((await stored(f.staff)).some(row=>row.name==='late actor')).toBe(false);
 }finally{release();actorSpy.mockRestore();mutate.mockRestore();timers.restore();}
});

it('includes the final owner-host fence in the read lifetime',async()=>{
 const f=await fixture();
 // The read lifetime (what is left of SQL_READ_WALL_TIMEOUT_MS once dispatched) runs out during the third fence.
 const timers=heldTimers(ms=>ms>40000&&ms<=45000);
 let checks=0;
 try{
  const response=await ownerHostSqlRead(request(`/api/artifacts/${f.page}/sql`,{method:'POST',json:{revision:'1',sql:'select name from staff'}}),f.page,async()=>{if(++checks===3){expect(timers.count()).toBe(1);timers.expire();await new Promise(()=>{});}return true;});
  expect(checks).toBe(3);expect(response.status).toBe(404);
 }finally{timers.restore();}
});

it('bounds linked metadata admission and cannot dispatch after its late completion',async()=>{
 const f=await fixture(),db=await getDb(),query=db.query.bind(db);
 let release!:()=>void,blocked=0,metadataAsked!:()=>void,metadataAnswered!:()=>void;
 const stalled=new Promise<void>(resolve=>{release=resolve;});
 const asked=new Promise<void>(resolve=>{metadataAsked=resolve;}),answered=new Promise<void>(resolve=>{metadataAnswered=resolve;});
 const dbSpy=vi.spyOn(db,'query').mockImplementation((async(text:string,values?:unknown[])=>{if(values?.includes(f.staff)&&/^\s*select/i.test(text)){blocked++;metadataAsked();await stalled;try{return await query(text,values);}finally{metadataAnswered();}}return query(text,values);}) as typeof db.query);
 const timers=heldTimers(ADMISSION);
 const engine=services().sql,mutate=vi.spyOn(engine,'mutate');
 try{
  const answer=POST(request(`/api/artifacts/${f.page}/sql`,{method:'POST',token:f.owner.token,json:{revision:'1',sql:"insert into staff(name) values ('late metadata')"}}),params(f.page));
  await asked;timers.expire();
  const response=await answer;
  expect(blocked).toBeGreaterThan(0);expect(response.status).toBe(404);
  release();await answered;await new Promise(resolve=>setImmediate(resolve));
  expect(mutate).not.toHaveBeenCalled();
  expect((await stored(f.staff)).some(row=>row.name==='late metadata')).toBe(false);
 }finally{release();dbSpy.mockRestore();mutate.mockRestore();timers.restore();}
});
it('answers a dispatched read that runs out of time while it runs as timeout, with the reader\'s sentence',async()=>{
 const f=await fixture(),engine=services().sql,run=engine.run.bind(engine);
 // The read lifetime (SQL_READ_WALL_TIMEOUT_MS) runs out while the engine answers the read.
 const timers=heldTimers(ms=>ms>40000&&ms<=45000);
 const spy=vi.spyOn(engine,'run').mockImplementation(async(input,context)=>{timers.expire();return run(input,context);});
 try{
  const reply=await POST(request(`/api/artifacts/${f.page}/sql`,{method:'POST',token:f.owner.token,json:{revision:'1',sql:'select name from staff'}}),params(f.page));
  expect(spy).toHaveBeenCalled();
  expect([reply.status,await reply.json()]).toEqual([408,{error:'timeout',message:expect.any(String),notice:SQL_FAILURES.timeout.notice}]);
 }finally{spy.mockRestore();timers.restore();}
});
