param([switch]$Demo)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$runtimePath = Join-Path $projectRoot '.runtime'
New-Item -ItemType Directory -Path $runtimePath -Force | Out-Null
try {
    $health = Invoke-RestMethod -Uri 'http://127.0.0.1:4173/api/health' -TimeoutSec 2
    if ($health.app -eq 'world-watch') { Write-Output 'World Watch is already running: http://127.0.0.1:4173/'; exit 0 }
} catch {}
$nodePath = (Get-Command node.exe).Source
$serverPath = Join-Path $PSScriptRoot 'dev.mjs'
$serverArguments = @($serverPath)
if (-not $Demo) { $serverArguments += '--live' }
$serverProcess = Start-Process -FilePath $nodePath -ArgumentList $serverArguments -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $runtimePath 'server.log') -RedirectStandardError (Join-Path $runtimePath 'server-error.log') -PassThru
Set-Content -LiteralPath (Join-Path $runtimePath 'server.pid') -Value $serverProcess.Id
for ($attempt = 0; $attempt -lt 20; $attempt++) {
    Start-Sleep -Milliseconds 250
    try {
        $health = Invoke-RestMethod -Uri 'http://127.0.0.1:4173/api/health' -TimeoutSec 2
        if ($health.app -eq 'world-watch') { Write-Output 'Local: http://127.0.0.1:4173/'; exit 0 }
    } catch {}
    if ($serverProcess.HasExited) { throw 'Local server exited. See .runtime/server-error.log.' }
}
throw 'Local server did not become ready.'
