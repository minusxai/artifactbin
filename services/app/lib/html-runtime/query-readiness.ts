import {RemoteUnreachable,type RemotePort} from './apollo/apollo-contracts';
import type {QueryReadiness,QueryReadinessOptions} from './query-readiness-contract';
/** Wait only for the current attempt; cancellation invalidates even already resolved senders. */
export function createQueryReadiness(options:QueryReadinessOptions):QueryReadiness{
 const schedule=options.schedule??((callback,delay)=>setTimeout(callback,delay)),cancel=options.cancel??(handle=>clearTimeout(handle as ReturnType<typeof setTimeout>));
 let phase:'pending'|'offline'|'online'=options.pending?'pending':'offline',generation=0,disposed=false,timer:unknown,sender:RemotePort['execute']|undefined;
 const waiters=new Set<(sender:RemotePort['execute']|null)=>void>();
 const bound=(execute:RemotePort['execute']):RemotePort['execute']=>{const epoch=generation;return async request=>{if(disposed||phase!=='online'||generation!==epoch||sender!==execute)throw new RemoteUnreachable();return execute(request);};};
 const finish=(execute:RemotePort['execute']|null)=>{cancel(timer);timer=undefined;for(const resolve of waiters)resolve(execute);waiters.clear();};
 const offline=()=>{phase='offline';sender=undefined;generation++;finish(null);};
 return {
  online:()=>!disposed&&phase==='online',pending:()=>!disposed&&phase==='pending',
  wait(){
   if(disposed||phase==='offline')return Promise.resolve(null);
   if(phase==='online'&&sender)return Promise.resolve(bound(sender));
   if(timer===undefined)timer=schedule(offline,options.timeoutMs??15_000);
   return new Promise(resolve=>waiters.add(resolve));
  },
  update(online,execute,pending=false){
   if(disposed)return false;
   if(online&&execute){const changed=phase!=='online'||sender!==execute;if(phase==='online'&&changed)generation++;sender=execute;phase='online';finish(bound(execute));return changed;}
   if(pending){if(phase!=='pending'){generation++;finish(null);phase='pending';sender=undefined;}return false;}
   offline();return false;
  },
  execute(request){return sender?bound(sender)(request):Promise.reject(new RemoteUnreachable());},
  dispose(){if(disposed)return;offline();disposed=true;},
 };
}
