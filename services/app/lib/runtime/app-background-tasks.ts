/** Process compositions share this lifecycle; creating a request handler never starts workers. */
import {type Db, startEventPublisher} from '@/lib/platform';
import { flushViews } from '../analytics';
import {startGroupMailDelivery} from '@/lib/notifications';
export async function startAppBackgroundTasks(db:Db):Promise<()=>Promise<void>>{
 const stopGroupMail=startGroupMailDelivery(db);
 const stopPublisher=startEventPublisher(db);
 let closing:Promise<void>|undefined;
 // Buffered views (lib/analytics recordView) are written before the publisher drains the outbox.
 return ()=>closing??=(async()=>{try{await stopGroupMail();}finally{await flushViews();await stopPublisher();}})();
}
