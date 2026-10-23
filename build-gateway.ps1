param(
    [ValidateSet('x64','arm64')][string]$Architecture='x64',
    [string]$ToolsDirectory=(Join-Path $PSScriptRoot '.tools')
)
$ErrorActionPreference='Stop'
Set-Location $PSScriptRoot
$ToolsDirectory=(Resolve-Path -LiteralPath $ToolsDirectory).Path
$compiler=Join-Path $ToolsDirectory 'inno/ISCC.exe'
$nodeRuntime=Join-Path $ToolsDirectory "node-$Architecture/node.exe"
$manifest=Get-Content -LiteralPath (Join-Path $ToolsDirectory 'runtime-manifest.json') -Raw | ConvertFrom-Json
$entry=@($manifest | Where-Object arch -eq $Architecture)
if($entry.Count -ne 1 -or (Get-FileHash -LiteralPath $nodeRuntime -Algorithm SHA256).Hash.ToLower() -ne $entry[0].sha256){throw 'Bundled Node runtime checksum does not match the manifest.'}
if((Get-AuthenticodeSignature -LiteralPath $compiler).Status -ne 'Valid'){throw 'Inno Setup compiler signature is not valid.'}
node build.mjs
if($LASTEXITCODE){throw 'SDK build failed'}
# A fresh stage prevents old integration files or credentials entering the package.
$stage=Join-Path $PSScriptRoot ('build/gateway-'+$Architecture+'-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force $stage,(Join-Path $stage 'runtime'),(Join-Path $stage 'vendor/siwc') | Out-Null
$files=@('gateway.mjs','openai-server.mjs','openai-protocol.mjs','protocol.mjs','response-accumulator.mjs','runtime.mjs','gateway-control.ps1','gateway-manager.ps1','dpapi.ps1','package.json','GATEWAY.md','LICENSE','THIRD-PARTY-NOTICES.md')
foreach($file in $files){
    $target=Join-Path $stage $file
    if($file.EndsWith('.ps1') -or $file.EndsWith('.md')){[IO.File]::WriteAllText($target,[IO.File]::ReadAllText((Join-Path $PSScriptRoot $file)),(New-Object Text.UTF8Encoding($true)))}
    else{Copy-Item -LiteralPath $file -Destination $target}
}
Copy-Item vendor/siwc/*.js,vendor/siwc/LICENSE -Destination (Join-Path $stage 'vendor/siwc')
# Ship runtime dependencies only; no toolchains, installers, test data or other architectures.
Copy-Item -LiteralPath node_modules -Destination $stage -Recurse
Copy-Item -LiteralPath $nodeRuntime -Destination (Join-Path $stage 'runtime/node.exe')
Copy-Item -LiteralPath (Join-Path $ToolsDirectory 'NODE-LICENSE.txt') -Destination $stage
$entry[0] | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $stage 'runtime-manifest.json') -Encoding UTF8
& $compiler /Q "/DGatewayArch=$Architecture" "/DGatewayStage=$stage" gateway-installer.iss
if($LASTEXITCODE){throw 'Gateway installer compilation failed'}
$name="ChatGPT-API-Gateway-Setup-1.0.0-$Architecture.exe"
$hash=(Get-FileHash -LiteralPath (Join-Path $PSScriptRoot "dist/$name") -Algorithm SHA256).Hash.ToLower()
[IO.File]::WriteAllText((Join-Path $PSScriptRoot "dist/$name.sha256"),"$hash  $name`n")
Get-Item -LiteralPath (Join-Path $PSScriptRoot "dist/$name") | Select-Object Name,Length
