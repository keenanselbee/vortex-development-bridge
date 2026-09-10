[CmdletBinding()]
param([string]$Repo = '', [switch]$Save, [switch]$LoginOnly, [string]$BackupPath = '', [string]$Chrome = '', [int]$Port = 9347)
$ErrorActionPreference = 'Stop'
if (-not $Repo) { $Repo = Split-Path -Parent $PSScriptRoot }
$arguments = @((Join-Path $PSScriptRoot 'nexus.js'), 'descriptions', '--repo', $Repo, '--port', [string]$Port)
if ($Save) { $arguments += '--save' }
if ($LoginOnly) { $arguments += '--login' }
if ($BackupPath) { $arguments += @('--backup', $BackupPath) }
if ($Chrome) { $arguments += @('--chrome', $Chrome) }
& node @arguments
if ($LASTEXITCODE -ne 0) { throw 'Nexus description operation failed; inspect the saved progress and backup.' }
