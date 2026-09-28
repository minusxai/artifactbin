/** Process compositions share this lifecycle; creating a request handler never starts workers. */
import type {Db} from './db';
import {startEventPublisher} from './event-outbox';
import {createNotificationWorker} from './notification-worker';
import {createNotificationJobStore} from './notification-jobs';
import {evaluateNotificationQuery,notificationAuthority} from './notification-query';
export async function startAppBackgroundTasks(db:Db):Promise<()=>Promise<void>>{
 const stopPublisher=startEventPublisher(db);
 const worker=createNotificationWorker({store:createNotificationJobStore({db,authority:notificationAuthority}),evaluator:{evaluate:evaluateNotificationQuery}});
 worker.start();
 let closing:Promise<void>|undefined;
 return ()=>closing??=(async()=>{try{await worker.stop();}finally{await stopPublisher();}})();
}
