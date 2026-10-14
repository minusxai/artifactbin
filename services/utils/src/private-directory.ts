/** Node filesystem privacy boundary shared by CLI and standalone HTTP credentials. */
import {chmod,lstat,mkdir,readFile} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
import {homedir} from 'node:os';
import {join,resolve} from 'node:path';
import {promisify} from 'node:util';
import {atomicWrite} from './atomic-file';
const execute=promisify(execFile);
/** One PowerShell launch replaces the ACL of every path: protected, owner and SYSTEM only, inherited by their
 * contents. The script travels UTF-16 base64 encoded (about 2.7 times its length) under Windows' 32K command line,
 * room for about a hundred paths; callers pass a handful. */
export async function protectWindowsDirectories(paths:readonly string[]):Promise<void>{
 const quoted=paths.map(path=>"'"+path.replace(/'/g,"''")+"'").join(',');
 const script=`$env:PSModulePath=$PSHOME+'\\Modules'; $ErrorActionPreference='Stop'; $paths=@(${quoted}); $acl=New-Object Security.AccessControl.DirectorySecurity; $acl.SetAccessRuleProtection($true,$false); foreach($sid in @([Security.Principal.WindowsIdentity]::GetCurrent().User,(New-Object Security.Principal.SecurityIdentifier('S-1-5-18')))) { $rule=New-Object Security.AccessControl.FileSystemAccessRule($sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow'); $acl.AddAccessRule($rule) }; foreach($path in $paths) { [IO.Directory]::SetAccessControl($path,$acl) }`;
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
const keyDirectory=()=>join(homedir(),'AppData','Local','artifactbin');
const keyPath=()=>join(keyDirectory(),'private-directory.key');
/**
 * The per-user key that signs protection records. It lives under the user's profile (AppData\Local), which
 * Windows grants only to the user, SYSTEM and Administrators, in its own directory protected with the same
 * ACL before the key is (re)created. A new key invalidates every record, so each directory is protected again.
 */
async function currentKey():Promise<{key:Buffer|null;stored:boolean}>{
 const existing=await readOptional(keyPath());
 return {key:existing?.length===KEY_BYTES?existing:null,stored:existing!==null};
}
/** Called only after the key's directory was protected. */
async function createKey(replacing:boolean):Promise<Buffer>{
 const path=keyPath(),key=randomBytes(KEY_BYTES);
 if(replacing)await atomicWrite(path,key);
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

/**
 * Makes every path a private directory, creating it as needed. Node exposes no Windows ACL read, and PowerShell's
 * cold start costs seconds, so the ACL is applied to the directories this call creates or finds without a record
 * signed for them, never again after, and all of them (with the key's directory when the key is new) share ONE
 * PowerShell launch. Name every directory a command will need, parents first, to pay at most one launch.
 * Records and a new key are written only after that launch succeeds, so a failure leaves nothing trusted and the
 * next call protects them again.
 */
export async function privateDirectories(paths:readonly string[]):Promise<void>{
 const directories=[...new Set(paths.map(path=>resolve(path)))];
 const found=[];for(const path of directories)found.push({path,...await existingDirectory(path)});
 if(process.platform!=='win32'){for(const {path} of found)await chmod(path,0o700);return;}
 const {key,stored}=await currentKey();
 const unprotected=[];
 for(const entry of found)if(!key||entry.created||!signed(await readOptional(join(entry.path,PROTECTED_RECORD)),sign(key,entry.identity)))unprotected.push(entry);
 if(unprotected.length===0)return;
 if(!key)await existingDirectory(keyDirectory());
 await protectWindowsDirectories([...(key?[]:[keyDirectory()]),...unprotected.map(entry=>entry.path)]);
 const signing=key??await createKey(stored);
 for(const entry of unprotected)await atomicWrite(join(entry.path,PROTECTED_RECORD),sign(signing,entry.identity));
}
/** One private directory; see `privateDirectories`. */
export async function privateDirectory(path:string):Promise<void>{
 await privateDirectories([path]);
}
