# Compatibility URL: npm is the only supported afbin distribution.
$ErrorActionPreference = 'Stop'
$Version = '0.4.0'
$Origin = 'https://app.artifactbin.dev'
Invoke-RestMethod "$Origin/chat/ensure-node.ps1" | Invoke-Expression
npx.cmd --yes @afbin/cli@latest setup --server $Origin
if ($LASTEXITCODE -ne 0) { throw 'afbin npm setup failed.' }
