/** Source-side durability. The caller's transaction owns the action and envelope. */
import type {EventEnvelope} from '@artifactbin/contracts';
import type {Queryable} from '@artifactbin/contracts';
import type {Db} from './db';
import {services} from './services';
export async function enqueueEvent(tx:Queryable,event:EventEnvelope):Promise<void>{
 await tx.query('INSERT INTO event_outbox(id,envelope) VALUES($1,$2::jsonb) ON CONFLICT DO NOTHING',[event.id,JSON.stringify(event)]);
}
export function startEventPublisher(db:Db):()=>Promise<void>{
 let pending:Promise<void>|null=null;
 const flush=async()=>{
  const publish=services().events.publish;if(!publish)return;
  const rows=(await db.query<{id:string;envelope:EventEnvelope}>('SELECT id,envelope FROM event_outbox ORDER BY created_at,id LIMIT 50')).rows;
  if(!rows.length)return;
  await publish(rows.map(r=>r.envelope));
  await db.query('DELETE FROM event_outbox WHERE id=ANY($1::text[])',[rows.map(r=>r.id)]);
 };
 const tick=()=>pending??=flush().catch(()=>{/* Rows remain for retry, including after restart. */}).finally(()=>{pending=null;});
 const timer=setInterval(()=>void tick(),1000);timer.unref();void tick();
 return async()=>{clearInterval(timer);await pending;await tick();};
}
