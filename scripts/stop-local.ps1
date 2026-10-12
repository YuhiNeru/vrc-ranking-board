$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$pidFile = Join-Path $projectRoot '.runtime/server.pid'
if (-not (Test-Path -LiteralPath $pidFile)) { Write-Output 'No managed local server.'; exit 0 }
$serverProcessId = [int](Get-Content -LiteralPath $pidFile)
$serverProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$serverProcessId"
$expectedScript = Join-Path $PSScriptRoot 'dev.mjs'
if (-not $serverProcess) { Write-Output 'Local server is already stopped.'; exit 0 }
if ($serverProcess.Name -ne 'node.exe' -or -not $serverProcess.CommandLine.Contains($expectedScript)) { throw 'Process identity changed; no process was stopped.' }
Stop-Process -Id $serverProcessId
Write-Output 'Local World Watch server stopped.'
