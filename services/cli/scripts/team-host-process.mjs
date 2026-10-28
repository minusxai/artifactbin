/** CI-only POSIX host cleanup. Caller must spawn a detached, privately owned process group. */
export async function stopTeamHost(server,graceMs=10000){
 if(!server)return;
 const exited=server.exitCode!==null||server.signalCode!==null;
 if(exited&&server.stdout.destroyed&&server.stderr.destroyed)return;
 await new Promise((resolve,reject)=>{
  // `exit` only observes the supervisor; `close` also waits for inherited output pipes.
  const finish=()=>{clearTimeout(timer);resolve();};
  server.once('close',finish);
  const timer=setTimeout(()=>{
   console.error('Team host cleanup exceeded its grace period; stopping its process group.');
   try{process.kill(-server.pid,'SIGKILL');}
   catch(error){if(error.code!=='ESRCH'){server.off('close',finish);reject(error);}}
  },graceMs);
  if(!exited)server.kill('SIGTERM');
 });
}
