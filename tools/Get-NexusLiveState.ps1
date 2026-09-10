[CmdletBinding()]
param([string]$Repo = '')
$ErrorActionPreference = 'Stop'
if (-not $Repo) { $Repo = Split-Path -Parent $PSScriptRoot }
& node (Join-Path $PSScriptRoot 'nexus.js') status --repo $Repo
if ($LASTEXITCODE -ne 0) { throw 'Nexus status failed.' }
