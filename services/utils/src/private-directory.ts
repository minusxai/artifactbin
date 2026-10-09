/** Node filesystem privacy boundary shared by CLI and standalone HTTP credentials. */
import {chmod,lstat,mkdir} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const execute=promisify(execFile);
export async function protectWindowsDirectory(path:string):Promise<void>{
 const quoted="'"+path.replace(/'/g,"''")+"'";
 const script=`$env:PSModulePath=$PSHOME+'\\Modules'; $ErrorActionPreference='Stop'; $path=${quoted}; $acl=New-Object Security.AccessControl.DirectorySecurity; $acl.SetAccessRuleProtection($true,$false); foreach($sid in @([Security.Principal.WindowsIdentity]::GetCurrent().User,(New-Object Security.Principal.SecurityIdentifier('S-1-5-18')))) { $rule=New-Object Security.AccessControl.FileSystemAccessRule($sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow'); $acl.AddAccessRule($rule) }; [IO.Directory]::SetAccessControl($path,$acl)`;
 await execute('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{timeout:30000,windowsHide:true});
}
export async function privateDirectory(path:string):Promise<void>{
 await mkdir(path,{recursive:true,mode:0o700});const info=await lstat(path);
 if(!info.isDirectory()||info.isSymbolicLink())throw new Error(`Expected a private directory: ${path}`);
 if(process.platform==='win32')await protectWindowsDirectory(path);else await chmod(path,0o700);
}
