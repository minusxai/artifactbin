/** Process compositions share this lifecycle; creating a request handler never starts workers. */
import type {Db} from '@/lib/platform';
import {startEventPublisher} from '../platform/event-outbox';
import {flushViews} from '../platform/analytics';
import {createNotificationJobStore,createNotificationWorker,notificationAuthority} from '@/lib/notifications';
import { evaluateNotificationQuery } from '@/lib/document-data';
export async function startAppBackgroundTasks(db:Db):Promise<()=>Promise<void>>{
 const stopPublisher=startEventPublisher(db);
 const worker=createNotificationWorker({store:createNotificationJobStore({db,authority:notificationAuthority}),evaluator:{evaluate:evaluateNotificationQuery}});
 worker.start();
 let closing:Promise<void>|undefined;
 // Buffered views (lib/platform/analytics recordView) are written before the publisher drains the outbox.
 return ()=>closing??=(async()=>{try{await worker.stop();}finally{await flushViews();await stopPublisher();}})();
}
