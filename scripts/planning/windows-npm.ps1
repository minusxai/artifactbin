# CI-only disposable standard user. No credential is printed or persisted.
$ErrorActionPreference = 'Stop'
$name = 'mxmx_test_npm'
$password = ConvertTo-SecureString ('aA1!'+[Guid]::NewGuid().ToString()+[Guid]::NewGuid().ToString()) -AsPlainText -Force
# Keep native DLL paths below MAX_PATH while the child still exercises spaces and Unicode.
$sandbox = Join-Path $env:PUBLIC ('afbin-ci-'+[Guid]::NewGuid().ToString('N').Substring(0,8))
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
  $out = Join-Path $env:GITHUB_WORKSPACE '.agent/windows-npm-evidence'
  New-Item -ItemType Directory -Force $out | Out-Null
  $node = (Get-Command node.exe).Source
  $child = Start-Process -FilePath $node -ArgumentList @('scripts/planning/windows-npm.mjs', $sandbox) -WorkingDirectory $env:GITHUB_WORKSPACE -Credential $credential -LoadUserProfile -PassThru -RedirectStandardOutput (Join-Path $out 'standard-user.log') -RedirectStandardError (Join-Path $out 'standard-user-error.log')
  # Start-Process -Wait waits for every descendant, including detached helpers. Wait for the test
  # itself, emit its progress, and bound the wait; cleanup below owns only this disposable identity.
  $watch = [Diagnostics.Stopwatch]::StartNew()
  $printed = 0
  while (!$child.WaitForExit(2000)) {
    $lines = @(Get-Content (Join-Path $out 'standard-user.log') -ErrorAction SilentlyContinue)
    if ($lines.Count -gt $printed) { $lines[$printed..($lines.Count-1)]; $printed=$lines.Count }
    if ($watch.Elapsed.TotalMinutes -gt 18) {
      & "$env:SystemRoot\System32\taskkill.exe" /PID $child.Id /T /F | Out-Null
      throw 'Standard-user test exceeded 18 minutes; inspect its progress log'
    }
  }
  Get-Content (Join-Path $out 'standard-user.log')
  Get-Content (Join-Path $out 'standard-user-error.log')
  if ($child.ExitCode -ne 0) { throw "Standard-user acceptance failed with exit $($child.ExitCode)" }
  if ((Get-Content (Join-Path $out 'results.json') -Raw | ConvertFrom-Json).status -ne 'passed') { throw 'No passing native acceptance receipt' }
} finally {
  & "$env:SystemRoot\System32\taskkill.exe" /F /FI "USERNAME eq $env:COMPUTERNAME\$name" 2>$null | Out-Null
  Remove-LocalUser -Name $name
  Remove-Item -LiteralPath $sandbox -Recurse -Force -ErrorAction SilentlyContinue
}
