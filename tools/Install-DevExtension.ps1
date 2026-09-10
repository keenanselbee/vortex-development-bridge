[CmdletBinding()]
param([switch]$Install, [string]$VortexPluginsRoot = '')
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$build = Get-Content -LiteralPath (Join-Path $repoRoot 'dist\latest.json') -Raw | ConvertFrom-Json
if (-not $VortexPluginsRoot) {
    if (-not $env:APPDATA) { throw 'APPDATA is unavailable. Specify VortexPluginsRoot.' }
    $VortexPluginsRoot = Join-Path $env:APPDATA 'Vortex\plugins'
}
$pluginsRoot = [IO.Path]::GetFullPath($VortexPluginsRoot).TrimEnd('\')
$target = [IO.Path]::GetFullPath((Join-Path $pluginsRoot 'vortex-development-bridge'))
if (-not $target.StartsWith($pluginsRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Install target escapes the plugins root.' }
$source = Join-Path $build.run 'extension'
foreach ($entry in $build.files) {
    $sourceFile = [IO.Path]::GetFullPath((Join-Path $source $entry.path))
    if (-not $sourceFile.StartsWith([IO.Path]::GetFullPath($source).TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Build receipt contains an unsafe path.' }
    if ((Get-FileHash -LiteralPath $sourceFile -Algorithm SHA256).Hash.ToLowerInvariant() -ne $entry.sha256) { throw "Build output changed: $($entry.path)" }
}
if (-not $Install) {
    [pscustomobject]@{ Mode = 'Preview'; Version = $build.version; Source = $source; Target = $target; Files = $build.files.Count; RequiresVortexRestart = $true }
    return
}
if (Get-Process -Name Vortex -ErrorAction SilentlyContinue) { throw 'Close Vortex before replacing its development extension.' }
$existing = @(Get-ChildItem -LiteralPath $pluginsRoot -Directory -ErrorAction SilentlyContinue | Where-Object {
    $infoPath = Join-Path $_.FullName 'info.json'
    if (Test-Path -LiteralPath $infoPath) {
        try { (Get-Content -LiteralPath $infoPath -Raw | ConvertFrom-Json).name -eq 'Vortex Development Bridge' } catch { $false }
    }
})
if ($existing | Where-Object { $_.FullName -ne $target }) { throw 'Another VDB installation exists. Review it before using the development installer.' }
$backup = Join-Path $repoRoot ('.codex-temp\extension-installs\' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $backup | Out-Null
if (Test-Path -LiteralPath $target) {
    $infoPath = Join-Path $target 'info.json'
    if (-not (Test-Path -LiteralPath $infoPath) -or (Get-Content -LiteralPath $infoPath -Raw | ConvertFrom-Json).name -ne 'Vortex Development Bridge') { throw 'Target is not an existing VDB extension.' }
    Copy-Item -LiteralPath $target -Destination (Join-Path $backup 'before') -Recurse
    throw "Existing installation backed up to $backup. Use Vortex's Extensions screen to upgrade; this installer only creates new development installations."
}
New-Item -ItemType Directory -Force -Path $target | Out-Null
foreach ($entry in $build.files) {
    $destination = [IO.Path]::GetFullPath((Join-Path $target $entry.path))
    if (-not $destination.StartsWith($target + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Install output escapes target.' }
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $destination) | Out-Null
    Copy-Item -LiteralPath (Join-Path $source $entry.path) -Destination $destination
    if ((Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant() -ne $entry.sha256) { throw "Installed file differs: $($entry.path)" }
}
[pscustomobject]@{ Installed = $target; Version = $build.version; RestartVortex = $true } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $backup 'receipt.json') -Encoding UTF8
Write-Output "Installed $target. Restart Vortex to load it."
