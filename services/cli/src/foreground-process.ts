import {spawn} from 'node:child_process';
/** Run a foreground child with the caller's terminal; shutdown completes before its supervisor returns. */
export function foregroundProcess(executable:string,args:string[]):Promise<number>{
 const child=spawn(executable,args,{stdio:'inherit'});
 return new Promise((resolve,reject)=>{
  const forwarded=new Set<NodeJS.Signals>();
  const forward=(signal:NodeJS.Signals)=>{if(!forwarded.has(signal)){forwarded.add(signal);child.kill(signal);}};
  const interrupt=()=>forward('SIGINT'),terminate=()=>forward('SIGTERM');
  const cleanup=()=>{process.off('SIGINT',interrupt);process.off('SIGTERM',terminate);};
  process.on('SIGINT',interrupt);process.on('SIGTERM',terminate);
  child.once('error',error=>{cleanup();reject(error);});
  child.once('exit',code=>{cleanup();resolve(code??1);});
 });
}
