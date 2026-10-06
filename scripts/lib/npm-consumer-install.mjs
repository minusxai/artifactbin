/** Fresh native npm installation: seeded CI installs cannot revalidate on the network.
 * Keep lifecycle scripts enabled, stream npm phase timings, and settle only after child cleanup. */
import {spawn,execFileSync} from 'node:child_process';
export function installNpmConsumer({npm,tarball,cwd,env,seeded=false,onOutput=chunk=>process.stdout.write(chunk),timeoutMs=300000,heartbeatMs=15000}){
 return new Promise((resolve,reject)=>{
  const started=performance.now();
  // npm cache add stores full packuments; request the same representation offline.
  const args=[npm,'install',...(seeded?['--offline','--full-metadata']:[]),'--foreground-scripts','--no-audit','--no-fund','--timing',tarball];
  const child=spawn(process.execPath,args,{cwd,env,detached:process.platform!=='win32',stdio:['ignore','pipe','pipe']});
  let output='',timedOut=false;
  const collect=chunk=>{const text=chunk.toString();output+=text;onOutput(text);};
  child.stdout.on('data',collect);child.stderr.on('data',collect);
  const heartbeat=setInterval(()=>onOutput(`npm install still running (${((performance.now()-started)/1000).toFixed(1)}s, ${seeded?'offline seeded':'cold online'})\n`),heartbeatMs);
  const timer=setTimeout(()=>{
   timedOut=true;
   // Lifecycle scripts inherit our pipes. Terminate the entire tree so close is bounded.
   try{
    if(process.platform==='win32')execFileSync('taskkill',['/pid',String(child.pid),'/T','/F'],{stdio:'ignore',timeout:5000});
    else process.kill(-child.pid,'SIGKILL');
   }catch(error){if(error.code!=='ESRCH')child.kill('SIGKILL');}
  },timeoutMs);
  const clear=()=>{clearInterval(heartbeat);clearTimeout(timer);};
  child.once('error',error=>{clear();reject(error);});
  child.once('close',(code,signal)=>{
   clear();const seconds=(performance.now()-started)/1000;
   onOutput(`Native timing: ${seeded?'offline blob-cached':'cold'} npm install ${seconds.toFixed(1)}s\n`);
   if(timedOut)reject(Error(`npm install exceeded ${timeoutMs/1000}s\n${output}`));
   else if(code!==0)reject(Error(`npm install exited ${code??signal}\n${output}`));
   else resolve({output,seconds});
  });
 });
}
