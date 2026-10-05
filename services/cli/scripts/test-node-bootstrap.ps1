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
$phase='initialize'
trap {
  $failure=[ordered]@{phase=$phase;message=$_.Exception.Message;detail=($_ | Out-String);stack=$_.ScriptStackTrace;lastExitCode=$LASTEXITCODE}
  [IO.File]::WriteAllText('__ROOT__\failed.json',($failure | ConvertTo-Json -Depth 4))
  exit 1
}
function Invoke-Candidate([string]$Command,[string[]]$Arguments) {
  Write-Host ('Native phase: '+$phase)
  $previous=$ErrorActionPreference
  $clock=[Diagnostics.Stopwatch]::StartNew()
  try {
    # PS5.1 emits native stderr as ErrorRecord objects; exit code owns success.
    $ErrorActionPreference='Continue'
    $output=& $Command @Arguments 2>&1
    $code=$LASTEXITCODE
  } finally { $ErrorActionPreference=$previous;Write-Host ('Native timing: '+$phase+' '+$clock.Elapsed.TotalSeconds.ToString('F1')+'s') }
  foreach($record in $output){if($record -is [Management.Automation.ErrorRecord]){Write-Host ('Native stderr: '+$record)}}
  $text=($output | Where-Object {$_ -isnot [Management.Automation.ErrorRecord]} | Out-String)
  Write-Host $text
  if($code -ne 0){throw "$phase failed with exit $code : $text"}
  return $text
}
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
$ErrorActionPreference='Continue';$ProgressPreference='Continue'
$clock=[Diagnostics.Stopwatch]::StartNew()
Invoke-Expression $helper
Write-Host ('Native timing: absent Node official bootstrap '+$clock.Elapsed.TotalSeconds.ToString('F1')+'s')
if($ErrorActionPreference -ne 'Continue' -or $ProgressPreference -ne 'Continue'){throw 'Bootstrap changed caller preferences'}
$ErrorActionPreference='Stop'
if($LASTEXITCODE -ne 0){throw 'Bootstrap failed'}
$clock=[Diagnostics.Stopwatch]::StartNew()
Invoke-Expression $helper
Write-Host ('Native timing: repeat bootstrap '+$clock.Elapsed.TotalSeconds.ToString('F1')+'s')
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
$clock=[Diagnostics.Stopwatch]::StartNew()
Invoke-Expression $helper
Write-Host ('Native timing: broken npm repair '+$clock.Elapsed.TotalSeconds.ToString('F1')+'s')
Write-Output ('Repaired npm command: '+(Resolve-AfbinApplication 'npm.cmd'))
Write-Output ('PowerShell npm command: '+(Get-Command npm.cmd -CommandType Application).Source)
$null=& npm.cmd --version;if($LASTEXITCODE -ne 0){throw 'Broken npm repair failed'}
$null=& npx.cmd --version;if($LASTEXITCODE -ne 0){throw 'Broken npx repair failed'}
$private=Join-Path $env:LOCALAPPDATA 'artifactbin\node-v24.21.0-win-x64'
$userPath=[Environment]::GetEnvironmentVariable('PATH','User')
if(@($userPath -split ';' | Where-Object {$_ -eq $private}).Count -ne 1){throw 'Duplicate or missing durable PATH'}
$env:PATH=[Environment]::GetEnvironmentVariable('PATH','Machine')+';'+$userPath
$null=& npx.cmd --version;if($LASTEXITCODE -ne 0){throw 'Future PATH failed'}
# Verify PS5.1 native stderr is diagnostic output, while nonzero exits fail.
$phase='native stderr contract'
$warning=Join-Path '__ROOT__' 'warning.cmd'
[IO.File]::WriteAllText($warning,"@echo native-warning 1>&2`r`n@echo native-stdout-ok`r`n@exit /b 0`r`n")
if((Invoke-Candidate $warning @()) -notmatch 'native-stdout-ok'){throw 'Native stderr lost stdout'}
$rejected=$false
try{Invoke-Candidate (Join-Path $broken 'npm.cmd') @('--version')}catch{$rejected=$_.Exception.Message.Contains('exit 7')}
if(!$rejected){throw 'Native command failure was ignored'}
# The exact release tarball runs through npx.cmd under the same non-admin policy.
$env:npm_config_audit='false';$env:npm_config_fund='false';$env:npm_config_update_notifier='false'
$env:npm_config_cache=Join-Path '__ROOT__' 'npm-cache';$env:ARTIFACTBIN_HOME=Join-Path '__ROOT__' 'afbin-home';$env:CLI__AUTO_UPDATE='0';$env:ARTIFACTBIN_SKILLS='off';$env:ARTIFACTBIN_URL='http://127.0.0.1:1'
$rows=Join-Path '__ROOT__' 'rows.csv';[IO.File]::WriteAllText($rows,"amount`n10`n20`n")
if(Test-Path $env:npm_config_cache){throw 'Expected genuinely cold npm cache'}
$phase='standard-user online npx query'
$result=Invoke-Candidate 'npx.cmd' @('--yes','--package','__ROOT__\candidate.tgz','afbin','query',$rows,'--json')
if(!(($result | ConvertFrom-Json | ConvertTo-Json -Depth 10).Contains('10'))){throw 'Standard-user npx candidate query failed'}
# Warmed offline/native behavior is proved by both Windows native matrix versions.
[IO.File]::WriteAllText('__ROOT__\passed.json','{"status":"passed","checks":["standard-user","restricted-policy","absent-node","official-archive-checksum","npm-npx","repeat","broken-npm-repair","current-future-path","native-stderr-contract","same-tarball-standard-user-npx"]}')
'@
$child=$child.Replace('__ROOT__',$root.Replace("'","''"))
# CreateProcessWithLogonW limits command lines to1024characters; keep script as
# data on disk and invoke only a short inline expression under Restricted policy.
[IO.File]::WriteAllText((Join-Path $root 'child.ps1'),$child)
$entry="Invoke-Expression ([IO.File]::ReadAllText('"+$root.Replace("'","''")+"\child.ps1'))"
$encoded=[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($entry))
function Start-StandardProcess([string]$Encoded,[string]$Label) {
  $process=Start-Process "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -ArgumentList @('-NoProfile','-EncodedCommand',$Encoded) -WorkingDirectory $root -Credential $credential -LoadUserProfile -PassThru -RedirectStandardOutput (Join-Path $root ($Label+'.stdout')) -RedirectStandardError (Join-Path $root ($Label+'.stderr'))
  # Cache the owned handle before waiting: PS5.1 credential launches otherwise lose ExitCode.
  $null=$process.Handle
  return $process
}
function Wait-StandardExit([Diagnostics.Process]$Process,[int]$Timeout) {
  if(!$Process.WaitForExit($Timeout)){throw 'Standard-user child timed out'}
  $Process.WaitForExit()
  $Process.Refresh()
  $code=$Process.ExitCode
  if($null -eq $code -or $code -isnot [int]){throw 'Standard-user child did not provide an integer exit code'}
  return $code
}
try {
  foreach($expected in @(0,7)) {
    $probe=[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes("exit $expected"))
    $process=Start-StandardProcess $probe ('exit-'+$expected)
    try{$observed=Wait-StandardExit $process 30000}finally{$process.Dispose()}
    if($observed -ne $expected){throw "Standard-user exit contract: expected $expected, observed $observed"}
    Write-Output ("Standard-user exit contract: $observed")
  }
  $process=Start-StandardProcess $encoded 'bootstrap'
  try{$exitCode=Wait-StandardExit $process 600000}finally{$process.Dispose()}
  Get-Content (Join-Path $root 'bootstrap.stdout')
  Write-Output ('Standard-user child exit: '+$exitCode)
  if(Test-Path (Join-Path $root 'failed.json')){Get-Content (Join-Path $root 'failed.json')}
  if($exitCode -ne 0 -or !(Test-Path (Join-Path $root 'passed.json'))){Get-Content (Join-Path $root 'bootstrap.stderr');throw 'Standard-user Node bootstrap failed'}
  Get-Content (Join-Path $root 'passed.json')
} finally {
  Remove-LocalUser -Name $identity -ErrorAction SilentlyContinue
  Remove-Item $root -Recurse -Force -ErrorAction SilentlyContinue
}
