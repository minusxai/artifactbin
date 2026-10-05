/** Explicit composition boundary: remote runner clients never carry a local execution worker. */
import {copyFile} from 'node:fs/promises';
import {join} from 'node:path';
export async function copyRunnerAssets(directory,{remoteRunner=false}={}){
 if(remoteRunner)return;
 for(const name of ['runner-worker.mjs','agent.ts.txt'])await copyFile(new URL('../../services/runner/src/'+name,import.meta.url),join(directory,name));
}
