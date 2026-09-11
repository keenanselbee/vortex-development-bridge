[CmdletBinding()]
param([switch]$Install, [switch]$UpdateExisting, [string]$VortexPluginsRoot = '')
$ErrorActionPreference = 'Stop'

function Assert-ContainedPath {
    param([string]$Root, [string]$Path, [string]$Message)
    $fullRoot = [IO.Path]::GetFullPath($Root).TrimEnd('\')
    $fullPath = [IO.Path]::GetFullPath($Path)
    if (-not $fullPath.StartsWith($fullRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { throw $Message }
    return $fullPath
}

function Get-FileInventory {
    param([string]$Root)
    $fullRoot = [IO.Path]::GetFullPath($Root).TrimEnd('\')
    $inventory = @{}
    foreach ($file in Get-ChildItem -LiteralPath $fullRoot -Recurse -File -Force) {
        $fullPath = [IO.Path]::GetFullPath($file.FullName)
        $relative = $fullPath.Substring($fullRoot.Length + 1).Replace('\', '/')
        $inventory[$relative] = (Get-FileHash -LiteralPath $fullPath -Algorithm SHA256).Hash.ToLowerInvariant()
    }
    return $inventory
}

function Test-FileInventory {
    param([string]$Root, [hashtable]$Expected)
    $actual = Get-FileInventory -Root $Root
    if ($actual.Count -ne $Expected.Count) { throw "Installed file inventory differs: expected $($Expected.Count) files, found $($actual.Count)." }
    foreach ($relative in $Expected.Keys) {
        if (-not $actual.ContainsKey($relative)) { throw "Installed file is missing: $relative" }
        if ($actual[$relative] -ne $Expected[$relative]) { throw "Installed file differs: $relative" }
    }
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$distRoot = [IO.Path]::GetFullPath((Join-Path $repoRoot 'dist')).TrimEnd('\')
$latestPath = Join-Path $distRoot 'latest.json'
$build = Get-Content -LiteralPath $latestPath -Raw | ConvertFrom-Json
if (-not $VortexPluginsRoot) {
    if (-not $env:APPDATA) { throw 'APPDATA is unavailable. Specify VortexPluginsRoot.' }
    $VortexPluginsRoot = Join-Path $env:APPDATA 'Vortex\plugins'
}
$pluginsRoot = [IO.Path]::GetFullPath($VortexPluginsRoot).TrimEnd('\')
$targetName = 'vortex-development-bridge'
$target = Assert-ContainedPath -Root $pluginsRoot -Path (Join-Path $pluginsRoot $targetName) -Message 'Install target escapes the plugins root.'
if ((Split-Path -Leaf $target) -ne $targetName) { throw 'Install target is not the Vortex Development Bridge extension directory.' }
if (-not (Test-Path -LiteralPath $pluginsRoot -PathType Container)) { throw "Vortex plugins root does not exist: $pluginsRoot" }
if (-not $build.run) { throw 'dist/latest.json does not identify a build directory.' }
$run = [IO.Path]::GetFullPath([string]$build.run)
if (-not $run.StartsWith($distRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Build receipt run directory escapes dist.' }
$source = Assert-ContainedPath -Root $run -Path (Join-Path $run 'extension') -Message 'Build receipt source directory escapes its run directory.'
if (-not (Test-Path -LiteralPath $source -PathType Container)) { throw "Build output is unavailable: $source" }
$expectedFiles = @{}
foreach ($entry in $build.files) {
    if (-not $entry.path -or -not $entry.sha256) { throw 'Build receipt contains an incomplete file entry.' }
    $relative = ([string]$entry.path).Replace('\', '/')
    if ([IO.Path]::IsPathRooted($relative) -or $relative -eq '.' -or $relative.StartsWith('../') -or $relative.Contains('/../')) { throw 'Build receipt contains an unsafe path.' }
    if ($expectedFiles.ContainsKey($relative)) { throw "Build receipt lists a file more than once: $relative" }
    $sourceFile = Assert-ContainedPath -Root $source -Path (Join-Path $source $relative) -Message 'Build receipt contains an unsafe path.'
    if (-not (Test-Path -LiteralPath $sourceFile -PathType Leaf)) { throw "Build output file is missing: $relative" }
    $expectedHash = ([string]$entry.sha256).ToLowerInvariant()
    if ((Get-FileHash -LiteralPath $sourceFile -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expectedHash) { throw "Build output changed: $relative" }
    $expectedFiles[$relative] = $expectedHash
}
if (-not $Install) {
    [pscustomobject]@{ Mode = 'Preview'; Version = $build.version; Source = $source; Target = $target; Files = $expectedFiles.Count; RequiresVortexRestart = $true }
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
$priorInstall = Join-Path $backup 'previous-install'
$replacement = Join-Path $backup 'replacement-install'
$hadExisting = $false
if (Test-Path -LiteralPath $target) {
    $targetItem = Get-Item -LiteralPath $target -Force
    if (-not $targetItem.PSIsContainer -or ($targetItem.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Install target must be a normal VDB extension directory.' }
    $infoPath = Join-Path $target 'info.json'
    if (-not (Test-Path -LiteralPath $infoPath) -or (Get-Content -LiteralPath $infoPath -Raw | ConvertFrom-Json).name -ne 'Vortex Development Bridge') { throw 'Target is not an existing VDB extension.' }
    $hadExisting = $true
    if (-not $UpdateExisting) {
        Copy-Item -LiteralPath $target -Destination $priorInstall -Recurse
        throw "Existing installation backed up to $backup. Rerun with -UpdateExisting while Vortex is closed to replace it."
    }
}
try {
    New-Item -ItemType Directory -Force -Path $replacement | Out-Null
    foreach ($relative in $expectedFiles.Keys) {
        $destination = Assert-ContainedPath -Root $replacement -Path (Join-Path $replacement $relative) -Message 'Install output escapes the replacement directory.'
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $destination) | Out-Null
        Copy-Item -LiteralPath (Join-Path $source $relative) -Destination $destination
    }
    Test-FileInventory -Root $replacement -Expected $expectedFiles

    if ($hadExisting) { Move-Item -LiteralPath $target -Destination $priorInstall }
    Move-Item -LiteralPath $replacement -Destination $target
    Test-FileInventory -Root $target -Expected $expectedFiles
} catch {
    $failure = $_
    try {
        if (Test-Path -LiteralPath $target) {
            Move-Item -LiteralPath $target -Destination (Join-Path $backup 'failed-install')
        }
        if ($hadExisting -and (Test-Path -LiteralPath $priorInstall)) {
            Move-Item -LiteralPath $priorInstall -Destination $target
        }
    } catch {
        throw "Installation failed: $($failure.Exception.Message). Automatic restoration also failed: $($_.Exception.Message). Inspect $backup before retrying."
    }
    throw "Installation failed: $($failure.Exception.Message). The prior install was restored; failed output is preserved under $backup."
}
[pscustomobject]@{ Installed = $target; Version = $build.version; RestartVortex = $true } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $backup 'receipt.json') -Encoding UTF8
Write-Output "Installed $target. Restart Vortex to load it."
