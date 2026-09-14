import {spawn,execFileSync} from 'node:child_process';

/** A deadline owns the whole eval process tree, including detached agent/browser children. */
export async function boundedRun(command:string,args:string[],timeoutMs:number):Promise<{code:number;elapsedMs:number;timedOut:boolean}> {
 const started=performance.now();
 const child=spawn(command,args,{stdio:'inherit',detached:true});
 let timedOut=false;
 const timer=setTimeout(()=>{
  timedOut=true;
  if(child.pid)killDescendants(child.pid);
 },timeoutMs);
 try {
  const code=await new Promise<number>((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>resolve(code??1));});
  return {code:timedOut?124:code,elapsedMs:Math.round(performance.now()-started),timedOut};
 } finally {clearTimeout(timer);}
}
function killDescendants(root:number):void {
 const rows=execFileSync('ps',['-A','-o','pid=,ppid='],{encoding:'utf8'}).trim().split('\n').map(line=>line.trim().split(/\s+/).map(Number));
 const owned=[root];
 for(let i=0;i<owned.length;i++)for(const [pid,parent] of rows)if(parent===owned[i]&&pid&&!owned.includes(pid))owned.push(pid);
 for(const pid of owned.reverse()) {
  try {process.kill(pid,'SIGKILL');}
  catch(error){
   if((error as NodeJS.ErrnoException).code==='ESRCH')continue;
   // CI's harness runs under a separate unprivileged uid. Only descendants of this run qualify.
   if((error as NodeJS.ErrnoException).code==='EPERM')execFileSync('sudo',['-n','kill','-KILL',String(pid)],{stdio:'ignore'});
   else throw error;
  }
 }
}
