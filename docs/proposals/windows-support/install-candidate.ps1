# Research installer: verifies a disposable Windows candidate. Not a published installer.
[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$ReleaseBase,[Parameter(Mandatory=$true)][string]$InstallDir,[Parameter(Mandatory=$true)][string]$StateDir)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$release = [Uri]$ReleaseBase
if ($release.Scheme -ne 'https' -and !($release.Scheme -eq 'http' -and $release.IsLoopback)) { throw 'HTTPS or local research server required' }
$staging = Join-Path ([IO.Path]::GetTempPath()) ([Guid]::NewGuid().ToString())
New-Item -ItemType Directory $staging | Out-Null
try {
  $checksumFile = Join-Path $staging 'SHA256SUMS'
  Write-Output "Downloading candidate component"
  Invoke-WebRequest -UseBasicParsing "$ReleaseBase/SHA256SUMS" -OutFile $checksumFile
  $checksums = Get-Content -LiteralPath $checksumFile -Raw -Encoding UTF8
  $match = [regex]::Match($checksums, '(?m)^([a-f0-9]{64})  afbin-win32-x64\.exe\r?$')
  if (!$match.Success) { throw 'Missing Windows checksum' }
  $download = Join-Path $staging 'afbin.exe'
  Write-Output "Downloading candidate component"
  Invoke-WebRequest -UseBasicParsing "$ReleaseBase/afbin-win32-x64.exe" -OutFile $download
  if ((Get-FileHash -LiteralPath $download -Algorithm SHA256).Hash.ToLowerInvariant() -ne $match.Groups[1].Value) { throw 'Checksum mismatch; existing installation unchanged' }
  Write-Output "Checksum verified; preparing private directories"
  New-Item -ItemType Directory -Force $InstallDir,$StateDir | Out-Null
  foreach ($dir in @($InstallDir,$StateDir)) {
    if ((Get-Item -LiteralPath $dir).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Refusing a linked directory' }
    $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    & "$env:SystemRoot\System32\icacls.exe" $dir /inheritance:r /grant:r "*${sid}:(OI)(CI)F" '*S-1-5-18:(OI)(CI)F' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Private directory ACL failed' }
  }
  $exe = Join-Path $InstallDir 'afbin.exe'
  # Explicit reinstall only, with no running afbin process. Copy failure preserves the surfaced error.
  $stagedExe = Join-Path $InstallDir ('afbin.'+[Guid]::NewGuid().ToString()+'.exe')
  Copy-Item -LiteralPath $download -Destination $stagedExe
  Move-Item -LiteralPath $stagedExe -Destination $exe -Force
  $env:ARTIFACTBIN_HOME = $StateDir
  Write-Output "Executable installed; writing initial configuration"
  & $exe config set updates false --json
  if ($LASTEXITCODE -ne 0) { throw 'CLI initial configuration failed' }
  $userPath = [Environment]::GetEnvironmentVariable('Path','User')
  $parts = @($userPath -split ';' | Where-Object { $_ -and $_.TrimEnd('\') -ine $InstallDir.TrimEnd('\') })
  [Environment]::SetEnvironmentVariable('Path', (($parts + $InstallDir) -join ';'),'User')
  $env:Path = "$InstallDir;$env:Path"
  Write-Output "Installed afbin; open a new terminal to use the updated user PATH."
} finally { Remove-Item -LiteralPath $staging -Recurse -Force }
