# CI-only native standard-user Windows PS5.1 bootstrap. No organization policy bypass.
param([string]$Tarball,[switch]$WaitForArtifact,[string]$PublishedVersion)
if($PublishedVersion -and $PublishedVersion -notmatch '^\d+\.\d+\.\d+$'){throw 'PublishedVersion must be an exact release version'}
$ErrorActionPreference = 'Stop'
$identity = 'mxmx_node_' + [Guid]::NewGuid().ToString('N').Substring(0,6)
$password = [Guid]::NewGuid().ToString('N')+'aA!9'
$secure = ConvertTo-SecureString $password -AsPlainText -Force
$credential = New-Object Management.Automation.PSCredential("$env:COMPUTERNAME\$identity",$secure)
$root = Join-Path $env:PUBLIC ('afbin-node-'+[Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory $root | Out-Null
$diagnostics = if($env:GITHUB_WORKSPACE){Join-Path $env:GITHUB_WORKSPACE 'services/cli/test-results/windows-bootstrap'}else{Join-Path $root 'diagnostics'}
New-Item -ItemType Directory $diagnostics -Force | Out-Null
Copy-Item services/app/public/chat/ensure-node.ps1 (Join-Path $root 'ensure-node.ps1')
Copy-Item services/cli/scripts/windows-setup-registry.mjs (Join-Path $root 'windows-setup-registry.mjs')
Copy-Item services/cli/scripts/windows-bootstrap-candidate.mjs (Join-Path $root 'windows-bootstrap-candidate.mjs')
if (!$Tarball -and !$WaitForArtifact -and !$PublishedVersion) { throw 'Pass the exact npm candidate tarball, wait for this CI run, or verify a published version.' }
if ($Tarball) { Copy-Item $Tarball (Join-Path $root 'candidate.tgz') }
New-LocalUser -Name $identity -Password $secure -PasswordNeverExpires | Out-Null
Add-LocalGroupMember -Group Users -Member $identity
Start-Service seclogon
& icacls.exe $root /grant "${identity}:(OI)(CI)F" | Out-Null
& icacls.exe $diagnostics /grant "${identity}:(OI)(CI)M" | Out-Null
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
  $startedAt=[DateTime]::UtcNow.ToString('o')
  $code=-1
  Write-PhaseEvent 'running' $phase $startedAt 0 -1
  try {
    # PS5.1 emits native stderr as ErrorRecord objects; exit code owns success.
    $ErrorActionPreference='Continue'
    $output=& $Command @Arguments 2>&1
    $code=$LASTEXITCODE
  } finally {
    $ErrorActionPreference=$previous
    $seconds=[Math]::Round($clock.Elapsed.TotalSeconds,1)
    Write-PhaseEvent 'complete' $phase $startedAt $seconds $code
    Write-Host ('Native timing: '+$phase+' '+$seconds.ToString('F1')+'s')
  }
  foreach($record in $output){if($record -is [Management.Automation.ErrorRecord]){Write-Host ('Native stderr: '+$record)}}
  $text=($output | Where-Object {$_ -isnot [Management.Automation.ErrorRecord]} | Out-String)
  Write-Host $text
  if($code -ne 0){throw "$phase failed with exit $code : $text"}
  return $text
}
function Write-PhaseEvent([string]$State,[string]$Name,[string]$StartedAt,[double]$Seconds,[int]$ExitCode) {
  $event=[ordered]@{state=$State;phase=$Name;started_at=$StartedAt;seconds=$Seconds;exit_code=$ExitCode;recorded_at=[DateTime]::UtcNow.ToString('o')}
  $json=$event | ConvertTo-Json -Compress
  $encoding=[Text.UTF8Encoding]::new($false)
  $statePath=Join-Path '__DIAGNOSTICS__' 'phase-state.json'
  $pending=$statePath+'.pending'
  [IO.File]::WriteAllText($pending,$json,$encoding)
  Move-Item $pending $statePath -Force
  $eventsPath=Join-Path '__DIAGNOSTICS__' 'phase-events.jsonl'
  $events=@();if(Test-Path $eventsPath){$events=@(Get-Content $eventsPath -Tail 63)}
  $events+= $json
  $pending=$eventsPath+'.pending'
  [IO.File]::WriteAllLines($pending,[string[]]$events,$encoding)
  Move-Item $pending $eventsPath -Force
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
$publishedVersion='__PUBLISHED_VERSION__'
$helper=if($publishedVersion){Invoke-RestMethod https://app.artifactbin.dev/chat/ensure-node.ps1}else{[IO.File]::ReadAllText('__ROOT__\ensure-node.ps1')}
$ErrorActionPreference='Continue';$ProgressPreference='Continue'
$clock=[Diagnostics.Stopwatch]::StartNew()
Write-Host 'Bootstrap phase: absent Node official bootstrap'
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
$env:npm_config_timing='true'
$rows=Join-Path '__ROOT__' 'rows.csv';[IO.File]::WriteAllText($rows,"amount`n10`n20`n")
$seededCache=[bool]::Parse('__SEEDED_CACHE__')
if(!$seededCache -and (Test-Path $env:npm_config_cache)){throw 'Expected genuinely cold npm cache'}
if(!$publishedVersion){
$phase='wait for exact current-run candidate'
$candidateDeadline=[DateTime]::UtcNow.AddMinutes(3)
while(!(Test-Path '__ROOT__\candidate.tgz')) {
  if([DateTime]::UtcNow -gt $candidateDeadline){throw 'Exact current-run candidate did not arrive'}
  Start-Sleep -Milliseconds 200
}
if($seededCache){
  if(!(Test-Path (Join-Path $env:npm_config_cache '_cacache\_lastverified') -PathType Leaf)){throw 'Expected verified same-run npm dependency seed'}
  # Full packuments match npm view seed entries; misses remain online.
  $env:npm_config_prefer_offline='true'
  $env:npm_config_full_metadata='true'
  Write-Host 'Verified same-run Windows npm dependency seed is active'
}
$phase='standard-user online npx query'
$result=Invoke-Candidate 'npx.cmd' @('--yes','--package','__ROOT__\candidate.tgz','afbin','query',$rows,'--json')
if(!(($result | ConvertFrom-Json | ConvertTo-Json -Depth 10).Contains('10'))){throw 'Standard-user npx candidate query failed'}
}
# Real setup, not a mocked npm runner: the scoped registry serves only the exact
# candidate. Dependencies reuse the validated seed and npm may fetch cache misses online.
$phase='candidate registry startup'
$registry=$null
if(!$publishedVersion){$registry=Start-Process (Join-Path $private 'node.exe') -ArgumentList @('"__ROOT__\windows-setup-registry.mjs"','"__ROOT__\candidate.tgz"','"__ROOT__\registry.json"') -PassThru -RedirectStandardOutput '__ROOT__\registry.stdout' -RedirectStandardError '__ROOT__\registry.stderr'}
try {
  if(!$publishedVersion){
  $deadline=[DateTime]::UtcNow.AddSeconds(15)
  while(!(Test-Path '__ROOT__\registry.json')){
    if($registry.HasExited -or [DateTime]::UtcNow -gt $deadline){throw 'Candidate registry did not become ready'}
    Start-Sleep -Milliseconds 100
  }
  $ready=Get-Content '__ROOT__\registry.json' -Raw | ConvertFrom-Json
  [IO.File]::WriteAllText((Join-Path $env:USERPROFILE '.npmrc'),('@afbin:registry='+$ready.origin+"`n"))
  # The first npx query already installed this exact candidate. Verify its npm
  # provenance before reusing its entry; setup still performs real global npm install.
  $phase='verify npm-owned candidate entry'
  $entry=(Invoke-Candidate (Join-Path $private 'node.exe') @('__ROOT__\windows-bootstrap-candidate.mjs',$env:npm_config_cache,'__ROOT__\candidate.tgz',$ready.version)).Trim()
  $setupCommand=Join-Path $private 'node.exe'
  $setupArgs=@($entry,'setup')
  }else{
    $ready=@{version=$publishedVersion}
    $setupCommand='npx.cmd'
    $setupArgs=@('--yes','@afbin/cli@latest','setup')
  }
  $setupArgs+=@('--harness','claude','--harness','codex','--yes','--json')
  Remove-Item Env:ARTIFACTBIN_SKILLS
  $phase='standard-user setup global and skills'
  $setup=Invoke-Candidate $setupCommand $setupArgs | ConvertFrom-Json
  if($setup.global.status -ne 'installed' -or $setup.global.version -ne $ready.version){throw 'Setup did not globally install the exact candidate'}
  if(!(Test-Path $setup.global.bin)){throw 'npm did not create afbin.cmd'}
  foreach($harness in @('claude','codex')){
    $skill=Join-Path $env:USERPROFILE ('.'+$harness+'\skills\artifactbin')
    $manifest=Get-Content (Join-Path $skill '.afbin-skill.json') -Raw | ConvertFrom-Json
    if($manifest.version -ne $ready.version -or !(Test-Path (Join-Path $skill 'SKILL.md'))){throw 'Setup skill provenance or content missing'}
  }
  # Follow setup's visible PowerShell instruction when npm's prefix is absent
  # from PATH. Never silently inject a test-only prefix or command shim.
  if(!$setup.global.on_path){
    if(!$setup.global.path_line){throw 'Setup omitted durable PATH instruction'}
    Write-Host ('Customer PATH instruction: '+$setup.global.path_line)
    Invoke-Expression $setup.global.path_line
  }
  $phase='repeat setup retains skills'
  # Repeat the real setup command through the exact globally installed shim.
  # Re-running npx with the same tarball adds a second candidate-resolution path
  # without testing setup's idempotency any better.
  $repeat=Invoke-Candidate $setup.global.bin @('setup','--harness','claude','--harness','codex','--yes','--json') | ConvertFrom-Json
  if($repeat.global.status -ne 'installed' -or @($repeat.installations | Where-Object {$_.status -ne 'unchanged'}).Count -ne 0){throw 'Repeat setup changed current skills or failed global installation'}
  # A genuinely new PowerShell process reconstructs Windows' persistent PATH;
  # prove the global shim, policy, version and local SQL without npx cache lookup.
  $phase='fresh-shell global afbin.cmd'
  $fresh=@(
    '$ErrorActionPreference=''Stop'''
    '$env:PATH=[Environment]::GetEnvironmentVariable(''PATH'',''Machine'')+'';''+[Environment]::GetEnvironmentVariable(''PATH'',''User'')'
    'if((Get-ExecutionPolicy) -ne ''Restricted''){throw ''Fresh shell policy changed''}'
    '$command=(Get-Command afbin.cmd -CommandType Application).Source'
    'if($command -ne ''__BIN__''){throw ''Fresh shell resolved a different afbin command''}'
    '$version=& afbin.cmd --version --json'
    'if($LASTEXITCODE -ne 0 -or ($version | ConvertFrom-Json).version -ne ''__VERSION__''){throw ''Fresh shell afbin version failed''}'
    '$query=& afbin.cmd query ''__ROWS__'' --json'
    'if($LASTEXITCODE -ne 0 -or !(($query | ConvertFrom-Json | ConvertTo-Json -Depth 10).Contains(''10''))){throw ''Fresh shell SQL failed''}'
    'Write-Output ''PASS fresh-shell global version and local SQL'''
  ) -join "`n"
  $fresh=$fresh.Replace('__BIN__',$setup.global.bin.Replace("'","''")).Replace('__VERSION__',$ready.version).Replace('__ROWS__',$rows.Replace("'","''"))
  $freshEncoded=[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($fresh))
  Invoke-Candidate "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" @('-NoProfile','-EncodedCommand',$freshEncoded) | Out-Null
} finally {
  if($registry){if(!$registry.HasExited){$registry.Kill();$registry.WaitForExit()};$registry.Dispose()}
}
# Warmed offline/native behavior is proved by both Windows native matrix versions.
[IO.File]::WriteAllText('__ROOT__\passed.json','{"status":"passed","checks":["standard-user","restricted-policy","absent-node","official-archive-checksum","npm-npx","repeat","broken-npm-repair","current-future-path","native-stderr-contract","real-global-setup","claude-codex-skills","repeat-setup","customer-path-instruction","fresh-shell-global-version-sql"]}')
'@
$child=$child.Replace('__ROOT__',$root.Replace("'","''"))
$child=$child.Replace('__DIAGNOSTICS__',$diagnostics.Replace("'","''"))
$child=$child.Replace('__PUBLISHED_VERSION__',$PublishedVersion)
$child=$child.Replace('__SEEDED_CACHE__',[string]$WaitForArtifact)
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
function Write-StandardOutput([string]$Path,[ref]$Printed) {
  if (!$Path -or !(Test-Path $Path)) { return }
  $lines=@(Get-Content $Path)
  while($Printed.Value -lt $lines.Count) {
    Write-Host $lines[$Printed.Value]
    $Printed.Value++
  }
}
function Write-StandardFailure {
  # Only owned child diagnostics: bounded output, with inherited runner secrets removed.
  foreach($name in @('failed.json','bootstrap.stdout','bootstrap.stderr','registry.stderr')) {
    $path=Join-Path $root $name
    if(!(Test-Path $path)){continue}
    try {
      $text=(Get-Content $path -Tail 60 | Out-String)
      foreach($secret in @($password,$env:GH_TOKEN)) {
        if($secret){$text=$text.Replace($secret,'[redacted]')}
      }
      if($text.Length -gt 8192){$text=$text.Substring(0,8192)+'[truncated]'}
      Write-Host ('Standard-user child diagnostic: '+$name)
      Write-Host $text
    } catch { Write-Host ('Could not read standard-user child diagnostic: '+$name) }
  }
}
function Write-NpmTimingTail {
  $directory=Join-Path $root 'npm-cache\_logs'
  if(!(Test-Path $directory)){return}
  $module=Join-Path $PSScriptRoot 'npm-consumer-args.mjs'
  $text=& node $module diagnostic-timings $directory 2>$null
  if($LASTEXITCODE -ne 0 -or !$text){return}
  try{$timings=$text | ConvertFrom-Json}catch{return}
  $safe=@()
  foreach($timer in $timings.PSObject.Properties){
    $name=[string]$timer.Name;$value=$timer.Value
    if($value -is [bool] -or $value -isnot [ValueType]){continue}
    try{$milliseconds=[double]$value}catch{continue}
    if([double]::IsNaN($milliseconds) -or [double]::IsInfinity($milliseconds) -or $milliseconds -lt 0 -or $milliseconds -gt 86400000){continue}
    $safe+=('npm timing '+$name+' Completed in '+([Math]::Round($milliseconds,0).ToString([Globalization.CultureInfo]::InvariantCulture))+'ms')
  }
  if(!$safe.Count){return}
  $path=Join-Path $diagnostics 'npm-timings.txt';$pending=$path+'.pending'
  [IO.File]::WriteAllLines($pending,[string[]]$safe,[Text.UTF8Encoding]::new($false))
  Move-Item $pending $path -Force
  if(!$script:seenNpmTiming){$script:seenNpmTiming=@{}}
  foreach($line in $safe){if(!$script:seenNpmTiming.ContainsKey($line)){$script:seenNpmTiming[$line]=$true;Write-Host ('Npm timing: '+$line)}}
}
function Write-CurrentPhase {
  $path=Join-Path $diagnostics 'phase-state.json'
  if(!(Test-Path $path)){return $false}
  try{
    $state=Get-Content $path -Raw | ConvertFrom-Json
    if($state.state -ne 'running'){return $false}
    if($state.phase -notmatch '^[A-Za-z0-9 -]{1,80}$'){return $false}
    $start=[DateTime]::Parse($state.started_at).ToUniversalTime()
    $seconds=[Math]::Max(0,([DateTime]::UtcNow-$start).TotalSeconds)
    $line='Standard-user phase still running: '+$state.phase+' '+$seconds.ToString('F1')+'s'
    $path=Join-Path $diagnostics 'phase-heartbeat.txt';$pending=$path+'.pending'
    [IO.File]::WriteAllText($pending,$line,[Text.UTF8Encoding]::new($false))
    Move-Item $pending $path -Force
    Write-Host $line
    return $true
  }catch{return $false}
}
function Wait-StandardExit([Diagnostics.Process]$Process,[int]$Timeout,[string]$OutputPath='') {
  $clock=[Diagnostics.Stopwatch]::StartNew();$printed=0;$heartbeat=15
  while(!$Process.WaitForExit(1000)) {
    Write-StandardOutput $OutputPath ([ref]$printed)
    if($clock.ElapsedMilliseconds -ge $Timeout){throw 'Standard-user child timed out'}
    if($OutputPath -and $clock.Elapsed.TotalSeconds -ge $heartbeat) {
      if(!(Write-CurrentPhase)){Write-Host ('Standard-user child still running: '+$clock.Elapsed.TotalSeconds.ToString('F1')+'s')}
      Write-NpmTimingTail
      $heartbeat+=15
    }
  }
  Write-StandardOutput $OutputPath ([ref]$printed)
  Write-NpmTimingTail
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
  try {
    if($WaitForArtifact) {
      # This parent uses the runner's existing Node/gh. The child still proves an empty PATH
      # and installs official Node as its own fresh non-admin user while packaging runs.
      $archive=Join-Path $root 'candidate.zip'
      & node scripts/lib/ci-artifact-wait.mjs $env:GITHUB_REPOSITORY $env:GITHUB_RUN_ID $env:GITHUB_RUN_ATTEMPT $archive (Join-Path $root 'failed.json')
      if($LASTEXITCODE -ne 0){Write-StandardFailure;throw 'Waiting for exact current-run package failed'}
      $download=Join-Path $root 'download'
      Expand-Archive -Path $archive -DestinationPath $download
      $candidates=@(Get-ChildItem $download -Filter '*.tgz')
      if($candidates.Count -ne 1){throw 'Expected one exact current-run npm candidate'}
      # Restore the exact-platform seed while the child waits for candidate.tgz. The shared
      # helper enforces current-attempt identity and the archive digest; merge-seed validates
      # the public dependency graph before creating the ACL-inheriting consumer cache.
      $seedName='afbin-npm-dependency-seed-Windows-X64'
      $seedZip=Join-Path $root 'npm-dependency-seed.zip'
      & node scripts/lib/ci-artifact-wait.mjs $env:GITHUB_REPOSITORY $env:GITHUB_RUN_ID $env:GITHUB_RUN_ATTEMPT $seedZip (Join-Path $root 'failed.json') $seedName
      if($LASTEXITCODE -ne 0){Write-StandardFailure;throw 'Waiting for exact current-run Windows npm seed failed'}
      $seedDownload=Join-Path $root 'npm-dependency-seed'
      Expand-Archive -Path $seedZip -DestinationPath $seedDownload
      $seeds=@(Get-ChildItem $seedDownload -Filter 'npm-dependency-seed-Windows-X64.tar' -File -Recurse)
      if($seeds.Count -ne 1){throw 'Expected one exact current-run Windows npm seed'}
      $cache=Join-Path $root 'npm-cache'
      & node scripts/lib/npm-dependency-cache.mjs merge-seed $seeds[0].FullName $cache Windows X64
      if($LASTEXITCODE -ne 0){throw 'Current-run Windows npm dependency seed failed validation'}
      # Publish only a complete file to the waiting child.
      Copy-Item $candidates[0].FullName (Join-Path $root 'candidate.pending')
      Move-Item (Join-Path $root 'candidate.pending') (Join-Path $root 'candidate.tgz')
    }
    $exitCode=Wait-StandardExit $process 360000 (Join-Path $root 'bootstrap.stdout')
  } finally {
    if(!$process.HasExited){$process.Kill();$process.WaitForExit()}
    $process.Dispose()
  }
  Write-Output ('Standard-user child exit: '+$exitCode)
  if(Test-Path (Join-Path $root 'failed.json')){Get-Content (Join-Path $root 'failed.json')}
  if($exitCode -ne 0 -or !(Test-Path (Join-Path $root 'passed.json'))){Get-Content (Join-Path $root 'bootstrap.stderr');throw 'Standard-user Node bootstrap failed'}
  Get-Content (Join-Path $root 'passed.json')
} finally {
  Remove-LocalUser -Name $identity -ErrorAction SilentlyContinue
  Remove-Item $root -Recurse -Force -ErrorAction SilentlyContinue
}
