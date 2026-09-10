[CmdletBinding()]
param([string]$Repo = '', [string]$ArchivePath = '', [string]$PlanPath = '', [switch]$Publish, [switch]$Offline, [switch]$CreateFile)
$ErrorActionPreference = 'Stop'
if (-not $Repo) { $Repo = Split-Path -Parent $PSScriptRoot }
$arguments = @((Join-Path $PSScriptRoot 'nexus.js'))
if ($Publish) {
    $arguments += @('publish', '--publish', '--repo', $Repo)
} else {
    $arguments += @('prepare', '--repo', $Repo)
    if ($ArchivePath) { $arguments += @('--archive', $ArchivePath) }
    if ($Offline) { $arguments += '--offline' }
    if ($CreateFile) { $arguments += '--create-file' }
}
if ($PlanPath) { $arguments += @('--plan', $PlanPath) }
& node @arguments
if ($LASTEXITCODE -ne 0) { throw 'Nexus release operation failed; inspect the plan/journal before retrying.' }
