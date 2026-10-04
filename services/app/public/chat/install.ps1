# Compatibility URL: npm is the only supported afbin distribution.
$ErrorActionPreference = 'Stop'
$Version = '0.4.0'
Invoke-RestMethod https://app.artifactbin.dev/chat/ensure-node.ps1 | Invoke-Expression
npx.cmd --yes @artifactbin/cli@latest setup
if ($LASTEXITCODE -ne 0) { throw 'afbin npm setup failed.' }
