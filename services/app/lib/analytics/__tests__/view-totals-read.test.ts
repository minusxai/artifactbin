/** Reading view totals never writes; folds run where views are written, or in the background after a read. */
import {afterAll,beforeEach,expect,it} from 'vitest';
import {createEvents,ensureEventsSchema} from '@artifactbin/events/local';
import {EVENTS_SCHEMA,envelope,services,setServices,type Db} from '@/lib/platform';
import {useAppHarness} from '@/__tests__/harness';
import * as totals from '../view-totals';
import {flushViews,recordView} from '..';

const harness=useAppHarness();
const previous=services().events;
beforeEach(async()=>{
 const db=await harness.db();
 await ensureEventsSchema(db,EVENTS_SCHEMA);
 setServices({events:createEvents({db,schema:EVENTS_SCHEMA})});
});
afterAll(()=>setServices({events:previous}));
const settle=()=>{
 const seam=(totals as unknown as {settleViewTotals?:()=>Promise<void>}).settleViewTotals;
 expect(seam,'view-totals exports settleViewTotals for tests and shutdown').toBeTypeOf('function');
 return seam!();
};
/** A view appended through the events service alone: ingestion no fold followed. */
const view=async(_db:Db,n:number,visitor:string,artifact='seen')=>services().events.emit([{...envelope({kind:'visitor',id:visitor},'viewed',{kind:'artifact',id:artifact},{}),id:'view'+n,at:'2026-01-01T00:00:00Z'}]);
/** The handle, with every transaction counted while `reading` and every fold's admitted ids recorded. */
const spy=(db:Db)=>{
 const seen={reading:true,during:0,folded:[] as string[][]};
 const handle:Pick<Db,'query'|'transaction'>={query:db.query.bind(db),transaction:(work=>{
  if(seen.reading)seen.during++;
  return db.transaction(tx=>work({query:(async(sql:string,args?:unknown[])=>{
   if(sql.includes('INSERT INTO canonical_view_totals AS c'))seen.folded.push([...(args![1] as string[])]);
   return tx.query(sql,args);
  }) as typeof tx.query}));
 }) as typeof db.transaction};
 return {seen,handle};
};

it('reads stored view totals without opening a transaction, and folds pending views afterwards',async()=>{
 const db=await harness.db();
 await view(db,1,'a');
 const {seen,handle}=spy(db);
 const first=await totals.canonicalViewTotals(handle,['seen','quiet']);
 seen.reading=false;
 expect(seen.during).toBe(0);
 expect(Object.fromEntries(first)).toEqual({seen:0,quiet:0});
 await settle();
 seen.reading=true;
 expect(Object.fromEntries(await totals.canonicalViewTotals(handle,['seen','quiet']))).toEqual({seen:1,quiet:0});
 seen.reading=false;
 expect(seen.during).toBe(0);
 await settle();
});

it('folds only the ids a read found pending, and the stored totals then include the new unique visitors',async()=>{
 const db=await harness.db();
 await view(db,1,'a','seen');
 await view(db,2,'a','steady');
 const {seen,handle}=spy(db);
 seen.reading=false;
 await totals.canonicalViewTotals(handle,['seen','steady']);
 await settle();
 seen.folded.length=0;
 await view(db,3,'b','seen');
 await view(db,4,'a','seen');
 seen.reading=true;
 expect(Object.fromEntries(await totals.canonicalViewTotals(handle,['steady','seen']))).toEqual({seen:1,steady:1});
 seen.reading=false;
 expect(seen.during).toBe(0);
 await settle();
 expect(seen.folded).toEqual([['seen']]);
 const stored=await db.query<{artifact_id:string;views:string}>(`SELECT artifact_id,views::text AS views FROM canonical_view_totals ORDER BY artifact_id`);
 expect(stored.rows).toEqual([{artifact_id:'seen',views:'2'},{artifact_id:'steady',views:'1'}]);
});

it('folds recorded views when they are flushed, without any read',async()=>{
 const db=await harness.db();
 const pending=[recordView('flushed'),recordView('flushed'),recordView('other')];
 await new Promise<void>(resolve=>setImmediate(resolve));
 await flushViews();
 await Promise.all(pending);
 // Off-request views have no visitor hash: each counts separately.
 const stored=await db.query<{artifact_id:string;views:string}>(`SELECT artifact_id,views::text AS views FROM canonical_view_totals ORDER BY artifact_id`);
 expect(stored.rows).toEqual([{artifact_id:'flushed',views:'2'},{artifact_id:'other',views:'1'}]);
});

it('drains a flush already in flight: flushing again and settling waits for its append and its fold',async()=>{
 const db=await harness.db();
 const store=services().events;
 let release!:()=>void;
 const held=new Promise<void>(resolve=>{release=resolve;});
 setServices({events:{emit:async events=>{await held;return store.emit(events);}}});
 const pending=recordView('inflight');
 await new Promise<void>(resolve=>setImmediate(resolve));
 const first=flushViews();
 let drained=false;
 const drain=flushViews().then(settle).then(()=>{drained=true;});
 for(let turn=0;turn<5;turn++)await new Promise<void>(resolve=>setImmediate(resolve));
 expect(drained,'a reset after flush and settle would run before the held append').toBe(false);
 release();
 await Promise.all([first,drain,pending]);
 const stored=await db.query<{artifact_id:string;views:string}>(`SELECT artifact_id,views::text AS views FROM canonical_view_totals`);
 expect(stored.rows).toEqual([{artifact_id:'inflight',views:'1'}]);
});
