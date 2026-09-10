[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
Push-Location (Split-Path -Parent $PSScriptRoot)
try {
    & npm run check
    if ($LASTEXITCODE -ne 0) { throw 'Source checks failed.' }
    & npm test
    if ($LASTEXITCODE -ne 0) { throw 'Tests failed.' }
    & npm run build
    if ($LASTEXITCODE -ne 0) { throw 'Build failed.' }
    & node --test tests/archive.test.js
    if ($LASTEXITCODE -ne 0) { throw 'Built archive checks failed.' }
} finally { Pop-Location }
