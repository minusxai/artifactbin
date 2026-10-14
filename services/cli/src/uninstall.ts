/** `afbin uninstall`: remove the agent skills setup installs and npm's global `@afbin/cli`; --purge also deletes ~/.artifactbin. */
import {lstat,rm} from 'node:fs/promises';
import {createInterface} from 'node:readline/promises';
import {configDir} from './config';
import {defaultNpm,type NpmRunner} from './global-install';
import {skillTargets} from './skill-install';

export async function uninstallPaths(home:string,env:NodeJS.ProcessEnv,purge:boolean):Promise<string[]>{
 const paths=[...Object.values(skillTargets(home,env)),...(purge?[configDir(home,env)]:[])];
 const present:string[]=[];
 for(const path of paths)if(await lstat(path).then(()=>true,()=>false))present.push(path);
 return present;
}
export async function uninstall(paths:string[],options:{env:NodeJS.ProcessEnv;npm?:NpmRunner}):Promise<{removed:string[];npm:'removed'|'failed';reason?:string}>{
 for(const path of paths)await rm(path,{recursive:true,force:true});
 const result=await (options.npm??defaultNpm)(['uninstall','-g','@afbin/cli'],{env:options.env});
 return {removed:paths,...(result.code===0?{npm:'removed' as const}:{npm:'failed' as const,reason:result.stderr.trim()||`npm exited with code ${result.code}`})};
}
export async function confirmUninstall(question:string):Promise<boolean>{
 const prompt=createInterface({input:process.stdin,output:process.stderr});
 try{return /^y(es)?$/i.test((await prompt.question(question)).trim());}finally{prompt.close();}
}
