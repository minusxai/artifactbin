/** Trusted private harness code; never copied into a page or public artifact. */
import {createHash} from 'node:crypto';
import {lstat,readFile,realpath,mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
/** @returns {Promise<undefined|(import('./native-migration-pilot-contract').NativeImportedPilotProbe & {sha256:string})>} */
export async function loadImportedPilotProbe({input,bundle,scratch}){
 if(input.probe===undefined)return;
 const entry=input.probe,invalid=()=>Error('native-imported-pilot-probe-invalid');
 if(typeof entry.path!=='string'||!entry.path.endsWith('.mjs')||entry.path.startsWith('/')||entry.path.split('/').some(p=>!p||p==='.'||p==='..')||!/^[a-f0-9]{64}$/.test(entry.sha256)||input.bundleFiles?.filter(f=>f.path===entry.path&&f.sha256===entry.sha256).length!==1)throw invalid();
 let bytes;
 try{
  const base=await realpath(bundle),file=path.join(base,entry.path);
  let prefix=base;for(const part of entry.path.split('/')){prefix=path.join(prefix,part);if((await lstat(prefix)).isSymbolicLink())throw invalid();}
  const resolved=await realpath(file);if(!resolved.startsWith(base+path.sep)||(await lstat(resolved)).isFile()!==true)throw invalid();
  bytes=await readFile(resolved);if(sha(bytes)!==entry.sha256)throw invalid();
 }catch{throw invalid();}
 await mkdir(scratch,{recursive:true,mode:0o700});
 const directory=await mkdtemp(path.join(scratch,'probe-')),file=path.join(directory,'probe.mjs');await writeFile(file,bytes,{mode:0o600,flag:'wx'});
 const module=await import(pathToFileURL(file).href);
 if(typeof module.mountImportedPilot!=='function')throw invalid();
 return {mountImportedPilot:module.mountImportedPilot,sha256:entry.sha256};
}
