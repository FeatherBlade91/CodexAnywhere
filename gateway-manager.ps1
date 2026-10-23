param([switch]$SmokeTest)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[Windows.Forms.Application]::EnableVisualStyles()
$gatewayConfig=& (Join-Path $PSScriptRoot 'gateway-control.ps1') config
$base=$gatewayConfig.baseURL -replace '/v1$',''
$headers=@{Authorization=('Bearer '+$gatewayConfig.apiKey)}
$form=New-Object Windows.Forms.Form
$form.Text='ChatGPT API Gateway'
$form.ClientSize=New-Object Drawing.Size(660,445)
$form.FormBorderStyle='FixedDialog'; $form.MaximizeBox=$false
$form.StartPosition='CenterScreen'; $form.Font=New-Object Drawing.Font('Microsoft YaHei UI',10)
function LabelAt($text,$x,$y,$w,$h){
    $c=New-Object Windows.Forms.Label; $c.Text=$text; $c.SetBounds($x,$y,$w,$h); $form.Controls.Add($c); return $c
}
function ButtonAt($text,$x,$y,$w){
    $c=New-Object Windows.Forms.Button; $c.Text=$text; $c.SetBounds($x,$y,$w,36); $form.Controls.Add($c); return $c
}
function TextAt($text,$x,$y,$w){
    $c=New-Object Windows.Forms.TextBox; $c.Text=$text; $c.ReadOnly=$true; $c.SetBounds($x,$y,$w,28); $form.Controls.Add($c); return $c
}
$null=LabelAt '将下面的地址和密钥填入软件的 OpenAI 兼容接口设置。' 24 20 612 28
$status=LabelAt '正在启动本地服务…' 24 55 612 28
$null=LabelAt 'Base URL' 24 96 100 24
$url=TextAt $gatewayConfig.baseURL 24 124 476
$copyUrl=ButtonAt '复制地址' 512 120 124
$null=LabelAt 'API Key（本机自动生成，重启后不变）' 24 166 530 24
$key=TextAt $gatewayConfig.apiKey 24 194 476; $key.UseSystemPasswordChar=$true
$copyKey=ButtonAt '复制密钥' 512 190 124
$login=ButtonAt '登录 ChatGPT' 24 244 144
$start=ButtonAt '启动服务' 180 244 144
$stop=ButtonAt '停止服务' 336 244 144
$models=ButtonAt '查看模型' 492 244 144
$modelText=TextAt '登录后点击“查看模型”，复制需要的模型 ID。' 24 294 612
$logs=ButtonAt '打开数据目录' 24 340 192
$help=ButtonAt '使用说明' 228 340 192
$refresh=ButtonAt '刷新状态' 432 340 204
$null=LabelAt '关闭此窗口后服务继续运行。退出服务请点击“停止服务”。' 24 398 612 26
$script:smokeFailure=$null
function Action([scriptblock]$work){
    $form.UseWaitCursor=$true
    try{& $work}catch{
        if($SmokeTest){$script:smokeFailure=$_.Exception.Message}
        else{[Windows.Forms.MessageBox]::Show($_.Exception.Message,'操作未完成','OK','Warning') | Out-Null}
    }
    finally{$form.UseWaitCursor=$false}
}
function RefreshStatus {
    try {
        $s=Invoke-RestMethod "$base/admin/status" -Headers $headers -TimeoutSec 2
        $status.Text=if($s.loginError){'登录未完成：'+$s.loginError}elseif($s.status -eq 'connecting'){'请在浏览器完成 ChatGPT 授权…'}elseif($s.sharing){'服务运行中 · 已登录 ChatGPT'}else{'服务运行中 · 首次请求将打开 ChatGPT 登录'}
    }catch{$status.Text='服务未运行，或端口 / API Key 配置不匹配。'}
}
$copyUrl.Add_Click({[Windows.Forms.Clipboard]::SetText($url.Text)})
$copyKey.Add_Click({[Windows.Forms.Clipboard]::SetText($key.Text)})
$start.Add_Click({Action {& (Join-Path $PSScriptRoot 'gateway-control.ps1') start; RefreshStatus}})
$stop.Add_Click({Action {& (Join-Path $PSScriptRoot 'gateway-control.ps1') stop; RefreshStatus}})
$login.Add_Click({Action {& (Join-Path $PSScriptRoot 'gateway-control.ps1') start; $null=Invoke-RestMethod "$base/admin/login" -Method Post -Headers $headers -TimeoutSec 5; RefreshStatus}})
$models.Add_Click({Action {$r=Invoke-RestMethod "$base/v1/models" -Headers $headers -TimeoutSec 15; $modelText.Text=($r.data.id -join ', ')}})
$refresh.Add_Click({RefreshStatus})
$logs.Add_Click({Start-Process explorer.exe -ArgumentList ('"'+$gatewayConfig.stateDir+'"')})
$help.Add_Click({Start-Process notepad.exe -ArgumentList ('"'+(Join-Path $PSScriptRoot 'GATEWAY.md')+'"')})
$timer=New-Object Windows.Forms.Timer; $timer.Interval=4000; $timer.Add_Tick({RefreshStatus})
$form.Add_Shown({Action {& (Join-Path $PSScriptRoot 'gateway-control.ps1') start; RefreshStatus}; $timer.Start(); if($SmokeTest){$form.Close()}})
$form.Add_FormClosed({$timer.Stop(); $timer.Dispose()})
$null=$form.ShowDialog()
if($script:smokeFailure){throw $script:smokeFailure}
