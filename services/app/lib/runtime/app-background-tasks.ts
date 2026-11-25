/** Process compositions share this lifecycle; creating a request handler never starts workers. */
import {type Db, startEventPublisher} from '@/lib/platform';
import {projectHostTenancyChanges} from '@/lib/groups';
import { flushViews, settleViewTotals } from '../analytics';
import {startGroupMailDelivery} from '@/lib/notifications';
import {objectStore, sweepObjects} from '@/lib/object-store';
import {expireExportImages} from '@/lib/export';
import { sweepExpiredPagesTickets } from '@/lib/accounts';

/** How often stored objects nothing references are swept and old export images expired (each run is bounded). */
const STORAGE_SWEEP_MS=6*60*60*1000;
/** One step's failure is logged (a delete S3 refuses, a reference scan that failed) and never skips the other. */
const logged=(step:string)=>(error:unknown)=>{console.error(`[storage sweep] ${step} failed:`,error);};
/** The storage sweep: lib/object-store sweepObjects, then lib/export expireExportImages, one run at a time. */
function startStorageSweep(db:Db):()=>Promise<void>{
 let pending:Promise<void>|null=null;
 const tick=()=>pending??=(async()=>{
  await sweepObjects(db,objectStore()).catch(logged('object sweep'));
  await expireExportImages(db).catch(logged('export image expiry'));
 })().finally(()=>{pending=null;});
 const timer=setInterval(()=>void tick(),STORAGE_SWEEP_MS);timer.unref();
 return async()=>{clearInterval(timer);await pending;};
}
function startPagesTicketSweep(db: Db): () => Promise<void> {
 let pending: Promise<void> | null = null;
 const timer = setInterval(() => {
  pending ??= sweepExpiredPagesTickets(db).catch(error => {
   console.error('[pages ticket sweep] failed:', error);
  }).finally(() => { pending = null; });
 }, 60_000);
 timer.unref();
 return async () => { clearInterval(timer); await pending; };
}
export async function startAppBackgroundTasks(db:Db):Promise<()=>Promise<void>>{
 let auditPending: Promise<void> | undefined;
 const auditTick = () => auditPending ??= projectHostTenancyChanges(db)
   .catch(() => { console.error('[group audit] host tenancy projection failed, will retry'); })
   .finally(() => { auditPending = undefined; });
 const auditTimer = setInterval(auditTick, 1000);
 auditTimer.unref();
 void auditTick();
 const stopGroupMail=startGroupMailDelivery(db);
 const stopPublisher=startEventPublisher(db);
 const stopStorageSweep=startStorageSweep(db);
 const stopPagesTicketSweep=startPagesTicketSweep(db);
 let closing:Promise<void>|undefined;
 // Buffered views (lib/analytics recordView) are written and every view-total fold settles before the publisher drains the outbox.
 return () => closing ??= (async () => {
  clearInterval(auditTimer);
  try { await Promise.all([auditPending,stopGroupMail(),stopStorageSweep(),stopPagesTicketSweep()]); }
  finally { await flushViews(); await settleViewTotals(); await stopPublisher(); }
 })();
}
