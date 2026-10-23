param([switch]$Quiet)
$ErrorActionPreference = 'Stop'
$stateDir = if($env:CHATGPT_BRIDGE_STATE_DIR){$env:CHATGPT_BRIDGE_STATE_DIR}else{Join-Path $env:LOCALAPPDATA 'ChatGPTClaudeBridge'}
$bridgeConfig = Get-Content (Join-Path $stateDir 'bridge.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$health = $null
try {
    $health = Invoke-RestMethod "http://127.0.0.1:$($bridgeConfig.port)/health" -TimeoutSec 2
} catch {}
if ($null -ne $health) {
    if ($health.service -ne 'chatgpt-claude-bridge') { throw 'Port is used by another service' }
    if ($health.installDir -ne $PSScriptRoot) { throw 'Another bridge installation is running. Stop it before starting this installation.' }
    if (-not $Quiet) { Write-Output 'Bridge is already running.' }
    exit 0
}
$bundledNode = Join-Path $PSScriptRoot 'runtime/node.exe'
$nodePath = if (Test-Path $bundledNode) { $bundledNode } else { (Get-Command node.exe).Source }
$process = Start-Process -FilePath $nodePath -ArgumentList ('"' + (Join-Path $PSScriptRoot 'server.mjs') + '"') -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $stateDir 'server.log') -RedirectStandardError (Join-Path $stateDir 'server-error.log') -PassThru
Set-Content -LiteralPath (Join-Path $stateDir 'server.pid') -Value $process.Id
for ($attempt = 0; $attempt -lt 30; $attempt++) {
    try {
        $health = Invoke-RestMethod "http://127.0.0.1:$($bridgeConfig.port)/health" -TimeoutSec 1
        if ($health.service -eq 'chatgpt-claude-bridge') { break }
    } catch {}
    if ($process.HasExited) { throw 'Bridge failed to start. See server-error.log.' }
    Start-Sleep -Milliseconds 200
}
if ($health.service -ne 'chatgpt-claude-bridge') { throw 'Bridge did not become ready.' }
if (-not $Quiet) { Write-Output "Started bridge (PID $($process.Id))." }
