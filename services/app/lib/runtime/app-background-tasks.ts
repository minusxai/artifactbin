import {wakeManagedAgents} from '../remote/managed-wakeup';
import {services} from '../platform/services';
/** Process compositions share this lifecycle; creating a request handler never starts workers. */
import type {Db} from '@/lib/platform';
import {startEventPublisher} from '../platform/event-outbox';
import {createNotificationWorker} from '../notifications/worker';
import {createNotificationJobStore} from '../notifications/jobs';
import { evaluateNotificationQuery, notificationAuthority } from '@/lib/document-data';
export async function startAppBackgroundTasks(db:Db):Promise<()=>Promise<void>>{
 let waking:Promise<void>|undefined;
 const timer=setInterval(()=>{if(!waking)waking=wakeManagedAgents(db,services().runner).catch(()=>{}).finally(()=>{waking=undefined;});},1000);timer.unref();
 const stopPublisher=startEventPublisher(db);
 const worker=createNotificationWorker({store:createNotificationJobStore({db,authority:notificationAuthority}),evaluator:{evaluate:evaluateNotificationQuery}});
 worker.start();
 let closing:Promise<void>|undefined;
 return ()=>closing??=(async()=>{try{clearInterval(timer);await waking;await worker.stop();}finally{await stopPublisher();}})();
}
