/** Process compositions share this lifecycle; creating a request handler never starts workers. */
import {type Db, startEventPublisher} from '@/lib/platform';
import { flushViews } from '../analytics';
import {startGroupMailDelivery} from '@/lib/notifications';
import {objectStore, sweepObjects} from '@/lib/object-store';
import {expireExportImages} from '@/lib/export';

/** How often stored objects nothing references are swept and old export images expired (each run is bounded). */
const STORAGE_SWEEP_MS=6*60*60*1000;
/** The storage sweep: lib/object-store sweepObjects, then lib/export expireExportImages, one run at a time. */
function startStorageSweep(db:Db):()=>Promise<void>{
 let pending:Promise<void>|null=null;
 const tick=()=>pending??=(async()=>{await sweepObjects(db,objectStore());await expireExportImages(db);})()
  .catch(()=>{}).finally(()=>{pending=null;});
 const timer=setInterval(()=>void tick(),STORAGE_SWEEP_MS);timer.unref();
 return async()=>{clearInterval(timer);await pending;};
}
export async function startAppBackgroundTasks(db:Db):Promise<()=>Promise<void>>{
 const stopGroupMail=startGroupMailDelivery(db);
 const stopPublisher=startEventPublisher(db);
 const stopStorageSweep=startStorageSweep(db);
 let closing:Promise<void>|undefined;
 // Buffered views (lib/analytics recordView) are written before the publisher drains the outbox.
 return ()=>closing??=(async()=>{try{await stopGroupMail();await stopStorageSweep();}finally{await flushViews();await stopPublisher();}})();
}
