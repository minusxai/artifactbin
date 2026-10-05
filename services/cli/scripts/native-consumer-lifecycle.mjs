/** Platform launch and failure cleanup boundary for isolated native npm consumers. */
import {rm} from 'node:fs/promises';
import {win32} from 'node:path';
export function nativeBootstrapCheck({platform,executable,repository,tarball,environment}){
 let command=executable,env=environment,args=['services/cli/scripts/test-node-bootstrap.mjs'];
 if(platform==='win32'){
  // GitHub's npm step runs in pwsh7; native PS5.1 cannot load its inherited module roots.
  if(!environment.SystemRoot)throw Error('Windows bootstrap requires SystemRoot');
  const shell=win32.join(environment.SystemRoot,'System32','WindowsPowerShell','v1.0');
  command=win32.join(shell,'powershell.exe');env={...environment};
  for(const key of Object.keys(env))if(key.toLowerCase()==='psmodulepath')delete env[key];
  env.PSModulePath=win32.join(shell,'Modules');
  args=['-NoProfile','-File','services/cli/scripts/test-node-bootstrap.ps1','-Tarball',tarball];
 }
 return {label:'absent-Node bootstrap',command,args,cwd:repository,env};
}
export async function cleanupFailedNativeConsumer(root,{platform,nativeLoaded,remove=rm}){
 // Windows cannot unlink the PTY/sharp DLLs loaded in this harness process. CI owns
 // the isolated temp directory after process exit; preserving the original failure takes priority.
 if(platform==='win32'&&nativeLoaded)return;
 try{await remove(root,{recursive:true,force:true});}
 catch{console.warn('Native acceptance temp cleanup deferred; original proof failure retained.');}
}
