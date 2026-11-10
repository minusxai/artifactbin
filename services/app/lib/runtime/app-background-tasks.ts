/** Process compositions share this lifecycle; creating a request handler never starts workers. */
import {type Db, schedulesOwner, startEventPublisher} from '@/lib/platform';
import { flushViews } from '../analytics';
import {startGroupMailDelivery} from '@/lib/notifications';
import {startFunctionSchedules} from '@/lib/function-schedules';
export async function startAppBackgroundTasks(db:Db):Promise<()=>Promise<void>>{
 const stopGroupMail=startGroupMailDelivery(db);
 const stopPublisher=startEventPublisher(db);
 // SCHEDULES__OWNER=minusx: MinusX owns recurring work, so the page-function scheduler never starts here; the
 // outbox, mail and on-demand functions are unaffected.
 const stopSchedules=schedulesOwner()==='minusx'?async()=>{}:startFunctionSchedules({db:async()=>db});
 let closing:Promise<void>|undefined;
 // Buffered views (lib/analytics recordView) are written before the publisher drains the outbox.
 return ()=>closing??=(async()=>{try{await Promise.all([stopGroupMail(),stopSchedules()]);}finally{await flushViews();await stopPublisher();}})();
}
