import {expect,it} from 'vitest';
import {ensureEventsSchema} from '@artifactbin/events/local';
import {EVENTS_SCHEMA} from '@/lib/platform';
import {useAppHarness} from '@/__tests__/harness';
import * as totals from '../view-totals';

const harness=useAppHarness();
it('reads stored view totals without opening a transaction, and folds pending views afterwards',async()=>{
 const db=await harness.db();
 await ensureEventsSchema(db,EVENTS_SCHEMA);
 const view=(n:number,visitor:string)=>db.query(`INSERT INTO ${EVENTS_SCHEMA}.events (id,at,source,verb,object_kind,object_id,subject_kind,subject_id)
  VALUES ($1,'2026-01-01'::timestamptz,'app','viewed','artifact','seen','visitor',$2)`,['view'+n,visitor]);
 await view(1,'a');
 let during=0,reading=true;
 const spied={query:db.query.bind(db),transaction:((work:never)=>{if(reading)during++;return db.transaction(work);}) as typeof db.transaction};
 const first=await totals.canonicalViewTotals(spied,['seen','quiet']);
 reading=false;
 expect(during).toBe(0);
 expect(first.get('quiet')).toBe(0);
 const settle=(totals as unknown as {settleViewTotals?:()=>Promise<void>}).settleViewTotals;
 expect(settle,'view-totals exports settleViewTotals for tests and shutdown').toBeTypeOf('function');
 await settle!();
 reading=true;
 expect((await totals.canonicalViewTotals(spied,['seen','quiet'])).get('seen')).toBe(1);
 expect(during).toBe(0);
 reading=false;await settle!();
});
