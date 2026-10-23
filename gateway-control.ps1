param([ValidateSet('start','stop','config')][string]$Action='start')
$ErrorActionPreference='Stop'
$env:NODE_NO_WARNINGS='1'
$gatewayNode=Join-Path $PSScriptRoot 'runtime/node.exe'
if(-not(Test-Path -LiteralPath $gatewayNode)){$gatewayNode=(Get-Command node.exe).Source}
$gatewayConfigText=& $gatewayNode (Join-Path $PSScriptRoot 'gateway.mjs') config
if($LASTEXITCODE){throw 'Cannot read gateway configuration.'}
$gatewayConfig=($gatewayConfigText -join "`n") | ConvertFrom-Json
if($Action -eq 'config'){return $gatewayConfig}
$gatewayBase=$gatewayConfig.baseURL -replace '/v1$',''
$gatewayHeaders=@{Authorization=('Bearer '+$gatewayConfig.apiKey)}
function Get-GatewayStatus {
    try { return Invoke-RestMethod "$gatewayBase/admin/status" -Headers $gatewayHeaders -TimeoutSec 3 }
    catch {
        if($_.Exception.Response){throw 'The port is occupied or the configured API key does not match.'}
        return $null
    }
}
$gatewayStatus=Get-GatewayStatus
if($gatewayStatus -and $gatewayStatus.installDir -ne $PSScriptRoot){throw 'Another gateway installation owns this port. Stop it first.'}
if($Action -eq 'stop'){
    if(-not $gatewayStatus){return}
    $null=Invoke-RestMethod "$gatewayBase/admin/shutdown" -Method Post -Headers $gatewayHeaders -TimeoutSec 5
    $gatewayPidPath=Join-Path $gatewayConfig.stateDir 'gateway.pid'
    if(Test-Path -LiteralPath $gatewayPidPath){
        $gatewayPid=[int](Get-Content -LiteralPath $gatewayPidPath -Raw)
        $gatewayProcess=Get-CimInstance Win32_Process -Filter "ProcessId = $gatewayPid"
        if($gatewayProcess -and $gatewayProcess.CommandLine -and $gatewayProcess.CommandLine.Contains((Join-Path $PSScriptRoot 'gateway.mjs'))){
            $gatewayRunning=Get-Process -Id $gatewayPid -ErrorAction SilentlyContinue
            if($gatewayRunning -and -not $gatewayRunning.WaitForExit(45000)){throw 'Requests are still running. Wait and retry.'}
        }
    }
    return
}
if($gatewayStatus){return}
$gatewayProcess=Start-Process -FilePath $gatewayNode -ArgumentList ('"'+(Join-Path $PSScriptRoot 'gateway.mjs')+'"') -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $gatewayConfig.stateDir 'gateway.log') -RedirectStandardError (Join-Path $gatewayConfig.stateDir 'gateway-error.log') -PassThru
Set-Content -LiteralPath (Join-Path $gatewayConfig.stateDir 'gateway.pid') -Value $gatewayProcess.Id
for($gatewayAttempt=0;$gatewayAttempt -lt 40;$gatewayAttempt++){
    if($gatewayProcess.HasExited){throw 'Gateway could not start. See gateway-error.log in the data folder.'}
    $gatewayStatus=Get-GatewayStatus
    if($gatewayStatus -and $gatewayStatus.installDir -eq $PSScriptRoot){return}
    Start-Sleep -Milliseconds 250
}
throw 'Gateway did not become ready.'
