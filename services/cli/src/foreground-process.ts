import {spawn} from 'node:child_process';
const shutdownMessage=(value:unknown):boolean=>!!value&&typeof value==='object'&&(value as {type?:unknown}).type==='afbin.shutdown';
let supervisorStopRequested=false;
let clearSupervisorQueue:(()=>void)|undefined;
/** Capture an owned shutdown while the CLI is still preparing its foreground runtime. */
export function installForegroundSupervisorShutdown():void{
 if(!process.send||clearSupervisorQueue)return;
 const message=(value:unknown)=>{if(shutdownMessage(value))supervisorStopRequested=true;};
 const disconnect=()=>{supervisorStopRequested=true;};
 const cleanup=()=>{process.off('message',message);process.off('disconnect',disconnect);process.off('exit',cleanup);clearSupervisorQueue=undefined;};
 clearSupervisorQueue=cleanup;process.on('message',message);process.once('disconnect',disconnect);process.once('exit',cleanup);
 if(!process.connected)supervisorStopRequested=true;
}
/** Internal Node hosts turn an owned IPC request/disconnection into their JS shutdown handler. */
export function installForegroundShutdown():void{
 if(!process.send)return;
 let pending=false;
 const deliver=()=>{if(!pending||!process.listenerCount('SIGTERM'))return;pending=false;cleanup();process.emit('SIGTERM');};
 const request=()=>{pending=true;deliver();};
 const message=(value:unknown)=>{if(shutdownMessage(value))request();};
 // Disconnect may happen during runtime loading, before the host registers its cleanup handler.
 const listener=(event:string|symbol)=>{if(event==='SIGTERM'&&pending)setImmediate(deliver);};
 process.on('message',message);process.once('disconnect',request);process.on('newListener',listener);
 const cleanup=()=>{process.off('message',message);process.off('disconnect',request);process.off('newListener',listener);process.off('exit',cleanup);};
 process.once('exit',cleanup);
 if(process.connected)process.send({type:'afbin.host-ready'},()=>{});else request();
}
/** Run a foreground child with the caller's terminal; shutdown completes before its supervisor returns. */
export function foregroundProcess(executable:string,args:string[]):Promise<number>{
 const child=spawn(executable,args,{stdio:['inherit','inherit','inherit','ipc']});
 return new Promise((resolve,reject)=>{
  const forwarded=new Set<NodeJS.Signals>();let sent=false,ready=false,requested=supervisorStopRequested;
  supervisorStopRequested=false;clearSupervisorQueue?.();
  const send=()=>{if(sent||!ready||!requested)return;sent=true;if(child.connected)child.send({type:'afbin.shutdown'},()=>{});};
  const shutdown=()=>{requested=true;send();};
  const childMessage=(value:unknown)=>{if(value&&typeof value==='object'&&(value as {type?:unknown}).type==='afbin.host-ready'){ready=true;send();}};
  child.on('message',childMessage);
  const forward=(signal:NodeJS.Signals)=>{
   if(forwarded.has(signal))return;forwarded.add(signal);
   if(process.platform==='win32')shutdown();else child.kill(signal);
  };
  const interrupt=()=>forward('SIGINT'),terminate=()=>forward('SIGTERM');
  const message=(value:unknown)=>{if(shutdownMessage(value))shutdown();};
  const disconnect=()=>shutdown();
  const cleanup=()=>{process.off('SIGINT',interrupt);process.off('SIGTERM',terminate);process.off('message',message);process.off('disconnect',disconnect);child.off('message',childMessage);};
  process.on('SIGINT',interrupt);process.on('SIGTERM',terminate);process.on('message',message);process.once('disconnect',disconnect);
  child.once('error',error=>{cleanup();reject(error);});
  child.once('exit',code=>{cleanup();resolve(code??1);});
 });
}
