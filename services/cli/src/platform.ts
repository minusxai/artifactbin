/** Windows boundaries: literal browser URLs and inherited private filesystem ACLs. */
const quote=(value:string)=>"'"+value.replace(/'/g,"''")+"'";
// A caller in PowerShell 7 may export a module path incompatible with Windows PowerShell.
const encoded=(script:string)=>['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from("$env:PSModulePath=$PSHOME+'\\Modules'; "+script,'utf16le').toString('base64')];
export function browserCommand(url:string,platform:NodeJS.Platform=process.platform):{file:string;args:string[]} {
 return platform==='win32'?{file:'powershell.exe',args:encoded(`Start-Process -FilePath ${quote(url)}`)}:{file:platform==='darwin'?'open':'xdg-open',args:[url]};
}
