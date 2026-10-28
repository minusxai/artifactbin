/** Platform launch and failure cleanup boundary for isolated native npm consumers. */
import {rm} from 'node:fs/promises';
export async function cleanupFailedNativeConsumer(root,{platform,nativeLoaded,remove=rm}){
 // Windows cannot unlink the PTY/sharp DLLs loaded in this harness process. CI owns
 // the isolated temp directory after process exit; preserving the original failure takes priority.
 if(platform==='win32'&&nativeLoaded)return;
 try{await remove(root,{recursive:true,force:true});}
 catch{console.warn('Native acceptance temp cleanup deferred; original proof failure retained.');}
}
