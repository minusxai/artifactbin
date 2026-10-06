/**
 * THE `afbin` COMMAND ON PATH — npm's own global install of `@afbin/cli`, and the retirement of the
 * 0.3.x standalone executables it replaces.
 *
 * npm owns the installed files: this module only asks npm to install a version (falling back to a
 * private prefix when the global one is not writable), reports where npm put the command, and backs
 * up and removes (or forwards) an old standalone `afbin` found on PATH. It never executes a found
 * file, never follows a symlink, and never throws for a single file it cannot change.
 */
import {execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync,realpathSync} from 'node:fs';
import {chmod,copyFile,lstat,mkdir,open,readFile,rename,unlink as unlinkFile,writeFile} from 'node:fs/promises';
import {dirname,join,posix,win32} from 'node:path';
import {configDir} from './config';

export type NpmRunner=(args:string[],options:{env:NodeJS.ProcessEnv;timeoutMs?:number})=>Promise<{code:number;stdout:string;stderr:string}>;
export type InstallKind='package'|'dev';
export interface GlobalInstallResult {status:'installed'|'failed';version:string;prefix:string;bin:string;on_path:boolean;fallback:boolean;reason?:string;path_line?:string}
export type FoundAfbin={path:string;kind:'standalone'|'forwarder'|'npm'};
export interface RetiredAfbin {path:string;backup?:string;status:'removed'|'forwarded'|'kept';reason?:string}

const PACKAGE_TREE=/(^|\/)node_modules\/@afbin\/cli(\/|$)/;
/**
 * 'package' when this process runs from a node_modules/@afbin/cli tree (npx cache, global prefix); 'dev'
 * otherwise (repo checkout, npm link). The entry is resolved first: npx starts `node_modules/.bin/afbin`,
 * a symlink into the package, and `npm link` puts a symlink to the checkout inside node_modules.
 */
export function installKind(entry:string=process.argv[1]??''):InstallKind{
 if(!entry)return 'dev';
 let resolved=entry;
 try{resolved=realpathSync(entry);}catch{/* A path that does not exist here is judged as written. */}
 return PACKAGE_TREE.test(resolved.replace(/\\/g,'/'))?'package':'dev';
}

/**
 * npm without a shell. Under npx (how setup runs) npm names its own CLI in npm_execpath, which this
 * Node runs directly; Windows refuses to spawn npm.cmd without a shell, so it uses npm's CLI beside node.
 */
export const defaultNpm:NpmRunner=(args,{env,timeoutMs})=>{
 const bundled=process.platform==='win32'?win32.join(dirname(process.execPath),'node_modules','npm','bin','npm-cli.js'):undefined;
 // Only npm's own CLI: under pnpm dlx or yarn dlx npm_execpath names that tool instead.
 const script=env.npm_execpath&&/(^|[\\/])npm(-cli)?\.c?js$/.test(env.npm_execpath)?env.npm_execpath:bundled&&existsSync(bundled)?bundled:undefined;
 const [file,argv]=script?[process.execPath,[script,...args]]:['npm',args];
 return new Promise(resolve=>{
  execFile(file,argv,{env,maxBuffer:16*1024*1024,windowsHide:true,...(timeoutMs?{timeout:timeoutMs,killSignal:'SIGKILL' as const}:{})},(error,stdout,stderr)=>{
   const code=!error?0:typeof error.code==='number'?error.code:1;
   resolve({code,stdout:String(stdout??''),stderr:String(stderr??'')+(error&&typeof error.code==='string'?`\n${error.code==='ENOENT'?'npm was not found on PATH.':error.message}`:'')});
  });
 });
};

/** Auto-update only the running npm global installation, including setup's private fallback prefix. */
export async function automaticInstallPrefix(options:{entry:string;home:string;env:NodeJS.ProcessEnv;platform?:string;npm:NpmRunner;timeoutMs:number}):Promise<string|undefined>{
 if(installKind(options.entry)!=='package')return;
 const platform=options.platform??process.platform,path=pathOf(platform);
 const physical=(value:string)=>{try{return realpathSync(value);}catch{return path.resolve(value);}};
 const entry=physical(options.entry);
 const matches=(prefix:string)=>samePath(entry,physical(path.join(prefix,...(platform==='win32'?[]:['lib']),'node_modules','@afbin','cli','dist','afbin.mjs')),platform);
 const privatePrefix=path.join(configDir(options.home,options.env),'npm');
 if(matches(privatePrefix))return privatePrefix;
 const result=await options.npm(['prefix','-g'],{env:options.env,timeoutMs:options.timeoutMs});
 const prefix=result.stdout.trim();
 if(result.code===0&&path.isAbsolute(prefix)&&matches(prefix))return prefix;
}

const pathOf=(platform:string)=>platform==='win32'?win32:posix;
const pathEntries=(env:NodeJS.ProcessEnv,platform:string)=>{
 const value=platform==='win32'?env.PATH??env.Path??Object.entries(env).find(([key])=>key.toLowerCase()==='path')?.[1]:env.PATH;
 return (value??'').split(platform==='win32'?';':':').filter(Boolean);
};
const samePath=(a:string,b:string,platform:string)=>{
 const clean=(value:string)=>{const path=pathOf(platform).normalize(value).replace(/[\\/]+$/,'');return platform==='win32'?path.toLowerCase():path;};
 return clean(a)===clean(b);
};
/** The few npm diagnostic lines a person needs, not npm's whole log. */
function failureReason(stderr:string,code:number):string{
 const lines=stderr.split(/\r?\n/).map(line=>line.trim()).filter(Boolean);
 const errors=lines.filter(line=>/^npm (ERR!|error)/.test(line)||/not found on PATH/.test(line));
 return (errors.length?errors:lines).slice(0,4).join(' ')||`npm exited with code ${code}.`;
}
const permissionFailure=(stderr:string,platform:string)=>/\bEACCES\b/.test(stderr)||platform==='win32'&&/\bEPERM\b/.test(stderr);

/**
 * npm install -g --no-fund --no-audit @afbin/cli@<version>. On a permission failure (EACCES, or EPERM on
 * win32) it retries into <configDir>/npm with --prefix. bin is where npm put the command; on_path says
 * whether its directory is on env.PATH, and path_line is the line to print when it is not.
 */
export async function globalInstall(options:{version:string;home:string;env:NodeJS.ProcessEnv;platform?:string;npm?:NpmRunner}):Promise<GlobalInstallResult>{
 const platform=options.platform??process.platform,npm=options.npm??defaultNpm,env=options.env,path=pathOf(platform);
 const spec=`@afbin/cli@${options.version}`;
 const binFor=(prefix:string)=>platform==='win32'?path.join(prefix,'afbin.cmd'):path.join(prefix,'bin','afbin');
 const finish=(prefix:string,fallback:boolean):GlobalInstallResult=>{
  const bin=binFor(prefix),directory=path.dirname(bin);
  const on_path=pathEntries(env,platform).some(entry=>samePath(entry,directory,platform));
  const path_line=platform==='win32'?`[Environment]::SetEnvironmentVariable('Path', '${directory};' + [Environment]::GetEnvironmentVariable('Path', 'User'), 'User')`:`export PATH="${directory}:$PATH"`;
  return {status:'installed',version:options.version,prefix,bin,on_path,fallback,...(on_path?{}:{path_line})};
 };
 const failed=(reason:string,prefix='',fallback=false):GlobalInstallResult=>({status:'failed',version:options.version,prefix,bin:prefix?binFor(prefix):'',on_path:false,fallback,reason});
 const first=await npm(['install','-g','--no-fund','--no-audit',spec],{env});
 if(first.code===0){
  const prefix=await npm(['prefix','-g'],{env});
  const value=prefix.stdout.trim().split(/\r?\n/).pop()?.trim()??'';
  return prefix.code===0&&value?finish(value,false):failed(`npm installed ${spec} but did not report its global prefix: ${failureReason(prefix.stderr,prefix.code)}`);
 }
 if(!permissionFailure(first.stderr,platform))return failed(failureReason(first.stderr,first.code));
 // The global prefix belongs to another user (Node from a system installer): use one under afbin's own state.
 const prefix=join(configDir(options.home,env),'npm');
 try{await mkdir(prefix,{recursive:true});}catch(error){return failed(`Could not create ${prefix}: ${(error as Error).message}`,prefix,true);}
 const retry=await npm(['install','-g','--prefix',prefix,'--no-fund','--no-audit',spec],{env});
 return retry.code===0?finish(prefix,true):failed(failureReason(retry.stderr,retry.code),prefix,true);
}

const MIB=1024*1024;
/** The two-line shim the transition bootstrap leaves when npm's bin directory is not on PATH. */
const forwarderText=(bin:string)=>`#!/bin/sh\nexec "${bin}" "$@"\n`;
function classify(head:Buffer,size:number):FoundAfbin['kind']{
 const text=head.toString('latin1');
 if(text.startsWith('#!/bin/sh')){
  const second=text.split('\n')[1]??'';
  if(second.startsWith('exec "')||text.includes('# afbin transition bootstrap'))return 'forwarder';
 }
 if(!(head[0]===0x23&&head[1]===0x21)&&size>MIB)return 'standalone';
 return 'npm';
}

/**
 * Every regular file named afbin (afbin.exe/afbin.cmd on win32) on env.PATH, in PATH order. Symlinks
 * (npm's own POSIX wrapper is one) and directories are skipped; files are read, never executed.
 */
export async function findAfbinOnPath(env:NodeJS.ProcessEnv,platform:string=process.platform):Promise<FoundAfbin[]>{
 const names=platform==='win32'?['afbin.exe','afbin.cmd','afbin']:['afbin'];
 const found:FoundAfbin[]=[];const seen=new Set<string>();
 for(const directory of pathEntries(env,platform)){
  for(const name of names){
   // Found files are real paths on this machine: joined natively, whatever platform names them.
   const candidate=join(directory,name),key=platform==='win32'?candidate.toLowerCase():candidate;
   if(seen.has(key))continue;seen.add(key);
   try{
    const info=await lstat(candidate);if(!info.isFile())continue;
    const handle=await open(candidate,'r');
    try{const head=Buffer.alloc(4096);const {bytesRead}=await handle.read(head,0,head.length,0);found.push({path:candidate,kind:classify(head.subarray(0,bytesRead),info.size)});}
    finally{await handle.close();}
   }catch{/* Missing or unreadable: not a command this user runs. */}
  }
 }
 return found;
}

const LOCKED='Stop running afbin processes and rerun setup.';
function keptReason(error:unknown,path:string):string{
 const code=(error as NodeJS.ErrnoException)?.code;
 if(code==='EBUSY'||code==='EPERM'||code==='ETXTBSY')return LOCKED;
 if(code==='EACCES')return `No permission to change ${path}; remove it yourself.`;
 return (error as Error)?.message??String(error);
}
/** Replaces a file through a sibling and a rename: atomic, and safe while the old executable runs. */
async function replaceFile(path:string,content:string){
 const temporary=`${path}.afbin-${process.pid}-${Date.now()}`;
 try{await writeFile(temporary,content,{mode:0o755});await chmod(temporary,0o755);await rename(temporary,path);}
 catch(error){await unlinkFile(temporary).catch(()=>{});throw error;}
}

/**
 * Standalone: copy to <configDir>/backups/standalone/afbin-<sha256 prefix>, then remove it when the npm
 * command is on PATH, or replace it with a forwarder to that command so the command the user had keeps
 * working. A forwarder is removed or rewritten by the same rule. A locked file is kept, with the reason.
 */
export async function retireAfbin(found:FoundAfbin[],installed:Pick<GlobalInstallResult,'bin'|'on_path'>,home:string,options:{env?:NodeJS.ProcessEnv;platform?:string;unlink?:(path:string)=>Promise<void>}={}):Promise<RetiredAfbin[]>{
 const platform=options.platform??process.platform,remove=options.unlink??(path=>unlinkFile(path));
 const results:RetiredAfbin[]=[];
 for(const item of found){
  if(item.kind==='npm'||samePath(item.path,installed.bin,platform))continue;
  let backup:string|undefined;
  try{
   const info=await lstat(item.path);
   if(!info.isFile()){results.push({path:item.path,status:'kept',reason:'Not a regular file; left unchanged.'});continue;}
   if(item.kind==='standalone'){
    const bytes=await readFile(item.path);
    const directory=join(configDir(home,options.env),'backups','standalone');
    backup=join(directory,`afbin-${createHash('sha256').update(bytes).digest('hex').slice(0,12)}`);
    await mkdir(directory,{recursive:true,mode:0o700});await copyFile(item.path,backup);
   }
   if(installed.on_path){await remove(item.path);results.push({path:item.path,...(backup?{backup}:{}),status:'removed'});continue;}
   if(platform==='win32'){
    // An .exe cannot become a shell script: a batch file beside it forwards once the .exe is gone.
    await writeFile(win32.join(win32.dirname(item.path),'afbin.cmd'),`@"${installed.bin}" %*\r\n`);
    if(!/\.cmd$/i.test(item.path))await remove(item.path);
   }else await replaceFile(item.path,forwarderText(installed.bin));
   results.push({path:item.path,...(backup?{backup}:{}),status:'forwarded'});
  }catch(error){results.push({path:item.path,...(backup?{backup}:{}),status:'kept',reason:keptReason(error,item.path)});}
 }
 return results;
}
