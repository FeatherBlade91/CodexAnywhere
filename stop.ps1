$ErrorActionPreference='Stop'
$stateDir=if($env:CHATGPT_BRIDGE_STATE_DIR){$env:CHATGPT_BRIDGE_STATE_DIR}else{Join-Path $env:LOCALAPPDATA 'ChatGPTClaudeBridge'}
$pidFile=Join-Path $stateDir 'server.pid'
if(Test-Path $pidFile){
    $bridgeProcessId=[int](Get-Content $pidFile -Raw)
    $process=Get-CimInstance Win32_Process -Filter "ProcessId = $bridgeProcessId" -ErrorAction SilentlyContinue
    $expected=Join-Path $PSScriptRoot 'server.mjs'
    if($process -and $process.CommandLine -and $process.CommandLine.Contains($expected)) {
        $config=Get-Content (Join-Path $stateDir 'bridge.json') -Raw -Encoding UTF8 | ConvertFrom-Json
        try {
            $health=Invoke-RestMethod "http://127.0.0.1:$($config.port)/health" -TimeoutSec 3
            if($health.installDir -ne $PSScriptRoot){throw 'A different bridge owns this port.'}
            $null=Invoke-RestMethod "http://127.0.0.1:$($config.port)/admin/shutdown" -Method Post -Headers @{Authorization=('Bearer '+$config.localKey)} -TimeoutSec 5
        } catch {
            # Only a legacy server lacking this endpoint may use the old stop path.
            if($_.Exception.Response -and [int]$_.Exception.Response.StatusCode -eq 404){Stop-Process -Id $bridgeProcessId; exit 0}
            throw
        }
        for($attempt=0;$attempt -lt 90;$attempt++) {
            if(-not (Get-Process -Id $bridgeProcessId -ErrorAction SilentlyContinue)){exit 0}
            Start-Sleep -Milliseconds 500
        }
        throw 'Bridge is still finishing active requests. Wait for them to finish and retry.'
    }
}
