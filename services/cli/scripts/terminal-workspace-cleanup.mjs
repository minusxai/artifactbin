/** Native child processes may briefly retain a Windows cwd handle after their exit receipt. */
import {rm} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
export async function removeTerminalWorkspace(directory,{remove=rm,wait=delay,attempts=6}={}){
 for(let attempt=0;;attempt++){
  try{await remove(directory,{recursive:true,force:true});return;}
  catch(error){
   if(error.code!=='EBUSY'||attempt+1>=attempts)throw error;
   await wait(100*(attempt+1));
  }
 }
}
