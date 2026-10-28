import type {ConnectionMonitorOptions} from './contracts';
/** Foreground-only, single-flight observation. Stops cannot deliver queued evidence or restart polling. */
export function startConnectionMonitor(options:ConnectionMonitorOptions):{wake():void;dispose():void}{
 const now=options.now??Date.now,schedule=options.schedule??((callback,delay)=>setTimeout(callback,delay)),cancel=options.cancel??(handle=>clearTimeout(handle as ReturnType<typeof setTimeout>));
 const interval=Math.max(1000,options.intervalMs??15_000);let last=now(),timer:unknown,deadline:unknown,disposed=false,controller:AbortController|undefined;
 const arm=()=>{if(disposed||controller)return;cancel(timer);timer=schedule(run,Math.max(0,last+interval-now()));};
 const run=async()=>{
  if(disposed||controller)return;
  if(!options.foreground()){timer=schedule(run,interval);return;}last=now();
  const active=new AbortController();controller=active;
  deadline=schedule(()=>{if(disposed||controller!==active)return;active.abort();controller=undefined;options.onFailure(Error('connection_observation_timeout'));arm();},Math.max(1000,options.timeoutMs??10_000));
  try{const status=await options.poll(active.signal);if(!disposed&&controller===active)options.onStatus(status);}
  catch(error){if(!disposed&&controller===active)options.onFailure(error);}
  finally{if(controller===active){cancel(deadline);controller=undefined;arm();}}
 };
 arm();return {wake(){arm();},dispose(){if(disposed)return;disposed=true;cancel(timer);cancel(deadline);controller?.abort();controller=undefined;}};
}
