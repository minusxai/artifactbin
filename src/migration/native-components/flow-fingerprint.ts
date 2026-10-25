import {readFile,readdir} from 'node:fs/promises';import path from 'node:path';import {createHash} from 'node:crypto';
import {retainedCompilerFingerprint} from './analyze.ts';import {nativeDigest} from './selection.ts';
/** Same exact retained SQL/compiler/runtime identity used by isolated flow compilation. */
export async function retainedNativeFlowFingerprint(root:string){
 const files:string[]=[];
 async function walk(relative:string):Promise<void>{for(const entry of await readdir(path.join(root,relative),{withFileTypes:true})){const name=relative+'/'+entry.name;if(entry.isDirectory())await walk(name);else if(entry.isFile())files.push(name);}}
 await walk('services/sql/src');files.push('services/sql/package.json','package-lock.json');
 const hashes=await Promise.all(files.sort().map(async file=>[file,createHash('sha256').update(await readFile(path.join(root,file))).digest('hex')]));
 return {compilerSourceSha256:await retainedCompilerFingerprint(root),sqlEngineSha256:nativeDigest({hashes,runtime:{node:process.versions.node,v8:process.versions.v8,icu:process.versions.icu,tz:process.versions.tz}})};
}
