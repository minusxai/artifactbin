/** Windows acceptance: count the PowerShell launches of installed CLI processes through a preloaded child_process wrap. */
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const SPAWN_COUNTER=`const cp=require('node:child_process'),{promisify}=require('node:util'),{appendFileSync}=require('node:fs'),{syncBuiltinESMExports}=require('node:module');
const note=file=>{if(/powershell/i.test(String(file)))appendFileSync(process.env.AFBIN_SPAWN_LOG,String(file)+'\\n');};
for(const name of ['execFile','execFileSync','spawn','spawnSync','exec','execSync']){const original=cp[name];if(typeof original!=='function')continue;
 const wrapped=function(file,...rest){note(file);return original.call(this,file,...rest);};
 if(original[promisify.custom])wrapped[promisify.custom]=function(file,...rest){note(file);return original[promisify.custom].call(this,file,...rest);};
 cp[name]=wrapped;}
syncBuiltinESMExports();
`;
/** `env(label)` adds the preload and a per-label log to a child's environment; `count(label)` reads its launches. */
export async function powershellLaunchCounter(){
 const directory=await mkdtemp(join(tmpdir(),'afbin-spawns-')),counter=join(directory,'count.cjs');await writeFile(counter,SPAWN_COUNTER);
 const log=label=>join(directory,`${label}.log`);
 return {
  // NODE_OPTIONS reads backslashes as escapes, so the preload is named with forward slashes.
  env:label=>({NODE_OPTIONS:`${process.env.NODE_OPTIONS??''} --require "${counter.replaceAll('\\','/')}"`.trim(),AFBIN_SPAWN_LOG:log(label)}),
  count:async label=>(await readFile(log(label),'utf8').catch(()=>'')).split('\n').filter(Boolean).length,
  close:()=>rm(directory,{recursive:true,force:true}),
 };
}
