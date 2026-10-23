$ErrorActionPreference = 'Stop'
# Read-only preflight. Exit 0: readable initialized DB; 1: absent; 2: installed
# but not initialized; 3: invalid/inaccessible custom configuration or DB.
try {
  $override = [Environment]::GetEnvironmentVariable('CHATGPT_BRIDGE_CC_DIR')
  if ($override) { $directory = $override }
  else {
    $directory = Join-Path ([Environment]::GetFolderPath('UserProfile')) '.cc-switch'
    $pathsFile = Join-Path $env:APPDATA 'com.ccswitch.desktop\app_paths.json'
    if (Test-Path -LiteralPath $pathsFile) {
      $paths = Get-Content -LiteralPath $pathsFile -Raw -Encoding UTF8 | ConvertFrom-Json
      if ($paths.app_config_dir_override -is [string] -and $paths.app_config_dir_override.Trim()) {
        $directory = $paths.app_config_dir_override
        if ($directory -match '^~([\\/]|$)') {
          $directory = [Environment]::GetFolderPath('UserProfile') + $directory.Substring(1)
        }
      }
    }
  }
  $database = Join-Path $directory 'cc-switch.db'
  if (Test-Path -LiteralPath $database -PathType Leaf) {
    $stream = [IO.File]::Open($database, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete)
    try {
      $header = New-Object byte[] 16
      $count = $stream.Read($header, 0, 16)
      if ($count -ne 16 -or [Text.Encoding]::ASCII.GetString($header) -ne "SQLite format 3`0") { exit 3 }
    } finally { $stream.Dispose() }
    exit 0
  }
  if ($override) { exit 1 }
  if ((Test-Path -LiteralPath $pathsFile) -or
      (Test-Path -LiteralPath (Join-Path $env:LOCALAPPDATA 'Programs\CC Switch\cc-switch.exe')) -or
      ($env:ProgramFiles -and (Test-Path -LiteralPath (Join-Path $env:ProgramFiles 'CC Switch\cc-switch.exe'))) -or
      (${env:ProgramW6432} -and (Test-Path -LiteralPath (Join-Path ${env:ProgramW6432} 'CC Switch\cc-switch.exe')))) { exit 2 }
  exit 1
} catch { exit 3 }
