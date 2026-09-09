import {expect,it} from 'vitest';
import {useAppHarness} from './harness';
import {getDb,type Db} from '@/lib/db';
import {createDatasetResultCache} from '@/lib/datasets/result-cache';
import type {CatalogResult} from '@/lib/datasets/execute';
useAppHarness();
const result=(n:number):CatalogResult=>({rows:[{n}],columns:[{name:'n',type:'number'}],refreshedAt:new Date().toISOString()});
const cacheRequest={ttlSeconds:60,authorize:async()=>{}};
function hold<T>() {let resolve!:(v:T)=>void;const promise=new Promise<T>(r=>resolve=r);return {promise,resolve};}
it('refresh fences an older fill and its later completion cannot replace fresh rows',async()=>{
 const db=await getDb(),cache=createDatasetResultCache(db),gate=hold<CatalogResult>(),started=hold<void>();
 const old=cache.run('k',()=>{started.resolve();return gate.promise;},cacheRequest);await started.promise;
 await cache.run('k',async()=>result(2),{...cacheRequest,refresh:true});gate.resolve(result(1));await old;
 expect((await cache.run('k',async()=>result(3),cacheRequest)).rows).toEqual([{n:2}]);
});
it('eviction and recreation cannot revive a previous lease token',async()=>{
 const db=await getDb(),cache=createDatasetResultCache(db),gate=hold<CatalogResult>(),started=hold<void>();
 const old=cache.run('k',()=>{started.resolve();return gate.promise;},cacheRequest);await started.promise;
 await db.query('DELETE FROM dataset_result_cache WHERE cache_key=$1',['k']);
 await cache.run('k',async()=>result(2),cacheRequest);gate.resolve(result(1));await old;
 expect((await cache.run('k',async()=>result(3),cacheRequest)).rows).toEqual([{n:2}]);
});
it('expired owners cannot publish and completed entries obey aggregate bounds',async()=>{
 const db=await getDb(),cache=createDatasetResultCache(db,{maxBytes:600,maxEntries:2}),gate=hold<CatalogResult>(),started=hold<void>();
 const old=cache.run('expired',()=>{started.resolve();return gate.promise;},cacheRequest);await started.promise;
 await db.query("UPDATE dataset_result_cache SET lease_until=now()-interval '1 second'");
 await cache.run('expired',async()=>result(2),cacheRequest);gate.resolve(result(1));await old;
 await Promise.all(Array.from({length:8},(_,i)=>cache.run('key'+i,async()=>result(i),cacheRequest)));
 const stats=(await db.query<{n:number;bytes:number}>('SELECT count(*)::int n,coalesce(sum(bytes),0)::int bytes FROM dataset_result_cache')).rows[0];
 expect(stats.n).toBeLessThanOrEqual(2);expect(stats.bytes).toBeLessThanOrEqual(600);
});
it('oversized rows and cache outages fall back without swallowing authorization',async()=>{
 const db=await getDb(),cache=createDatasetResultCache(db,{maxBytes:1});let calls=0;
 await cache.run('big',async()=>result(++calls),cacheRequest);await cache.run('big',async()=>result(++calls),cacheRequest);expect(calls).toBe(2);
 const broken={...db,transaction:async()=>{throw new Error('offline');}} as Db;
 expect((await createDatasetResultCache(broken).run('offline',async()=>result(3),cacheRequest)).rows).toEqual([{n:3}]);
 await expect(createDatasetResultCache(broken).run('offline',async()=>result(3),{...cacheRequest,authorize:async()=>{throw new Error('revoked');}})).rejects.toThrow('revoked');
});
it('waiters recheck authorization and can cancel without cancelling the owner',async()=>{
 const db=await getDb(),cache=createDatasetResultCache(db),gate=hold<CatalogResult>(),started=hold<void>();
 const owner=cache.run('k',()=>{started.resolve();return gate.promise;},cacheRequest);await started.promise;
 const controller=new AbortController();const waiter=cache.run('k',async()=>result(3),{...cacheRequest,signal:controller.signal});controller.abort();
 await expect(waiter).rejects.toThrow();
 let checks=0;await expect(cache.run('k',async()=>result(4),{...cacheRequest,authorize:async()=>{if(++checks>1)throw new Error('revoked');}})).rejects.toThrow('revoked');
 gate.resolve(result(1));await owner;expect((await cache.run('k',async()=>result(5),cacheRequest)).rows).toEqual([{n:1}]);
});
