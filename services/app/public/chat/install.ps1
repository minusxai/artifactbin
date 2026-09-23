# Install afbin for the current user. PowerShell 5.1 or newer; no administrator or Node required.
[CmdletBinding()]
param(
  [string]$Version = '0.1.61',
  [string]$Dir = (Join-Path $env:LOCALAPPDATA 'artifactbin\bin'),
  [switch]$Yes,
  [string[]]$Harness
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$Origin = 'https://app.artifactbin.dev'
$ReleaseRoot = 'https://github.com/minusxai/artifactbin/releases/download'
if ($env:OS -ne 'Windows_NT' -or ![Environment]::Is64BitOperatingSystem -or $env:PROCESSOR_ARCHITECTURE -eq 'ARM64' -or $env:PROCESSOR_ARCHITEW6432 -eq 'ARM64') { throw 'This installer supports Windows x64. ARM64 is not supported yet.' }
if ($Version -notmatch '^\d+\.\d+\.\d+$') { throw 'Version must have the form X.Y.Z.' }
$Dir = [IO.Path]::GetFullPath($Dir)
$base = "$ReleaseRoot/afbin-v$Version"
$staging = Join-Path ([IO.Path]::GetTempPath()) ('afbin-install-'+[Guid]::NewGuid().ToString())
$stagedExe = $null
New-Item -ItemType Directory $staging | Out-Null
function Get-CheckedHash([string]$Name, [string]$Checksums) {
  $matches = [regex]::Matches($Checksums, '(?m)^([a-f0-9]{64})  '+[regex]::Escape($Name)+'\r?$')
  if ($matches.Count -ne 1) { throw "Missing or duplicate checksum for $Name" }
  return $matches[0].Groups[1].Value
}
try {
  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
  $sumFile = Join-Path $staging 'SHA256SUMS'
  Invoke-WebRequest -UseBasicParsing "$base/SHA256SUMS" -OutFile $sumFile
  $checksums = Get-Content -LiteralPath $sumFile -Raw -Encoding UTF8
  $asset = 'afbin-win32-x64.exe'
  $rawHash = Get-CheckedHash $asset $checksums
  $gzipHash = Get-CheckedHash "$asset.gz" $checksums
  $gzipPath = Join-Path $staging "$asset.gz"
  Invoke-WebRequest -UseBasicParsing "$base/$asset.gz" -OutFile $gzipPath
  if ((Get-FileHash -LiteralPath $gzipPath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $gzipHash) { throw 'Checksum mismatch; existing installation unchanged.' }
  $download = Join-Path $staging $asset
  $inputFile = [IO.File]::OpenRead($gzipPath)
  try {
    $gzip = New-Object IO.Compression.GzipStream($inputFile, [IO.Compression.CompressionMode]::Decompress)
    try { $outputFile = [IO.File]::Create($download); try { $gzip.CopyTo($outputFile) } finally { $outputFile.Dispose() } } finally { $gzip.Dispose() }
  } finally { $inputFile.Dispose() }
  if ((Get-FileHash -LiteralPath $download -Algorithm SHA256).Hash.ToLowerInvariant() -ne $rawHash) { throw 'Checksum mismatch; existing installation unchanged.' }
  $reported = & $download --version --json | ConvertFrom-Json
  if ($LASTEXITCODE -ne 0 -or $reported.version -ne $Version) { throw 'Downloaded executable does not match the requested release.' }
  # Reject reparse points throughout the installation path before changing permissions or files.
  for ($parent = $Dir; $parent; $parent = [IO.Path]::GetDirectoryName($parent)) {
    if ((Test-Path -LiteralPath $parent) -and ((Get-Item -LiteralPath $parent -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Refusing a linked installation directory.' }
  }
  New-Item -ItemType Directory -Force $Dir | Out-Null
  # Write only access rules; preserving an entire descriptor can require admin audit privileges.
  $acl = New-Object Security.AccessControl.DirectorySecurity
  $acl.SetAccessRuleProtection($true, $false)
  foreach ($sid in @([Security.Principal.WindowsIdentity]::GetCurrent().User, (New-Object Security.Principal.SecurityIdentifier('S-1-5-18')))) {
    $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow')))
  }
  if ($PSVersionTable.PSVersion.Major -ge 7) { [IO.FileSystemAclExtensions]::SetAccessControl([IO.DirectoryInfo]::new($Dir), $acl) }
  else { [IO.Directory]::SetAccessControl($Dir, $acl) }
  $exe = Join-Path $Dir 'afbin.exe'
  if (Get-Process -Name afbin -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $exe }) { throw 'Close all afbin processes and rerun this installer; the existing executable is unchanged.' }
  if ((Test-Path -LiteralPath $exe) -and ((Get-Item -LiteralPath $exe -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Refusing a linked executable.' }
  $stagedExe = Join-Path $Dir ('afbin-'+[Guid]::NewGuid().ToString()+'.exe')
  Copy-Item -LiteralPath $download -Destination $stagedExe
  try {
    if (Test-Path -LiteralPath $exe) { [IO.File]::Replace($stagedExe, $exe, [System.Management.Automation.Language.NullString]::Value) }
    else { [IO.File]::Move($stagedExe, $exe) }
  } catch { throw ('Could not replace afbin. Close all afbin processes and rerun this installer; the existing executable is unchanged. ' + $_.Exception.Message) }
  $userPath = [Environment]::GetEnvironmentVariable('Path','User')
  $parts = @($userPath -split ';' | Where-Object { $_ -and $_.TrimEnd('\') -ine $Dir.TrimEnd('\') })
  [Environment]::SetEnvironmentVariable('Path', (($parts + $Dir) -join ';'), 'User')
  $env:Path = "$Dir;$env:Path"
  & $exe config set host $Origin --json
  if ($LASTEXITCODE -ne 0) { throw 'Installed executable could not save its host configuration.' }
  $setupArgs = @('setup','--server',$Origin)
  if ($Yes -or [Console]::IsInputRedirected) { $setupArgs += '--yes' }
  foreach ($name in $Harness) { $setupArgs += @('--harness',$name) }
  & $exe @setupArgs
  if ($LASTEXITCODE -ne 0) { throw 'afbin installed, but skill setup failed. Run afbin setup to retry.' }
  Write-Output "Installed afbin $Version in $Dir. Open a new terminal to use afbin."
  Write-Output 'For upgrades, close afbin and rerun this installer. Automatic updates are disabled on Windows.'
  if (!$Yes -and ![Console]::IsInputRedirected) {
    & $exe auth --server $Origin
    if ($LASTEXITCODE -ne 0) { Write-Warning 'Sign-in is incomplete. Run afbin auth when ready.' }
  }
} finally {
  if ($stagedExe -and (Test-Path -LiteralPath $stagedExe)) { Remove-Item -LiteralPath $stagedExe -Force }
  Remove-Item -LiteralPath $staging -Recurse -Force
}
