# CI-only disposable standard user. No credential is printed or persisted.
$ErrorActionPreference = 'Stop'
$name = 'mxmx_test_windows'
$password = ConvertTo-SecureString ('aA1!'+[Guid]::NewGuid().ToString()+[Guid]::NewGuid().ToString()) -AsPlainText -Force
$sandbox = Join-Path $env:PUBLIC ('afbin-research-'+[Guid]::NewGuid().ToString())
New-Item -ItemType Directory $sandbox | Out-Null
$user = New-LocalUser -Name $name -Password $password -PasswordNeverExpires
try {
  Add-LocalGroupMember -Group 'Users' -Member $name
  Start-Service seclogon
  $sid = $user.SID.Value
  & "$env:SystemRoot\System32\icacls.exe" $env:GITHUB_WORKSPACE /grant "*${sid}:(OI)(CI)M" /T /Q | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Could not grant disposable workspace access' }
  & "$env:SystemRoot\System32\icacls.exe" $sandbox /grant "*${sid}:(OI)(CI)F" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Could not grant isolated test directory access' }
  $credential = New-Object Management.Automation.PSCredential("$env:COMPUTERNAME\$name",$password)
  $out = Join-Path $env:GITHUB_WORKSPACE '.agent/windows-evidence'
  New-Item -ItemType Directory -Force $out | Out-Null
  $node = (Get-Command node.exe).Source
  $child = Start-Process -FilePath $node -ArgumentList @('services/cli/scripts/test-windows.mjs', $sandbox) -WorkingDirectory $env:GITHUB_WORKSPACE -Credential $credential -LoadUserProfile -Wait -PassThru -RedirectStandardOutput (Join-Path $out 'standard-user.log') -RedirectStandardError (Join-Path $out 'standard-user-error.log')
  Get-Content (Join-Path $out 'standard-user.log')
  Get-Content (Join-Path $out 'standard-user-error.log')
  if ($child.ExitCode -ne 0) { throw "Standard-user acceptance failed with exit $($child.ExitCode)" }
} finally { Remove-LocalUser -Name $name; Remove-Item -LiteralPath $sandbox -Recurse -Force -ErrorAction SilentlyContinue }
