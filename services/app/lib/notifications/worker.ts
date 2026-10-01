import type {MutationNotificationEvaluator,MutationNotificationJobStore} from '@artifactbin/contracts';
import {NotificationExecutionError} from './errors';
export interface NotificationWorkerOptions {
 store:MutationNotificationJobStore;evaluator:MutationNotificationEvaluator;
 pollMs?:number;renewMs?:number;onError?:(code:string)=>void;
}
/** One bounded in-flight run per process. Durable claims coordinate multiple hosts. */
export function createNotificationWorker(options:NotificationWorkerOptions){
 const {store,evaluator}=options;
 let pending:Promise<boolean>|null=null,timer:ReturnType<typeof setTimeout>|undefined,started=false,stopped=false;
 const attempt=async()=>{
  const claim=await store.claim();if(!claim)return false;
  let lost=false,renewal:Promise<void>|null=null;
  const renew=()=>renewal??=store.renew(claim).then(ok=>{if(!ok)lost=true;},()=>{lost=true;}).finally(()=>{renewal=null;});
  const heartbeat=setInterval(()=>void renew(),options.renewMs??10000);heartbeat.unref?.();
  try{
   const plan=await evaluator.evaluate(claim.input);
   clearInterval(heartbeat);await renewal;
   // Complete verifies expiry/generation again inside its own transaction.
   if(!lost)await store.complete(claim,plan);
  }catch(error){
   clearInterval(heartbeat);await renewal;
   if(!lost){
    const known=error instanceof NotificationExecutionError;
    await store.fail(claim,known?error.code:'notification_execution_failed',known?error.retryable:true);
   }
  }finally{clearInterval(heartbeat);}
  return true;
 };
 const drainOnce=()=>pending??=attempt().finally(()=>{pending=null;});
 const tick=async()=>{
  try{await drainOnce();}catch{options.onError?.('notification_worker_unavailable');}
  if(!stopped){timer=setTimeout(()=>void tick(),options.pollMs??1000);timer.unref?.();}
 };
 return {
  start(){if(started)return;started=true;stopped=false;void tick();},
  async stop(){stopped=true;if(timer)clearTimeout(timer);await pending?.catch(()=>{});},
  drainOnce,
 };
}
