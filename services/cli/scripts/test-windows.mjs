/** Windows-only CI acceptance of the installed release against real host handlers. */
import assert from 'node:assert/strict';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {once} from 'node:events';
import {createServer} from 'node:http';
import {mkdtemp,mkdir,readFile,writeFile,readdir,rm} from 'node:fs/promises';
import {join,resolve,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
const exec=promisify(execFile),repo=resolve('.'),out=resolve('.agent/windows-evidence'),dist=resolve('services/cli/dist');
assert.ok(process.argv[2], 'Caller supplies an isolated directory outside the repository');
const root=await mkdtemp(join(process.argv[2],'afbin candidate é '));
assert.ok(!root.startsWith(repo+sep),'Candidate must not resolve repository dependencies');
const profile=join(root,'profile'),workspace=join(root,'workspace with spaces'),state=join(profile,'.artifactbin'),install=join(root,'installed cli');
await mkdir(workspace,{recursive:true});await mkdir(profile,{recursive:true});await mkdir(join(root,'temp'));process.env.TEMP=join(root,'temp');process.env.TMP=join(root,'temp');
const powershell=join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe');
const systemPath=[join(process.env.SystemRoot,'System32'),join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0')].join(';');
const clientEnv={...process.env,TEMP:join(root,'temp'),TMP:join(root,'temp'),PATH:systemPath,Path:systemPath,PSModulePath:join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','Modules'),USERPROFILE:profile,HOME:profile,ARTIFACTBIN_HOME:state,CODEX_HOME:join(profile,'.codex'),CLI__AUTO_UPDATE:'off'};
delete clientEnv.ARTIFACTBIN_SKILLS;delete clientEnv.NODE_PATH;delete clientEnv.NODE_OPTIONS;delete clientEnv.ARTIFACTBIN_TOKEN;delete clientEnv.ARTIFACTBIN_REFRESH_TOKEN;
const evidence=[];let stage='start',host,hostLog='',corrupt=false;
const record=name=>{evidence.push(name);console.log('ok '+name);};
const ps=async(script)=>exec(powershell,['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from('[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding; '+script,'utf16le').toString('base64')],{env:clientEnv,timeout:30000});
const oldPath=(await ps("[Environment]::GetEnvironmentVariable('Path','User')")).stdout.trimEnd();
const release=createServer(async(req,res)=>{
 try {if(req.url==='/chat/install.ps1'){res.setHeader('content-type','text/plain');res.end(installerText);return;}const file=req.url.split('/').at(-1);if(!/^(SHA256SUMS|afbin-[A-Za-z0-9._-]+)$/.test(file)) {res.statusCode=404;res.end();return;}
 res.end(corrupt&&file==='afbin-win32-x64.exe.gz'?'corrupt':await readFile(join(dist,file)));}
 catch {res.statusCode=500;res.end();}
});
await new Promise(r=>release.listen(0,'127.0.0.1',r));
const releaseBase=`http://127.0.0.1:${release.address().port}`;
const reserve=createServer();await new Promise(r=>reserve.listen(0,'127.0.0.1',r));const port=reserve.address().port;await new Promise(r=>reserve.close(r));
const base=`http://127.0.0.1:${port}`,exe=join(install,'afbin.exe');
clientEnv.CLI__SERVICE_BASE_URL=releaseBase;
const installerFile=join(root,'install.ps1');
const installerSource=await readFile(join(repo,'services/app/public/chat/install.ps1'),'utf8');
const installerText=installerSource.replace(/^\$Origin = .*$/m,()=>`$Origin = '${base}'`).replace(/^\$ReleaseRoot = .*$/m,()=>`$ReleaseRoot = '${releaseBase}'`);
await ps(`Invoke-WebRequest -UseBasicParsing '${releaseBase}/chat/install.ps1' -OutFile '${installerFile.replace(/'/g,"''")}'`);
const installer=(shell=powershell)=>exec(shell,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',installerFile,'-Dir',install,'-Yes','-Harness','codex'],{env:clientEnv,timeout:180000,maxBuffer:1048576});
async function cli(args,{approve=false,cwd=workspace}={}){
 const child=spawn(exe,[...args,'--server',base,'--yes','--json'],{cwd,env:clientEnv,stdio:['ignore','pipe','pipe']});
 let stdout='',stderr='',approved=false,checking=false,approvalError;
 child.stdout.on('data',c=>stdout+=c);child.stderr.on('data',c=>stderr+=c);
 const timer=approve?setInterval(async()=>{
  if(approved||checking)return;checking=true;
  try{
   const name=(await readdir(state).catch(()=>[])).find(n=>/^pairing-.*\.json$/.test(n));if(!name)return;
   const pending=JSON.parse(await readFile(join(state,name),'utf8'));
   const response=await fetch(base+'/oauth/device/approve',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded',origin:base},body:new URLSearchParams({user_code:pending.userCode,decision:'anonymous'})});
   assert.equal(response.status,200,'real device approval');approved=true;
  }catch(error){approvalError=error;child.kill();}finally{checking=false;}
 },100):null;
 const deadline=setTimeout(()=>child.kill(),60000);
 try {const [code]=await once(child,'exit');if(approvalError)throw approvalError;assert.equal(code,0,args.join(' ')+' failed: '+stdout.slice(0,3500)+' '+stderr.slice(0,1500)+' '+stderr.slice(-1000));if(approve)assert.ok(approved);return JSON.parse(stdout);}
 finally{clearTimeout(deadline);if(timer)clearInterval(timer);}
}
try{
 stage='privilege check';const elevated=await ps('([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltinRole]::Administrator)');assert.equal(elevated.stdout.trim(),'False');record('Installer and CLI run as a separate standard user, not administrator');
 await ps('Set-ExecutionPolicy -Scope CurrentUser Restricted -Force');
 stage='install';await installer();
 assert.equal((await ps('Get-ExecutionPolicy -Scope CurrentUser')).stdout.trim(),'Restricted');record('Install command works under Restricted policy without changing it');record('PowerShell 5.1 install: download, checksum, private state and configuration');
 assert.ok((await readFile(join(profile,'.codex/skills/artifactbin/SKILL.md'),'utf8')).includes('artifactbin'));record('Installer installs the selected Codex skill');
 const version=await cli(['--version']);assert.equal(version.version,JSON.parse(await readFile('services/cli/package.json')).version);record('Standalone afbin.exe runs outside checkout without Node on PATH');
 stage='PATH';
 const found=await ps(`$env:Path = [Environment]::GetEnvironmentVariable('Path','User')+';'+$env:SystemRoot+'\\System32'; (Get-Command afbin.exe).Source`);
 assert.equal(found.stdout.trim(),exe);record('Fresh PowerShell process resolves executable from persisted user PATH');
 stage='checksum negative control';const before=createHash('sha256').update(await readFile(exe)).digest('hex');corrupt=true;
 await assert.rejects(installer(),e=>String(e.stderr).includes('Checksum mismatch'));
 assert.equal(createHash('sha256').update(await readFile(exe)).digest('hex'),before);corrupt=false;record('Corrupt download refused; installed executable unchanged');
 stage='reinstall';await installer();
 const count=await ps(`[int](@(([Environment]::GetEnvironmentVariable('Path','User') -split ';') | Where-Object { $_ -eq '${install.replace(/'/g,"''")}' }).Count)`);
 assert.equal(count.stdout.trim(),'1');record('Reinstall succeeds with closed executable and does not duplicate PATH');
 await installer(join(process.env.ProgramFiles,'PowerShell','7','pwsh.exe'));record('PowerShell 7 reinstalls the same verified release');
 stage='host boot';
 host=spawn(exe,['serve','--dir',join(root,'host'),'--port',String(port)],{cwd:workspace,env:clientEnv,stdio:['ignore','pipe','pipe']});
 host.stdout.on('data',c=>hostLog+=c);host.stderr.on('data',c=>hostLog+=c);
 let healthy=false;
 for(let n=0;n<90;n++){if(host.exitCode!==null)throw Error('Real host exited; inspect host.log');try{if((await fetch(base+'/api/health')).ok){healthy=true;break;}}catch{}await delay(1000);}
 assert.ok(healthy,'real host starts');record('Packaged standalone host starts on Windows without Node or checkout dependencies');
 stage='running executable replacement';const runningHash=createHash('sha256').update(await readFile(exe)).digest('hex');
 await assert.rejects(installer(),e=>String(e.stderr).includes('Close all afbin'));assert.equal(createHash('sha256').update(await readFile(exe)).digest('hex'),runningHash);record('Installer refuses a running executable without changing it');
 stage='auth';await cli(['auth'],{approve:true});record('Installed executable completes real OAuth device approval and saves credentials');
 const modulePath=clientEnv.PSModulePath;clientEnv.PSModulePath=join(profile,'no modules');
 await cli(['auth']);clientEnv.PSModulePath=modulePath;record('Saved credential works in a second process even with a foreign PowerShell module path');
 stage='credential ACL';
 const acl=await ps(`$file=Get-ChildItem -LiteralPath '${state.replace(/'/g,"''")}' -Filter credentials.env -Recurse | Select-Object -First 1; if (!$file) { throw 'No saved credential' }; (Get-Acl -LiteralPath $file.FullName).Access | ForEach-Object { $_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value }`);
 const sid=(await ps('[Security.Principal.WindowsIdentity]::GetCurrent().User.Value')).stdout.trim();
 const allowed=acl.stdout.trim().split(/\r?\n/);assert.ok(allowed.includes(sid));assert.ok(allowed.every(s=>s===sid||s==='S-1-5-18'));record('Saved credential ACL contains only installer identity and SYSTEM');
 stage='publish';await writeFile(join(workspace,'report.jsx'),'---\ntitle: mxmx_test_windows_candidate\nvisibility: unlisted\n---\n<h1>Windows candidate first version</h1>\n');
 await cli(['validate',join(workspace,'report.jsx')]);const pushed=await cli(['push',join(workspace,'report.jsx')]);const id=pushed.operations?.find(o=>o.id)?.id;assert.ok(id);record('Validate and push a new artifact through real handlers');
 const second=join(root,'second workspace');await mkdir(second);await cli(['pull',id,'--output','copy.jsx'],{cwd:second});
 const path=join(second,'copy.jsx');const original=await readFile(path,'utf8');assert.match(original,/Windows candidate first version/);await writeFile(path,original.replace('Windows candidate first version','Windows candidate edited version'));await cli(['validate','copy.jsx'],{cwd:second});await cli(['push','copy.jsx'],{cwd:second});record('Pull, edit, validate and republish in another workspace');
 stage='read';const opened=await cli(['open',id]);assert.equal(opened.operations?.[0]?.url,base+'/a/'+id);const page=await fetch(base+'/a/'+id);assert.equal(page.status,200);assert.match(await page.text(),/Windows candidate edited version/);record('Open command returns published URL; real viewer serves edited artifact');
 await cli(['delete',id,'--force']);record('Disposable artifact cleaned up');
 stage='native services';await writeFile(join(workspace,'rows.csv'),'amount\n42\n');
 const queried=await cli(['query','rows.csv']);assert.equal(queried.results[0].rows[0].amount,42);record('Packaged built-in SQL queries local data');
 await cli(['export','report.jsx','--output','image.png']);assert.equal((await readFile(join(workspace,'image.png'))).subarray(1,4).toString(),'PNG');record('Packaged preview runtime and Chromium render a local artifact');
 clientEnv.CLI__SERVICE_BASE_URL='http://127.0.0.1:1';await cli(['query','rows.csv']);await cli(['export','report.jsx','--output','offline.png']);record('SQL, runtime and Chromium caches work offline in later processes');

}catch(error){
 await writeFile(join(out,'results.json'),JSON.stringify({status:'failed',stage,message:error.message,details:{stdout:error.stdout,stderr:error.stderr,signal:error.signal},evidence},null,2));throw error;
}finally{
 if(host){host.kill();await Promise.race([once(host,'exit'),delay(3000)]);}
 await writeFile(join(out,'host.log'),hostLog);
 await ps(`[Environment]::SetEnvironmentVariable('Path','${oldPath.replace(/'/g,"''")}','User')`);
 await new Promise(r=>release.close(r));
 await rm(root,{recursive:true,force:true,maxRetries:3,retryDelay:200}).catch(()=>{});
}
await writeFile(join(out,'results.json'),JSON.stringify({status:'passed',platform:process.platform,node:process.version,evidence,limitations:['Hosted Windows Server 2022 runner, not clean Windows 11 desktop','Browser-launch process invoked; approval posted by harness to real consent route','No Windows desktop signing or SmartScreen certification']},null,2));
process.exit(0);
