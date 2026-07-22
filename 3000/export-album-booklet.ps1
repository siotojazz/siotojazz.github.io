$ErrorActionPreference = "Stop"

$projectDirectory = $PSScriptRoot
$serverScript = Join-Path $projectDirectory "album-booklet-server.mjs"
$bundledNode = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
$bundledPnpm = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\bin\fallback\pnpm.cmd"
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue

if ($nodeCommand) {
    $nodeExecutable = $nodeCommand.Source
} elseif (Test-Path -LiteralPath $bundledNode) {
    $nodeExecutable = $bundledNode
} else {
    throw "Node.js is required. Install Node.js or set it on PATH."
}

Push-Location $projectDirectory
try {
    if (-not (Test-Path -LiteralPath (Join-Path $projectDirectory "node_modules\playwright-core\package.json"))) {
        $pnpmCommand = Get-Command pnpm -ErrorAction SilentlyContinue
        if ($pnpmCommand) {
            & $pnpmCommand.Source install --frozen-lockfile
        } elseif (Test-Path -LiteralPath $bundledPnpm) {
            & $bundledPnpm install --frozen-lockfile
        } else {
            $npmCommand = Get-Command npm -ErrorAction SilentlyContinue
            if (-not $npmCommand) { throw "Run 'npm install' once before starting the booklet exporter." }
            & $npmCommand.Source install
        }
        if ($LASTEXITCODE -ne 0) { throw "Could not install the booklet export dependency." }
    }
    & $nodeExecutable $serverScript
} finally {
    Pop-Location
}
