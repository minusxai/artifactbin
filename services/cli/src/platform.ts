/** Windows boundaries: literal browser URLs and inherited private filesystem ACLs. */
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const execute=promisify(execFile);
const quote=(value:string)=>"'"+value.replace(/'/g,"''")+"'";
// A caller in PowerShell 7 may export a module path incompatible with Windows PowerShell.
const encoded=(script:string)=>['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from("$env:PSModulePath=$PSHOME+'\\Modules'; "+script,'utf16le').toString('base64')];
export function browserCommand(url:string,platform:NodeJS.Platform=process.platform):{file:string;args:string[]} {
 return platform==='win32'?{file:'powershell.exe',args:encoded(`Start-Process -FilePath ${quote(url)}`)}:{file:platform==='darwin'?'open':'xdg-open',args:[url]};
}
/** Remove inherited and explicit grants, then allow only this user and SYSTEM. Children inherit.
 * Called at private directory boundaries, never for each file in a downloaded archive. */
export async function protectWindowsDirectory(path:string):Promise<void>{
 const script=`$ErrorActionPreference='Stop'; $path=${quote(path)}; $acl=New-Object Security.AccessControl.DirectorySecurity; $acl.SetAccessRuleProtection($true,$false); foreach($sid in @([Security.Principal.WindowsIdentity]::GetCurrent().User,(New-Object Security.Principal.SecurityIdentifier('S-1-5-18')))) { $rule=New-Object Security.AccessControl.FileSystemAccessRule($sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow'); $acl.AddAccessRule($rule) }; [IO.Directory]::SetAccessControl($path,$acl)`;
 await execute('powershell.exe',encoded(script),{timeout:30000,windowsHide:true});
}
