/** Independent acceptance proofs own their temp directories, profiles, ports and child cleanup.
 * Await every proof even after a failure so one failed assertion cannot hide another verdict. */
import {spawn} from 'node:child_process';
export async function runAcceptanceProcesses(checks,{spawnProcess=spawn,timeout=210000}={}){
 const results=await Promise.allSettled(checks.map(({label,command,args,cwd,env})=>new Promise((resolve,reject)=>{
  const started=performance.now();
  const child=spawnProcess(command,args,{cwd,env,stdio:'inherit'});
  const timer=setTimeout(()=>{child.kill();reject(Error(`${label} exceeded ${timeout/1000}s`));},timeout);
  child.once('error',error=>{clearTimeout(timer);reject(error);});
  child.once('exit',(code,signal)=>{
   clearTimeout(timer);
   console.log(`Acceptance timing: ${label} ${((performance.now()-started)/1000).toFixed(1)}s`);
   code===0?resolve():reject(Error(`${label} exited ${code??signal}`));
  });
 })));
 const failures=results.filter(result=>result.status==='rejected').map(result=>result.reason);
 if(failures.length)throw new AggregateError(failures,'Installed-package acceptance failed');
}
