/** Windows acceptance of private directories: PowerShell launches of installed CLI processes, signed records, ACLs. */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHmac} from 'node:crypto';
import {lstat,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
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

/** The per-user key's directory for a profile, where the record key lives. */
const keyDirectoryOf=profile=>join(profile,'AppData','Local','artifactbin');
/**
 * Asserts that each directory carries a record signed for it with the profile's key and grants only its owner and
 * SYSTEM through a protected ACL, and that the key's parent (AppData\\Local) admits no broad group. Records alone
 * cannot prove the ACL was applied: they are written after the launch, so the ACL is read back. Returns those
 * AppData\\Local rules for the report.
 */
export async function assertWindowsPrivate(profile,directories){
 const keyDirectory=keyDirectoryOf(profile);
 const key=await readFile(join(keyDirectory,'private-directory.key'));assert.equal(key.length,32,'the per-user record key');
 for(const path of directories){
  const info=await lstat(path,{bigint:true});assert.ok(info.isDirectory()&&!info.isSymbolicLink(),`${path} is a real directory`);
  const signed=createHmac('sha256',key).update(`${info.dev}:${info.ino}:${info.birthtimeNs}`).digest('hex')+'\n';
  assert.equal(await readFile(join(path,'.private-directory'),'utf8'),signed,`${path} carries a record signed for it`);
 }
 const checked=[keyDirectory,...directories];
 // .NET and [Console] only: no module autoload (this runner's PSModulePath belongs to PowerShell 7), no localized
 // names (SIDs), no output encoding of the non-ASCII paths (each line carries its index, not its path).
 const literal=path=>`'${path.replace(/'/g,"''")}'`;
 const acl=(index,expression)=>`$a=[IO.Directory]::GetAccessControl(${expression}); $r=@($a.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])|ForEach-Object{$_.IdentityReference.Value+'|'+$_.FileSystemRights+'|'+$_.InheritanceFlags+'|'+$_.IsInherited+'|'+$_.AccessControlType}); [Console]::Out.WriteLine('${index}'+[char]9+$a.AreAccessRulesProtected+[char]9+($r -join ';'))`;
 const script=[`$ErrorActionPreference='Stop'`,`[Console]::Out.WriteLine('user'+[char]9+[Security.Principal.WindowsIdentity]::GetCurrent().User.Value)`,
  acl('profile',"[Environment]::GetFolderPath('LocalApplicationData')"),...checked.map((path,index)=>acl(index,literal(path)))].join('; ');
 const lines=Object.fromEntries(execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{encoding:'utf8'})
  .split(/\r?\n/).filter(Boolean).map(line=>{const [index,...rest]=line.split('\t');return [index,rest];}));
 const user=lines.user?.[0];assert.match(user??'',/^S-1-5-21-/,'the current user SID');
 const own=[`${user}|FullControl|ContainerInherit, ObjectInherit|False|Allow`,'S-1-5-18|FullControl|ContainerInherit, ObjectInherit|False|Allow'].sort();
 checked.forEach((path,index)=>{
  const [protectedFlag,rules]=lines[index]??[];
  assert.deepEqual({path,protected:protectedFlag,rules:(rules??'').split(';').filter(Boolean).sort()},{path,protected:'True',rules:own},'a private directory grants only its owner and SYSTEM');
 });
 // The key's parent is the user's AppData\\Local: no broad group may reach it (Everyone, Authenticated Users, Users).
 const appData=(lines.profile?.[1]??'').split(';').filter(Boolean);
 assert.ok(appData.length>0,'AppData\\Local has readable rules');
 assert.deepEqual(appData.filter(rule=>/^(S-1-1-0|S-1-5-11|S-1-5-32-545)\|/.test(rule)&&rule.endsWith('|Allow')),[],`AppData\\Local grants a broad group: ${appData.join(', ')}`);
 return appData;
}
