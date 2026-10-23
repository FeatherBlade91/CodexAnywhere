$ErrorActionPreference = 'Stop'
$env:NODE_NO_WARNINGS='1'
[Console]::OutputEncoding=New-Object Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()
$node = Join-Path $PSScriptRoot 'runtime/node.exe'
if (-not (Test-Path $node)) { $node = (Get-Command node.exe).Source }
$cli = Join-Path $PSScriptRoot 'cli.mjs'
$form = New-Object Windows.Forms.Form
$form.Text = 'ChatGPT Plan Bridge - 模型与连接管理'
$form.Size = New-Object Drawing.Size(780,570)
$form.MinimumSize = $form.Size
$form.StartPosition = 'CenterScreen'
$form.Font = New-Object Drawing.Font('Microsoft YaHei UI',10)
function LabelAt($text,$x,$y,$width,$height) {
    $label=New-Object Windows.Forms.Label
    $label.Text=$text; $label.Location=New-Object Drawing.Point($x,$y); $label.Size=New-Object Drawing.Size($width,$height)
    $form.Controls.Add($label); return $label
}
function ButtonAt($text,$x,$y,$width) {
    $button=New-Object Windows.Forms.Button
    $button.Text=$text; $button.Location=New-Object Drawing.Point($x,$y); $button.Size=New-Object Drawing.Size($width,38)
    $form.Controls.Add($button); return $button
}
$null=LabelAt '用已有 ChatGPT 订阅，在 Claude Code 中使用可用模型。' 24 22 710 30
$status=LabelAt '正在检查本机连接…' 24 58 710 40
$login=ButtonAt '1. 登录 / 重新授权' 24 104 205
$refresh=ButtonAt '2. 刷新模型与状态' 245 104 205
$usage=ButtonAt '查看 ChatGPT 用量' 466 104 240
$null=LabelAt '默认模型（可用范围由你的 ChatGPT 账号决定）' 24 163 710 28
$combo=New-Object Windows.Forms.ComboBox
$combo.Location=New-Object Drawing.Point(24,197); $combo.Size=New-Object Drawing.Size(682,32)
$combo.DropDownStyle='DropDownList'; $combo.DisplayMember='displayName'; $combo.ValueMember='slug'; $form.Controls.Add($combo)
$sync=ButtonAt '同步全部模型到 CC Switch' 24 248 335
$choose=ButtonAt '设置所选默认模型' 375 248 331
$null=LabelAt '在 Claude Code 内使用 /effort low、medium、high、xhigh、max。支持的档位原样传给模型；不同模型同名档位不代表相同计算量。' 24 303 690 57
$null=LabelAt '网络代理（留空直连；首次自动读取 Windows 系统代理）' 24 369 710 26
$proxy=New-Object Windows.Forms.TextBox
$proxy.Location=New-Object Drawing.Point(24,402); $proxy.Size=New-Object Drawing.Size(495,30); $form.Controls.Add($proxy)
$saveProxy=ButtonAt '保存代理并重启' 535 397 171
$start=ButtonAt '启动桥接服务' 24 460 205
$logs=ButtonAt '打开日志与备份' 245 460 205
$help=ButtonAt '使用说明' 466 460 240
function RunCli([string[]]$Arguments) {
    $result = & $node $cli @Arguments 2> (Join-Path $env:TEMP 'chatgpt-plan-bridge-cli-error.log')
    if($LASTEXITCODE -ne 0) { throw "操作未完成。请检查登录及代理设置。详情见 $env:TEMP\chatgpt-plan-bridge-cli-error.log" }
    return ($result -join "`n")
}
function Action([scriptblock]$Work) {
    $form.UseWaitCursor=$true
    try { & $Work } catch { [Windows.Forms.MessageBox]::Show($_.Exception.Message,'操作未完成','OK','Warning') | Out-Null }
    finally { $form.UseWaitCursor=$false }
}
function RefreshState {
    $connection=RunCli @('status') | ConvertFrom-Json
    $proxy.Text=$connection.proxy
    $status.Text="授权：$($connection.status)    订阅调用：$($connection.sharing)    接入模式：$($connection.mode)"
    if($connection.mode -eq 'direct') { $sync.Text='更新 Claude Code 直连配置' }
    if($connection.sharing) {
        $status.Text += '    正在读取模型…'; [Windows.Forms.Application]::DoEvents()
        $catalog=RunCli @('models') | ConvertFrom-Json
        $combo.Items.Clear()
        foreach($model in $catalog) { $null=$combo.Items.Add($model); if($model.slug -eq $connection.model){$combo.SelectedItem=$model} }
        if($combo.SelectedIndex -lt 0 -and $combo.Items.Count -gt 0){$combo.SelectedIndex=0}
        $status.Text="已授权，发现 $($combo.Items.Count) 个模型。接入模式：$($connection.mode)"
    }
}
$login.Add_Click({ Start-Process powershell.exe -ArgumentList ('-NoProfile -ExecutionPolicy Bypass -File "'+(Join-Path $PSScriptRoot 'login.ps1')+'"') -WindowStyle Normal; $status.Text='请在浏览器完成授权，完成后点击“刷新模型与状态”。' })
$refresh.Add_Click({Action {RefreshState}})
$sync.Add_Click({Action { $result=RunCli @('sync'); $status.Text='单供应商模型列表已更新。CC Switch 聚合模式下，在 Claude Code 的 /model 切换。' }})
$choose.Add_Click({Action { if($combo.SelectedItem){ $null=RunCli @('select-model',$combo.SelectedItem.slug); & (Join-Path $PSScriptRoot 'stop.ps1'); & (Join-Path $PSScriptRoot 'start.ps1') -Quiet; $status.Text='默认模型已保存。请在 CC Switch 重新应用 ChatGPT 订阅供应商。' } }})
$usage.Add_Click({Start-Process 'https://chatgpt.com/settings/usage'})
$start.Add_Click({Action { & (Join-Path $PSScriptRoot 'start.ps1') -Quiet; $status.Text='本地桥接服务已启动。' }})
$saveProxy.Add_Click({Action { $null=RunCli @('set-proxy',$proxy.Text.Trim()); & (Join-Path $PSScriptRoot 'stop.ps1'); & (Join-Path $PSScriptRoot 'start.ps1') -Quiet; $status.Text='代理已保存，服务已重启。' }})
$logs.Add_Click({Start-Process explorer.exe -ArgumentList ('"'+(Join-Path $env:LOCALAPPDATA 'ChatGPTClaudeBridge')+'"')})
$help.Add_Click({Start-Process (Join-Path $PSScriptRoot 'USER-GUIDE.txt')})
$form.Add_Shown({Action {RefreshState}})
$null=$form.ShowDialog()
