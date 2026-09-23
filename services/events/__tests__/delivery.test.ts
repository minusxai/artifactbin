import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {afterAll, expect, it} from 'vitest';
import {createEvents} from '../src/local';
import type {EventEnvelope, Queryable} from '@artifactbin/contracts';
const pg = new PGlite();
const db: Queryable = {query: async <T>(sql:string, params:unknown[]=[]) => ({rows:(await pg.query<T>(sql,params)).rows})};
afterAll(()=>pg.close());
const event=():EventEnvelope=>({id:randomUUID(),at:new Date().toISOString(),source:'app',subject_kind:'user',subject_id:'alice',object_kind:'artifact',object_id:'doc',verb:'liked',payload:{}});
it('retries durable subscribers after restart without replaying successful delivery',async()=>{
 let fail=true; const seen:string[]=[];
 const subscriber={id:'mail',deliver:async(batch:EventEnvelope[])=>{if(fail)throw Error('offline');seen.push(...batch.map(e=>e.id));}};
 const first=createEvents({db,schema:'delivery_test',subscribers:[subscriber]});
 const e=event(); await first.publish([e]); await first.drain(); expect(seen).toEqual([]);
 fail=false;
 await db.query("UPDATE delivery_test.deliveries SET available_at=now()");
 const restarted=createEvents({db,schema:'delivery_test',subscribers:[subscriber]});
 await restarted.drain(); await restarted.publish([e]); await restarted.drain();
 expect(seen).toEqual([e.id]);
});
it('does not silently acknowledge a failed durable write',async()=>{
 const broken=createEvents({db:{query:async()=>{throw Error('db offline');}}});
 await expect(broken.publish([event()])).rejects.toThrow('db offline');
});
it('does not backfill a newly configured subscriber',async()=>{
 const old=event(); await createEvents({db,schema:'no_backfill'}).publish([old]);
 const seen:string[]=[];const next=createEvents({db,schema:'no_backfill',subscribers:[{id:'new',deliver:async batch=>{seen.push(...batch.map(e=>e.id));}}]});
 await next.publish([old]); await next.drain(); expect(seen).toEqual([]);
});
