[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$latestPath = Join-Path $repoRoot 'dist\latest.json'
$previousLatest = if (Test-Path -LiteralPath $latestPath -PathType Leaf) { [IO.File]::ReadAllBytes($latestPath) } else { $null }
$builtCandidate = $false
Push-Location $repoRoot
try {
    & npm run check
    if ($LASTEXITCODE -ne 0) { throw 'Source checks failed.' }
    & npm run build
    if ($LASTEXITCODE -ne 0) { throw 'Build failed.' }
    $builtCandidate = $true
    & npm test
    if ($LASTEXITCODE -ne 0) { throw 'Tests failed.' }
} catch {
    $failure = $_
    if ($builtCandidate) {
        try {
            if ($null -eq $previousLatest) {
                Remove-Item -LiteralPath $latestPath -Force -ErrorAction SilentlyContinue
            } else {
                [IO.File]::WriteAllBytes($latestPath, $previousLatest)
            }
        } catch {
            throw "Build or test failure: $($failure.Exception.Message). The previous dist/latest.json could not be restored: $($_.Exception.Message)"
        }
    }
    throw $failure
} finally {
    Pop-Location
}
