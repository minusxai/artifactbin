import {describe,it,expect} from 'vitest';
import {useAppHarness} from './harness';
import {getDb} from '@/lib/db';
import {createExportCache,type ExportProducer} from '@/lib/export/cache';

useAppHarness();
const request={cacheKey:'full:test',artifactId:'abc123',revision:'r1'};
const image={object_key:'exports/objects/one',mime:'image/png' as const,bytes:7,width:100,height:80};
const options={leaseMs:1000,waitMs:500,pollMs:[1,2],retryMs:100};
function gate(){let resolve!:()=>void;const promise=new Promise<void>(r=>{resolve=r;});return {promise,resolve};}

describe('shared export refresh leases',()=>{
 it('combines cold requests across independent app instances without holding a transaction',async()=>{
  const db=await getDb(),a=createExportCache(db,options),b=createExportCache(db,options);
  const entered=gate(),release=gate();let calls=0;
  const produce:ExportProducer=async()=>{calls++;entered.resolve();await release.promise;return image;};
  const first=a.read(request,produce);void first.catch(()=>{});await Promise.race([entered.promise,first]);
  const second=b.read(request,produce);
  // This query must complete while image generation is blocked.
  expect((await db.query('SELECT 1 AS n')).rows[0].n).toBe(1);
  release.resolve();
  const [one,two]=await Promise.all([first,second]);expect(one.id).toBe(two.id);expect(calls).toBe(1);
 });
 it('serves stale immediately while one owner refreshes, then shares the replacement',async()=>{
  const db=await getDb(),a=createExportCache(db,options),b=createExportCache(db,options);
  const old=await a.read(request,async()=>image);
  await db.query("UPDATE export_image_cache SET expires_at=clock_timestamp()-interval '1 second'");
  const release=gate();let calls=0;
  const produce:ExportProducer=async()=>{calls++;await release.promise;return {...image,object_key:'exports/objects/new'};};
  expect((await a.read(request,produce)).id).toBe(old.id);
  expect((await b.read(request,produce)).id).toBe(old.id);
  release.resolve();await a.drain();await b.drain();
  expect((await b.read(request,produce)).object_key).toBe('exports/objects/new');expect(calls).toBe(1);
 });
 it('retains a successful image after failure and backs off subsequent refreshes',async()=>{
  const db=await getDb(),cache=createExportCache(db,options);
  const old=await cache.read(request,async()=>image);let calls=0;
  const fail:ExportProducer=async()=>{calls++;throw new Error('render timed out');};
  const changed={...request,revision:'r2'};
  expect((await cache.read(changed,fail)).id).toBe(old.id);await cache.drain();
  expect((await cache.read(changed,fail)).id).toBe(old.id);expect(calls).toBe(1);
 });
 it('fences a slow worker after lease recovery so it cannot overwrite the winner',async()=>{
  const db=await getDb(),a=createExportCache(db,options),b=createExportCache(db,options);
  const release=gate(),entered=gate();
  const first=a.read(request,async()=>{entered.resolve();await release.promise;return image;});void first.catch(()=>{});await Promise.race([entered.promise,first]);
  await db.query("UPDATE export_image_cache SET lease_until=clock_timestamp()-interval '1 second'");
  const winner=await b.read(request,async()=>({...image,object_key:'exports/objects/winner'}));
  release.resolve();expect((await first).id).toBe(winner.id);
  expect((await a.read(request,async()=>image)).id).toBe(winner.id);
 });
 it('an explicit refresh waits for a new result and concurrent refresh callers share it',async()=>{
  const db=await getDb(),a=createExportCache(db,options),b=createExportCache(db,options);
  const old=await a.read(request,async()=>image),entered=gate(),release=gate();let calls=0;
  const produce:ExportProducer=async()=>{calls++;entered.resolve();await release.promise;return image;};
  const first=a.read({...request,refresh:true},produce);await Promise.race([entered.promise,first]);
  const second=b.read({...request,refresh:true},produce);
  // Ensure both requests observed the old result before releasing the worker.
  await db.query('SELECT 1');await new Promise(r=>setTimeout(r,10));release.resolve();
  const [one,two]=await Promise.all([first,second]);expect(one.id).not.toBe(old.id);expect(one.id).toBe(two.id);expect(calls).toBe(1);
 });
});
