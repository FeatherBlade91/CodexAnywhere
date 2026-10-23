$ErrorActionPreference='Stop'
$node=Join-Path $PSScriptRoot 'runtime/node.exe'
if(-not(Test-Path $node)){$node=(Get-Command node.exe).Source}
Write-Host '请在打开的浏览器中登录 ChatGPT，并允许 ChatGPT Claude Bridge 使用订阅额度。'
Write-Host '授权成功后将自动获取模型并更新你选择的接入方式。'
& $node (Join-Path $PSScriptRoot 'cli.mjs') login
if($LASTEXITCODE -ne 0) { $null=Read-Host '授权或同步未完成。检查网络与代理后重试。按 Enter 关闭' }
else { & (Join-Path $PSScriptRoot 'start.ps1') -Quiet; Write-Host '已完成。返回管理器刷新，或在 CC Switch 中启用模型卡片。'; Start-Sleep -Seconds 2 }
