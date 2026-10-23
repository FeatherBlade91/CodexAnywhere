$ErrorActionPreference='Stop'
Set-Location $PSScriptRoot
node build.mjs
if($LASTEXITCODE){throw 'SDK build failed'}
$stage=Join-Path $PSScriptRoot 'build/payload'
New-Item -ItemType Directory -Force $stage | Out-Null
$files=@('catalog.mjs','cli.mjs','integration.mjs','protocol.mjs','response-accumulator.mjs','runtime.mjs','server.mjs','package.json','package-lock.json','dpapi.ps1','start.ps1','stop.ps1','login.ps1','manager.ps1','USER-GUIDE.txt','THIRD-PARTY-NOTICES.md')
foreach($file in $files){
  $target=Join-Path $stage $file
  if($file.EndsWith('.ps1') -or $file.EndsWith('.txt')){[IO.File]::WriteAllText($target,[IO.File]::ReadAllText((Join-Path $PSScriptRoot $file)),(New-Object Text.UTF8Encoding($true)))}
  else{Copy-Item -LiteralPath $file -Destination $target -Force}
}
Copy-Item vendor,node_modules -Destination $stage -Recurse -Force
Copy-Item .tools/NODE-LICENSE.txt,.tools/NODE22-LICENSE.txt,.tools/runtime-manifest.json -Destination $stage -Force
& .tools/inno/ISCC.exe /Q installer.iss
if($LASTEXITCODE){throw 'Installer compilation failed'}
Get-FileHash dist/ChatGPT-Plan-Bridge-Setup-1.0.0.exe -Algorithm SHA256 | ForEach-Object { "$($_.Hash.ToLower())  ChatGPT-Plan-Bridge-Setup-1.0.0.exe" } | Set-Content dist/SHA256SUMS.txt
