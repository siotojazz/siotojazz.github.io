[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$packageDirectory = Join-Path $root "3000"
$syncScript = Join-Path $root "scripts\sync-competition-instagram.mjs"
$playwrightModule = Join-Path $packageDirectory "node_modules\playwright-core"

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw "Node.js is required. Install Node.js and run this command again."
}

if (-not (Test-Path -LiteralPath $playwrightModule)) {
    & npm.cmd --prefix $packageDirectory install --ignore-scripts --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) {
        throw "Could not install the local browser dependency."
    }
}

& npx.cmd --prefix $packageDirectory playwright-core install chromium
if ($LASTEXITCODE -ne 0) {
    throw "Could not install Chromium."
}

& node $syncScript
exit $LASTEXITCODE
