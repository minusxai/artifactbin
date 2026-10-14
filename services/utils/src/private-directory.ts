/** Node filesystem privacy boundary shared by CLI and standalone HTTP credentials. */
import {chmod,lstat,mkdir,readFile} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {promisify} from 'node:util';
import {atomicWrite} from './atomic-file';
const execute=promisify(execFile);
export async function protectWindowsDirectory(path:string):Promise<void>{
 const quoted="'"+path.replace(/'/g,"''")+"'";
 const script=`$env:PSModulePath=$PSHOME+'\\Modules'; $ErrorActionPreference='Stop'; $path=${quoted}; $acl=New-Object Security.AccessControl.DirectorySecurity; $acl.SetAccessRuleProtection($true,$false); foreach($sid in @([Security.Principal.WindowsIdentity]::GetCurrent().User,(New-Object Security.Principal.SecurityIdentifier('S-1-5-18')))) { $rule=New-Object Security.AccessControl.FileSystemAccessRule($sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow'); $acl.AddAccessRule($rule) }; [IO.Directory]::SetAccessControl($path,$acl)`;
 await execute('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{timeout:30000,windowsHide:true});
}

async function readOptional(path:string):Promise<Buffer|null>{
 try{return await readFile(path);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error;}
}
async function existingDirectory(path:string):Promise<{created:boolean;identity:string}>{
 const created=await mkdir(path,{recursive:true,mode:0o700})!==undefined;const info=await lstat(path,{bigint:true});
 if(!info.isDirectory()||info.isSymbolicLink())throw new Error(`Expected a private directory: ${path}`);
 return {created,identity:`${info.dev}:${info.ino}:${info.birthtimeNs}`};
}

const KEY_BYTES=32;
/**
 * The per-user key that signs protection records. It lives under the user's profile (AppData\Local), which
 * Windows grants only to the user, SYSTEM and Administrators, in its own directory protected with the same
 * ACL whenever the key is (re)created. A new key invalidates every record, so each directory is protected again.
 */
async function recordKey():Promise<Buffer>{
 const directory=join(homedir(),'AppData','Local','artifactbin'),path=join(directory,'private-directory.key');
 const existing=await readOptional(path);
 if(existing?.length===KEY_BYTES)return existing;
 await existingDirectory(directory);await protectWindowsDirectory(directory);
 const key=randomBytes(KEY_BYTES);
 if(existing)await atomicWrite(path,key);
 else try{await atomicWrite(path,key,{exclusive:true});}catch(error){
  // Another process created the key first: use its key, so neither process's records go stale.
  if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;
  const winner=await readFile(path);if(winner.length!==KEY_BYTES)throw new Error(`Unreadable private directory key: ${path}`);return winner;
 }
 return key;
}

/**
 * Written inside a Windows directory only after its ACL was replaced: an HMAC, under the user's key, of the
 * directory's volume, file id and creation time. Another user cannot forge it without the key, and a copied,
 * moved-in or recreated directory never matches it.
 */
const PROTECTED_RECORD='.private-directory';
const sign=(key:Buffer,identity:string)=>createHmac('sha256',key).update(identity).digest('hex')+'\n';
function signed(record:Buffer|null,expected:string):boolean{
 const wanted=Buffer.from(expected);return record!==null&&record.length===wanted.length&&timingSafeEqual(record,wanted);
}

/** Node exposes no Windows ACL read, and PowerShell's cold start costs seconds per command, so the ACL is
 * applied when this call creates the directory or finds it without a record signed for it, never again after. */
export async function privateDirectory(path:string):Promise<void>{
 const {created,identity}=await existingDirectory(path);
 if(process.platform!=='win32'){await chmod(path,0o700);return;}
 const key=await recordKey(),record=join(path,PROTECTED_RECORD),expected=sign(key,identity);
 if(!created&&signed(await readOptional(record),expected))return;
 await protectWindowsDirectory(path);
 await atomicWrite(record,expected);
}
