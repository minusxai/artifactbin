/** Process compositions share this lifecycle; creating a request handler never starts workers. */
import {type Db, startEventPublisher} from '@/lib/platform';
import { flushViews } from '../analytics';
import {startGroupMailDelivery} from '@/lib/notifications';
import {startFunctionSchedules} from '@/lib/function-schedules';
export async function startAppBackgroundTasks(db:Db):Promise<()=>Promise<void>>{
 const stopGroupMail=startGroupMailDelivery(db);
 const stopPublisher=startEventPublisher(db);
 const stopSchedules=startFunctionSchedules({db:async()=>db});
 let closing:Promise<void>|undefined;
 // Buffered views (lib/analytics recordView) are written before the publisher drains the outbox.
 return ()=>closing??=(async()=>{try{await Promise.all([stopGroupMail(),stopSchedules()]);}finally{await flushViews();await stopPublisher();}})();
}
