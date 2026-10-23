#ifndef GatewayArch
  #define GatewayArch "x64"
#endif
#ifndef GatewayStage
  #error GatewayStage is required
#endif
#define GatewayVersion "1.0.0"
[Setup]
AppId={code:GatewayAppId}
UsePreviousLanguage=no
AppName=ChatGPT API Gateway
AppVersion={#GatewayVersion}
AppPublisher=NamelessDDDoge
DefaultDirName={localappdata}\Programs\ChatGPT API Gateway
DefaultGroupName=ChatGPT API Gateway
PrivilegesRequired=lowest
MinVersion=10.0
SetupArchitecture=x64
#if GatewayArch == "arm64"
ArchitecturesAllowed=arm64
#else
ArchitecturesAllowed=x64compatible
#endif
WizardStyle=modern
DisableProgramGroupPage=yes
OutputDir=dist
OutputBaseFilename=ChatGPT-API-Gateway-Setup-{#GatewayVersion}-{#GatewayArch}
Compression=lzma2
SolidCompression=yes
LicenseFile=vendor\siwc\LICENSE
UninstallDisplayIcon={sys}\WindowsPowerShell\v1.0\powershell.exe
CloseApplications=no
[Languages]
Name: "chinesesimp"; MessagesFile: "compiler:Languages\ChineseSimplified.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"
[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut / 创建桌面快捷方式"
Name: "startup"; Description: "Start the gateway when I sign in / 登录 Windows 时启动服务"; Flags: unchecked
[Files]
Source: "{#GatewayStage}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
[Icons]
Name: "{group}\ChatGPT API Gateway"; Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -STA -ExecutionPolicy Bypass -WindowStyle Hidden -File ""{app}\gateway-manager.ps1"""; WorkingDir: "{app}"
Name: "{autodesktop}\ChatGPT API Gateway"; Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -STA -ExecutionPolicy Bypass -WindowStyle Hidden -File ""{app}\gateway-manager.ps1"""; WorkingDir: "{app}"; Tasks: desktopicon
[Registry]
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "ChatGPTAPIGateway"; ValueData: """{sys}\WindowsPowerShell\v1.0\powershell.exe"" -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""{app}\gateway-control.ps1"" start"; Tasks: startup; Flags: uninsdeletevalue
[Run]
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -STA -ExecutionPolicy Bypass -WindowStyle Hidden -File ""{app}\gateway-manager.ps1"""; Description: "Open ChatGPT API Gateway / 打开 ChatGPT API Gateway"; Flags: postinstall nowait skipifsilent
[Code]
function GatewayAppId(Param: String): String;
var Instance: String; I: Integer;
begin
  Result := '{47B11170-DA82-4F9B-A1BC-C35896315F09}';
  Instance := GetEnv('CHATGPT_GATEWAY_TEST_INSTANCE');
  if (Instance <> '') and (Length(Instance) <= 64) then begin
    for I := 1 to Length(Instance) do
      if not (((Instance[I] >= 'a') and (Instance[I] <= 'z')) or ((Instance[I] >= '0') and (Instance[I] <= '9')) or (Instance[I] = '-')) then Exit;
    Result := Result + '-' + Instance;
  end;
end;
function StopGateway: Boolean;
var Code: Integer;
begin
  Result := True;
  if FileExists(ExpandConstant('{app}\gateway-control.ps1')) then begin
    Result := Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'), '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + ExpandConstant('{app}\gateway-control.ps1') + '" stop', '', SW_HIDE, ewWaitUntilTerminated, Code);
    Result := Result and (Code = 0);
  end;
end;
function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  Result := '';
  if not StopGateway then Result := 'Could not stop the gateway. Wait for active requests to finish, then retry.';
end;
function InitializeUninstall: Boolean;
begin
  Result := StopGateway;
  if not Result and not UninstallSilent then MsgBox('Could not stop the gateway. Wait for active requests to finish, then retry.', mbError, MB_OK);
end;
