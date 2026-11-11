/** Process compositions share this lifecycle; creating a request handler never starts workers. */
import {type Db, pageSchedulesEnabled, startEventPublisher} from '@/lib/platform';
import { flushViews } from '../analytics';
import {startGroupMailDelivery} from '@/lib/notifications';
import {startFunctionSchedules} from '@/lib/function-schedules';
export async function startAppBackgroundTasks(db:Db):Promise<()=>Promise<void>>{
 const stopGroupMail=startGroupMailDelivery(db);
 const stopPublisher=startEventPublisher(db);
 // SCHEDULES__PAGE_SCHEDULES=off: the page-function scheduler never starts here; the outbox, mail and on-demand
 // functions are unaffected.
 const stopSchedules=pageSchedulesEnabled()?startFunctionSchedules({db:async()=>db}):async()=>{};
 let closing:Promise<void>|undefined;
 // Buffered views (lib/analytics recordView) are written before the publisher drains the outbox.
 return ()=>closing??=(async()=>{try{await Promise.all([stopGroupMail(),stopSchedules()]);}finally{await flushViews();await stopPublisher();}})();
}
