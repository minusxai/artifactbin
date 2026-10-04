# Run inline with Invoke-Expression. Supports standard-user PowerShell 5.1 Restricted policy.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
# Read the current PATH files in order so repeated repair checks do not depend
# on command discovery state from an earlier broken npm.cmd.
function Resolve-AfbinApplication([string]$Name) {
  foreach ($entry in ($env:PATH -split ';')) {
    $directory = [Environment]::ExpandEnvironmentVariables($entry.Trim().Trim('"'))
    if (!$directory) { continue }
    $candidate = Join-Path $directory $Name
    if ([IO.File]::Exists($candidate)) { return $candidate }
  }
  throw "Missing $Name on PATH."
}
function Test-AfbinNode {
  try {
    $node = Resolve-AfbinApplication 'node.exe'
    & $node -e 'const [a,b]=process.versions.node.split(String.fromCharCode(46)).map(Number);process.exit(a>22||a===22&&b>=13?0:1)' 2>$null
    if ($LASTEXITCODE -ne 0) { return $false }
    foreach ($name in @('npm.cmd','npx.cmd')) {
      $command = Resolve-AfbinApplication $name
      $null = & $command --version 2>$null
      if ($LASTEXITCODE -ne 0) { return $false }
    }
    return $true
  } catch { return $false }
}
if (Test-AfbinNode) { Write-Host 'Node and npm/npx are ready.'; return }
if ($env:OS -ne 'Windows_NT' -or ![Environment]::Is64BitOperatingSystem) { throw 'Requires Windows x64 or ARM64. Install Node LTS: https://nodejs.org/en/download' }
$version = '24.21.0'
$arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64' -or $env:PROCESSOR_ARCHITEW6432 -eq 'ARM64') { 'arm64' } else { 'x64' }
$destination = Join-Path $env:LOCALAPPDATA "artifactbin\node-v$version-win-$arch"
$env:PATH = "$destination;$env:PATH"
if (!(Test-AfbinNode)) {
  $stage = Join-Path ([IO.Path]::GetTempPath()) ('afbin-node-'+[Guid]::NewGuid().ToString())
  [IO.Directory]::CreateDirectory($stage) | Out-Null
  try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    $file = "node-v$version-win-$arch.zip"
    $client = New-Object Net.WebClient
    try { $sums = $client.DownloadString("https://nodejs.org/dist/v$version/SHASUMS256.txt"); $client.DownloadFile("https://nodejs.org/dist/v$version/$file", (Join-Path $stage $file)) } finally { $client.Dispose() }
    $matches = [regex]::Matches($sums, '(?m)^([a-f0-9]{64})  '+[regex]::Escape($file)+'\r?$')
    if ($matches.Count -ne 1) { throw 'Missing or duplicate official Node checksum.' }
    $stream = [IO.File]::OpenRead((Join-Path $stage $file)); $sha = [Security.Cryptography.SHA256]::Create()
    try { $hash = ([BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-','').ToLowerInvariant() } finally { $stream.Dispose(); $sha.Dispose() }
    if ($hash -ne $matches[0].Groups[1].Value) { throw 'Node checksum verification failed.' }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [IO.Compression.ZipFile]::ExtractToDirectory((Join-Path $stage $file), $stage)
    $unpacked = Join-Path $stage "node-v$version-win-$arch"
    & (Join-Path $unpacked 'node.exe') --version
    if ($LASTEXITCODE -ne 0) { throw 'Downloaded Node cannot run.' }
    [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($destination)) | Out-Null
    if ([IO.Directory]::Exists($destination)) { [IO.Directory]::Delete($destination,$true) }
    [IO.Directory]::Move($unpacked,$destination)
    if (!(Test-AfbinNode)) { throw 'Node installed but npm/npx could not run.' }
  } catch { throw "Node setup failed: $_ Install Node LTS: https://nodejs.org/en/download" }
  finally { if ([IO.Directory]::Exists($stage)) { [IO.Directory]::Delete($stage,$true) } }
}
$userPath = [Environment]::GetEnvironmentVariable('PATH','User')
if (!(@($userPath -split ';') -contains $destination)) { [Environment]::SetEnvironmentVariable('PATH', "$destination;$userPath", 'User') }
Write-Host 'Node and npm/npx are ready. Next: npx.cmd --yes @artifactbin/cli@latest setup'
