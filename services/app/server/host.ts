import {setNotificationDelivery,type NotificationDelivery} from '@/lib/notification-delivery';
export type {NotificationDelivery} from '@/lib/notification-delivery';
import {startEventPublisher} from '@/lib/event-outbox';
import {startDomainRecheck} from '@/lib/custom-domains';
import {setDocumentEditorPolicy,type DocumentEditorPolicy} from '@/lib/document-policy';
import {setMutationInvocation,type MutationInvocationFactory} from '@/lib/mutation-invocation';
import type {Actor,Upstream} from '@artifactbin/contracts';
import {getDb,type Db} from '@/lib/db';
import {inProcess} from '@artifactbin/utils';
import {setServices,services,type Services} from '@/lib/services';
import {createAppServer,type AppServerOptions} from './app';
export interface AppHostOptions extends AppServerOptions {
 services?:Partial<Services>;
 notificationDelivery?:NotificationDelivery;
 documentEditorPolicy?:DocumentEditorPolicy;
 mutationInvocation?:MutationInvocationFactory;
 shutdown?:()=>Promise<void>;
 initialize?:(db:Db)=>Promise<void>;
 identity?:(upstream:Upstream)=>{fetch:(request:Request)=>Promise<Response>};
}
export interface AppHost {
 fetch:(request:Request)=>Promise<Response>;
 close:()=>Promise<void>;
 request:(request:Request,actor:Actor)=>Promise<Response>;
}
/** Shared host composition; no local SQL/browser implementation or deployment identity is imported here. */
export async function createAppHost(options:AppHostOptions={}):Promise<AppHost>{
 setDocumentEditorPolicy(options.documentEditorPolicy);
 setNotificationDelivery(options.notificationDelivery);
 const db=await getDb();
 setMutationInvocation(options.mutationInvocation);
 if(options.services)setServices(options.services);
 await options.initialize?.(db);
 const stopPublisher=startEventPublisher(db);
 // Custom domains' daily TXT re-check: at boot, then every 24h, flag or no flag (lib/custom-domains).
 const stopRecheck=startDomainRecheck();
 const app=createAppServer(options),request=inProcess(app);
 const fetch=options.identity?.(request).fetch??((incoming:Request)=>Promise.resolve(app.fetch(incoming)));
 let closing:Promise<void>|undefined;
 return {fetch,request,close:()=>closing??=(async()=>{
  try{await stopRecheck();await stopPublisher();await services().events.close?.();await options.shutdown?.();}
  finally{await db.close();}
 })()};
}
