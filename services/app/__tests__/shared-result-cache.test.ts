import { expect, it } from 'vitest';
import { useAppHarness } from './harness';
import { getDb, type Db } from '@/lib/db';
import { createDatasetResultCache } from '@/lib/datasets/result-cache';
import type { CatalogResult } from '@/lib/datasets/execute';
useAppHarness();
const result=(n:number):CatalogResult=>({rows:[{n}],columns:[{name:'n',type:'number'}],refreshedAt:new Date().toISOString()});
const cacheRequest={ttlSeconds:60,authorize:async()=>{}};
const deferred=<T,>()=>{let resolve!:(v:T)=>void;const promise=new Promise<T>(r=>{resolve=r;});return {promise,resolve};};
it('refresh fences an older owner and makes its caller adopt the newer result',async()=>{
  const db=await getDb(),a=createDatasetResultCache(db),b=createDatasetResultCache(db),old=deferred<CatalogResult>(),started=deferred<void>();
  const pending=a.run('key',()=>{started.resolve();return old.promise;},cacheRequest);await started.promise;
  const fresh=await b.run('key',async()=>result(2),{...cacheRequest,refresh:true});old.resolve(result(1));
  expect(await pending).toEqual(fresh);
  expect(await a.run('key',async()=>result(3),cacheRequest)).toEqual(fresh);
});
it('an expired owner cannot publish after eviction and recreation (ABA)',async()=>{
  const db=await getDb(),cache=createDatasetResultCache(db),old=deferred<CatalogResult>(),started=deferred<void>();
  const pending=cache.run('key',()=>{started.resolve();return old.promise;},cacheRequest);await started.promise;
  await db.query("UPDATE dataset_result_cache SET lease_until=now()-interval '1 second' WHERE cache_key='key'");
  const fresh=await cache.run('key',async()=>result(2),cacheRequest);old.resolve(result(1));
  expect(await pending).toEqual(fresh);
});
// The other way an entry goes stale under an owner: the ROW is gone, not merely its
// lease. Moved here from result-cache.test.ts, which tested this module twice over.
it('a lease token cannot be revived once its row is evicted and recreated',async()=>{
  const db=await getDb(),cache=createDatasetResultCache(db),old=deferred<CatalogResult>(),started=deferred<void>();
  const pending=cache.run('key',()=>{started.resolve();return old.promise;},cacheRequest);await started.promise;
  await db.query('DELETE FROM dataset_result_cache WHERE cache_key=$1',['key']);
  await cache.run('key',async()=>result(2),cacheRequest);old.resolve(result(1));await pending;
  expect((await cache.run('key',async()=>result(3),cacheRequest)).rows).toEqual([{n:2}]);
});
it('bounds aggregate concurrent fills and outstanding leases',async()=>{
  const db=await getDb(),cache=createDatasetResultCache(db,{maxEntries:2,maxBytes:300}),release=deferred<void>(),started=deferred<void>();let starts=0;
  const work=Array.from({length:5},(_,i)=>cache.run(String(i),async()=>{if(++starts===5)started.resolve();await release.promise;return result(i);},cacheRequest));
  await started.promise;
  expect(Number((await db.query<{n:string}>('SELECT count(*) AS n FROM dataset_result_cache')).rows[0].n)).toBeLessThanOrEqual(2);
  release.resolve();await Promise.all(work);
  const sums=(await db.query<{n:string,b:string}>('SELECT count(*) AS n,COALESCE(sum(bytes),0) AS b FROM dataset_result_cache')).rows[0];
  expect(Number(sums.n)).toBeLessThanOrEqual(2);expect(Number(sums.b)).toBeLessThanOrEqual(300);
});
it('does not retain oversized results',async()=>{
  const db=await getDb(),cache=createDatasetResultCache(db,{maxBytes:10});let calls=0;
  for(let i=0;i<2;i++)await cache.run('huge',async()=>result(++calls),cacheRequest);
  expect(calls).toBe(2);expect((await db.query('SELECT * FROM dataset_result_cache')).rows).toHaveLength(0);
});
it('fails open only for cache faults, never authorization or query faults',async()=>{
  const real=await getDb(),db:Db={...real,query:real.query.bind(real),transaction:async()=>{throw new Error('cache outage');},listen:real.listen.bind(real),close:async()=>{},raw:real.raw.bind(real)};
  const cache=createDatasetResultCache(db);expect((await cache.run('key',async()=>result(3),cacheRequest)).rows).toEqual([{n:3}]);
  await expect(cache.run('key',async()=>result(3),{...cacheRequest,authorize:async()=>{throw new Error('revoked');}})).rejects.toThrow('revoked');
  await expect(cache.run('key',async()=>{throw new Error('query failed');},cacheRequest)).rejects.toThrow('query failed');
});
it('rechecks authorization after waiting and before publication',async()=>{
  const db=await getDb(),cache=createDatasetResultCache(db),release=deferred<CatalogResult>(),started=deferred<void>();let allowed=true;
  const owner=cache.run('key',()=>{started.resolve();return release.promise;},cacheRequest);await started.promise;
  const waiter=cache.run('key',async()=>result(4),{...cacheRequest,authorize:async()=>{if(!allowed)throw new Error('revoked');}});
  const rejected=expect(waiter).rejects.toThrow('revoked');allowed=false;release.resolve(result(1));await owner;await rejected;
  let checks=0;
  await expect(cache.run('other',async()=>result(9),{...cacheRequest,authorize:async()=>{if(++checks>1)throw new Error('revoked');}})).rejects.toThrow('revoked');
});
it('cancels owner work without retaining or poisoning its lease',async()=>{
  const db=await getDb(),cache=createDatasetResultCache(db),controller=new AbortController(),started=deferred<void>(),release=deferred<CatalogResult>();
  const pending=cache.run('key',()=>{started.resolve();return release.promise;},{...cacheRequest,signal:controller.signal});await started.promise;
  controller.abort();await expect(pending).rejects.toMatchObject({name:'AbortError'});release.resolve(result(1));
  expect((await cache.run('key',async()=>result(2),cacheRequest)).rows).toEqual([{n:2}]);
});
