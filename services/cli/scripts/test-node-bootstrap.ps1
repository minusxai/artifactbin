# CI-only native standard-user Windows PS5.1 bootstrap. No organization policy bypass.
param([string]$Tarball)
$ErrorActionPreference = 'Stop'
$identity = 'mxmx_node_' + [Guid]::NewGuid().ToString('N').Substring(0,6)
$password = [Guid]::NewGuid().ToString('N')+'aA!9'
$secure = ConvertTo-SecureString $password -AsPlainText -Force
$credential = New-Object Management.Automation.PSCredential("$env:COMPUTERNAME\$identity",$secure)
$root = Join-Path $env:PUBLIC ('afbin-node-'+[Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory $root | Out-Null
Copy-Item services/app/public/chat/ensure-node.ps1 (Join-Path $root 'ensure-node.ps1')
if (!$Tarball) { throw 'Pass the exact npm candidate tarball.' }
Copy-Item $Tarball (Join-Path $root 'candidate.tgz')
New-LocalUser -Name $identity -Password $secure -PasswordNeverExpires | Out-Null
Add-LocalGroupMember -Group Users -Member $identity
Start-Service seclogon
& icacls.exe $root /grant "${identity}:(OI)(CI)F" | Out-Null
$child = @'
$ErrorActionPreference='Stop'
[Environment]::SetEnvironmentVariable('PSModulePath',"$env:SystemRoot\System32\WindowsPowerShell\v1.0\Modules",'Process')
$identity=[Security.Principal.WindowsIdentity]::GetCurrent()
$principal=New-Object Security.Principal.WindowsPrincipal($identity)
if($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'Expected standard user'}
$profile=(Get-ItemProperty ('Registry::HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows NT\CurrentVersion\ProfileList\'+$identity.User.Value)).ProfileImagePath
$env:USERPROFILE=$profile; $env:HOME=$profile; $env:LOCALAPPDATA=Join-Path $profile 'AppData\Local'; $env:APPDATA=Join-Path $profile 'AppData\Roaming'
Set-ExecutionPolicy -Scope CurrentUser Restricted -Force
$env:PATH="$env:SystemRoot\System32;$env:SystemRoot;$env:SystemRoot\System32\WindowsPowerShell\v1.0"
if(Get-Command node.exe -ErrorAction SilentlyContinue){throw 'Expected Node-free PATH'}
$helper=[IO.File]::ReadAllText('__ROOT__\ensure-node.ps1')
Invoke-Expression $helper
if($LASTEXITCODE -ne 0){throw 'Bootstrap failed'}
Invoke-Expression $helper
if((Get-ExecutionPolicy -Scope CurrentUser) -ne 'Restricted' -or (Get-ExecutionPolicy) -ne 'Restricted'){throw 'Execution policy changed'}
$version=& node.exe --version
if($version -ne 'v24.21.0'){throw 'Wrong Node'}
$null=& npm.cmd --version;if($LASTEXITCODE -ne 0){throw 'npm failed'}
$null=& npx.cmd --version;if($LASTEXITCODE -ne 0){throw 'npx failed'}
# Repair a broken npm/npx command earlier on PATH without replacing valid cached Node.
$broken=Join-Path '__ROOT__' 'broken-bin';[IO.Directory]::CreateDirectory($broken) | Out-Null
[IO.File]::WriteAllText((Join-Path $broken 'npm.cmd'),"@exit /b 7`r`n")
[IO.File]::WriteAllText((Join-Path $broken 'npx.cmd'),"@exit /b 7`r`n")
$env:PATH="$broken;$env:PATH"
Invoke-Expression $helper
$null=& npm.cmd --version;if($LASTEXITCODE -ne 0){throw 'Broken npm repair failed'}
$null=& npx.cmd --version;if($LASTEXITCODE -ne 0){throw 'Broken npx repair failed'}
$private=Join-Path $env:LOCALAPPDATA 'artifactbin\node-v24.21.0-win-x64'
$userPath=[Environment]::GetEnvironmentVariable('PATH','User')
if(@($userPath -split ';' | Where-Object {$_ -eq $private}).Count -ne 1){throw 'Duplicate or missing durable PATH'}
$env:PATH=[Environment]::GetEnvironmentVariable('PATH','Machine')+';'+$userPath
$null=& npx.cmd --version;if($LASTEXITCODE -ne 0){throw 'Future PATH failed'}
# The exact release tarball runs through npx.cmd under the same non-admin policy.
$env:npm_config_cache=Join-Path '__ROOT__' 'npm-cache';$env:ARTIFACTBIN_HOME=Join-Path '__ROOT__' 'afbin-home';$env:CLI__AUTO_UPDATE='0';$env:ARTIFACTBIN_SKILLS='off';$env:ARTIFACTBIN_URL='http://127.0.0.1:1'
$rows=Join-Path '__ROOT__' 'rows.csv';[IO.File]::WriteAllText($rows,"amount`n10`n20`n")
$result=& npx.cmd --yes --package '__ROOT__\candidate.tgz' afbin query $rows --json
if($LASTEXITCODE -ne 0 -or !(($result | Out-String).Contains('10'))){throw 'Standard-user npx candidate query failed'}
$result=& npm.cmd exec --offline --yes --package '__ROOT__\candidate.tgz' -- afbin query $rows --json
if($LASTEXITCODE -ne 0 -or !(($result | Out-String).Contains('20'))){throw 'Standard-user warmed offline query failed'}
[IO.File]::WriteAllText('__ROOT__\passed.json','{"status":"passed","checks":["standard-user","restricted-policy","absent-node","official-archive-checksum","npm-npx","repeat","broken-npm-repair","current-future-path","same-tarball-standard-user-npx","warmed-offline-query"]}')
'@
$child=$child.Replace('__ROOT__',$root.Replace("'","''"))
# CreateProcessWithLogonW limits command lines to1024characters; keep script as
# data on disk and invoke only a short inline expression under Restricted policy.
[IO.File]::WriteAllText((Join-Path $root 'child.ps1'),$child)
$entry="Invoke-Expression ([IO.File]::ReadAllText('"+$root.Replace("'","''")+"\child.ps1'))"
$encoded=[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($entry))
try {
  $process=Start-Process "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -ArgumentList @('-NoProfile','-EncodedCommand',$encoded) -WorkingDirectory $root -Credential $credential -LoadUserProfile -PassThru -RedirectStandardOutput (Join-Path $root 'stdout') -RedirectStandardError (Join-Path $root 'stderr')
  if(!$process.WaitForExit(600000)){throw 'Bootstrap timed out'}
  Get-Content (Join-Path $root 'stdout')
  if($process.ExitCode -ne 0 -or !(Test-Path (Join-Path $root 'passed.json'))){Get-Content (Join-Path $root 'stderr');throw 'Standard-user Node bootstrap failed'}
  Get-Content (Join-Path $root 'passed.json')
} finally {
  Remove-LocalUser -Name $identity -ErrorAction SilentlyContinue
  Remove-Item $root -Recurse -Force -ErrorAction SilentlyContinue
}
