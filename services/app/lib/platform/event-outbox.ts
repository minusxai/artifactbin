/** Source-side durability. The caller's transaction owns the action and envelope. */
import type {EventEnvelope,EventPayload,EventVerb,ObjectKind,Queryable} from '@artifactbin/contracts';
import type {Db} from './db';
import {envelope,type EventObject,type EventSubject} from './events';
import {services} from './services';

/** What a recorded fact derives inside the source's transaction (lib/notifications' inbox rows). */
export type EventProjection=(tx:Queryable,event:EventEnvelope)=>Promise<void>;
declare global {
 // eslint-disable-next-line no-var
 var __artifact_bin_event_projection__:EventProjection|undefined;
}
/**
 * The composition root (server/app createAppServer, test/setup/vitest.setup) registers the projection once per
 * process: source modules (accounts, artifacts, annotations) record facts here and never import their consumers.
 * On globalThis, like `services()`, so a module reload in a test cannot silently drop it.
 */
export function setEventProjection(projection:EventProjection):void{globalThis.__artifact_bin_event_projection__=projection;}
/** Fact, derived state and outgoing envelope commit with the source action. Refuses to drop a fact's projection. */
export async function recordEvent<K extends ObjectKind,V extends EventVerb<K>>(
 tx:Queryable,subject:EventSubject|null,verb:V,object:EventObject<K>,payload:EventPayload<K,V>,
):Promise<void>{
 const project=globalThis.__artifact_bin_event_projection__;
 if(!project)throw Error('event_projection_unregistered');
 const event=envelope(subject,verb,object,payload);
 await enqueueEvent(tx,event);
 await project(tx,event);
}
export async function enqueueEvent(tx:Queryable,event:EventEnvelope):Promise<void>{
 await tx.query('INSERT INTO event_outbox(id,envelope) VALUES($1,$2::jsonb) ON CONFLICT DO NOTHING',[event.id,JSON.stringify(event)]);
}
/** Many envelopes in one statement, in order; the same rows `enqueueEvent` writes one at a time. */
export async function enqueueEvents(tx:Queryable,events:readonly EventEnvelope[]):Promise<void>{
 if(events.length)await tx.query("INSERT INTO event_outbox(id,envelope) SELECT e->>'id',e FROM jsonb_array_elements($1::jsonb) WITH ORDINALITY AS t(e,n) ORDER BY n ON CONFLICT DO NOTHING",[JSON.stringify(events)]);
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
