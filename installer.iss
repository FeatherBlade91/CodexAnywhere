#define AppVersion "1.0.0"
[Setup]
AppId={code:InstallerAppId}
UsePreviousLanguage=no
AppName=ChatGPT Plan Bridge
AppVersion={#AppVersion}
AppPublisher=NamelessDDDoge
DefaultDirName={localappdata}\Programs\ChatGPT Plan Bridge
DefaultGroupName=ChatGPT Plan Bridge
PrivilegesRequired=lowest
MinVersion=10.0
SetupArchitecture=x86
WizardStyle=modern
DisableProgramGroupPage=yes
OutputDir=dist
OutputBaseFilename=ChatGPT-Plan-Bridge-Setup-{#AppVersion}
Compression=lzma2
SolidCompression=yes
LicenseFile=vendor\siwc\LICENSE
UninstallDisplayIcon={sys}\WindowsPowerShell\v1.0\powershell.exe
CloseApplications=no
[Languages]
Name: "chinesesimp"; MessagesFile: "compiler:Languages\ChineseSimplified.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"
[Tasks]
Name: "startup"; Description: "Start the local bridge when I sign in to Windows"; Flags: checkedonce
Name: "desktopicon"; Description: "Create a desktop shortcut"; Flags: unchecked
[Files]
Source: "detect-cc.ps1"; Flags: dontcopy
Source: "build\payload\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: ".tools\node-x64\node.exe"; DestDir: "{app}\runtime"; Check: UseX64; Flags: ignoreversion
Source: ".tools\node-arm64\node.exe"; DestDir: "{app}\runtime"; Check: IsArm64; Flags: ignoreversion
Source: ".tools\node-x86\node.exe"; DestDir: "{app}\runtime"; Check: UseX86; Flags: ignoreversion
[Icons]
Name: "{group}\Bridge Manager"; Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""{app}\manager.ps1"""; WorkingDir: "{app}"
Name: "{group}\Usage guide"; Filename: "{app}\USER-GUIDE.txt"
Name: "{autodesktop}\ChatGPT Plan Bridge"; Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""{app}\manager.ps1"""; Tasks: desktopicon
[Registry]
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "ChatGPTPlanBridge"; ValueData: """{sys}\WindowsPowerShell\v1.0\powershell.exe"" -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""{app}\start.ps1"" -Quiet"; Tasks: startup; Flags: uninsdeletevalue
[Run]
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""{app}\manager.ps1"""; Description: "Open Bridge Manager to sign in and synchronize models"; Flags: postinstall nowait skipifsilent
[Code]
var ModePage: TInputOptionWizardPage; DownloadButton: TNewButton; SelectedMode: String; CCStatus: Integer; RestoreOnUninstall: Boolean;
function InstallerAppId(Param: String): String;
var Instance: String; I: Integer;
begin
  Result := '{5C8BB9D0-337C-43CD-A62B-CF28AE31513A}';
  { The exact release EXE can be tested without overwriting the real uninstall registration. }
  Instance := GetEnv('CHATGPT_BRIDGE_TEST_INSTANCE');
  if (Instance <> '') and (Length(Instance) <= 64) then begin
    for I := 1 to Length(Instance) do
      if not (((Instance[I] >= 'a') and (Instance[I] <= 'z')) or ((Instance[I] >= '0') and (Instance[I] <= '9')) or (Instance[I] = '-')) then Exit;
    Result := Result + '-' + Instance;
  end;
end;
function UseX64: Boolean; begin Result := IsWin64 and not IsArm64; end;
function UseX86: Boolean; begin Result := not IsWin64; end;
function HasCC: Boolean;
begin
  ExtractTemporaryFile('detect-cc.ps1');
  CCStatus := 3;
  Result := Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'), '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + ExpandConstant('{tmp}\detect-cc.ps1') + '"', '', SW_HIDE, ewWaitUntilTerminated, CCStatus);
  Result := Result and (CCStatus = 0);
end;
function CCProblem: String;
begin
  if CCStatus = 2 then Result := '已找到 CC Switch，但配置数据库尚未初始化。请启动 CC Switch 一次，再返回继续；也可选择跳过。'
  else if CCStatus = 3 then Result := '无法读取 CC Switch 配置数据库。请检查自定义配置目录、文件权限及数据库是否正常，再返回重试；也可选择跳过。'
  else Result := '未检测到 CC Switch。请点击下载按钮安装并启动一次，然后继续；也可选择跳过。';
end;
procedure DownloadCC(Sender: TObject);
var Code: Integer;
begin ShellExec('open', 'https://ccswitch.io', '', '', SW_SHOWNORMAL, ewNoWait, Code); end;
procedure InitializeWizard;
begin
  ModePage := CreateInputOptionPage(wpLicense, '连接方式 / Integration', 'Choose how Claude Code will connect', '推荐安装并启动 CC Switch。没有安装时可点击下方按钮下载；安装后返回继续。跳过 CC Switch 会直接覆盖 Claude Code 的模型与连接设置，并自动备份。', True, False);
  ModePage.Add('Use CC Switch (recommended) / 使用 CC Switch 管理');
  ModePage.Add('Skip CC Switch / 直接修改 Claude Code 配置');
  ModePage.SelectedValueIndex := 0;
  DownloadButton := TNewButton.Create(WizardForm);
  DownloadButton.Parent := ModePage.Surface;
  DownloadButton.Caption := '下载 / Download CC Switch';
  DownloadButton.SetBounds(0, ScaleY(145), ScaleX(240), ScaleY(30));
  DownloadButton.OnClick := @DownloadCC;
end;
function NextButtonClick(CurPageID: Integer): Boolean;
begin
  Result := True;
  if WizardSilent then Exit;
  if CurPageID = ModePage.ID then begin
    if ModePage.SelectedValueIndex = 0 then begin
      if not HasCC then begin
        MsgBox(CCProblem, mbInformation, MB_OK);
        Result := False;
      end;
    end else Result := MsgBox('警告：跳过 CC Switch 将直接覆盖 Claude Code 当前的模型和 API 连接设置。会先备份，其他设置保留。确定继续吗？', mbConfirmation, MB_YESNO or MB_DEFBUTTON2) = IDYES;
  end;
end;
function PrepareToInstall(var NeedsRestart: Boolean): String;
var Code: Integer;
begin
  Result := '';
  if WizardSilent then begin
    SelectedMode := ExpandConstant('{param:MODE|cc-switch}');
    if (SelectedMode = 'direct') and (ExpandConstant('{param:ACCEPTCONFIGOVERWRITE|0}') <> '1') then begin Result := 'Direct silent installation requires /ACCEPTCONFIGOVERWRITE=1'; Exit; end;
  end else if ModePage.SelectedValueIndex = 1 then SelectedMode := 'direct' else SelectedMode := 'cc-switch';
  if (SelectedMode <> 'direct') and (SelectedMode <> 'cc-switch') then begin Result := 'Invalid MODE'; Exit; end;
  if (SelectedMode = 'cc-switch') and not HasCC then begin Result := CCProblem; Exit; end;
  if FileExists(ExpandConstant('{app}\stop.ps1')) then
    if not Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'), '-NoProfile -ExecutionPolicy Bypass -File "' + ExpandConstant('{app}\stop.ps1') + '"', '', SW_HIDE, ewWaitUntilTerminated, Code) or (Code <> 0) then
      Result := 'The bridge is still processing requests or could not stop. Wait for active conversations to finish, then retry installation.';
end;
procedure CurStepChanged(CurStep: TSetupStep);
var Code: Integer;
begin
  if CurStep = ssPostInstall then begin
    if not Exec(ExpandConstant('{app}\runtime\node.exe'), '"' + ExpandConstant('{app}\cli.mjs') + '" configure ' + SelectedMode, ExpandConstant('{app}'), SW_HIDE, ewWaitUntilTerminated, Code) or (Code <> 0) then
      RaiseException('Integration setup failed. Start CC Switch once, then rerun Setup.');
  end;
end;
function InitializeUninstall: Boolean;
var Code: Integer;
begin
  Result := True;
  if UninstallSilent then RestoreOnUninstall := ExpandConstant('{param:RESTORE|0}') = '1'
  else RestoreOnUninstall := MsgBox('恢复由本程序修改的 Claude Code 配置，并移除本程序添加的 CC Switch 模型？请先完全退出 CC Switch（含托盘），授权凭据和备份将保留在本机。', mbConfirmation, MB_YESNO) = IDYES;
  if RestoreOnUninstall then begin
    Result := Exec(ExpandConstant('{app}\runtime\node.exe'), '"' + ExpandConstant('{app}\cli.mjs') + '" restore-check', ExpandConstant('{app}'), SW_HIDE, ewWaitUntilTerminated, Code);
    Result := Result and (Code = 0);
    if not Result and not UninstallSilent then MsgBox('恢复检查未通过，卸载已取消。请完全退出 CC Switch（含托盘）后重试；若仍失败，请先启动 CC Switch 完成未结束的配置操作，再退出重试。', mbError, MB_OK);
  end;
end;
procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var Code: Integer;
begin
  if CurUninstallStep = usUninstall then begin
    if not Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'), '-NoProfile -ExecutionPolicy Bypass -File "' + ExpandConstant('{app}\stop.ps1') + '"', '', SW_HIDE, ewWaitUntilTerminated, Code) or (Code <> 0) then
      RaiseException('The bridge is still processing requests or could not stop. Uninstall cancelled; retry when active conversations finish.');
    if RestoreOnUninstall then
      if not Exec(ExpandConstant('{app}\runtime\node.exe'), '"' + ExpandConstant('{app}\cli.mjs') + '" restore', ExpandConstant('{app}'), SW_HIDE, ewWaitUntilTerminated, Code) or (Code <> 0) then
        RaiseException('Configuration restore failed; uninstall cancelled. Exit CC Switch and retry. Configuration backups remain in the bridge state directory.');
  end;
end;
