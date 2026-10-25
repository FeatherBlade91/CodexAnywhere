!macro customInstall
  ; A standalone icon path avoids stale executable-icon cache entries on upgrade.
  ${If} ${FileExists} "$newDesktopLink"
    CreateShortCut "$newDesktopLink" "$appExe" "" "$INSTDIR\resources\app-icon.ico" 0 "" "" "${APP_DESCRIPTION}"
    WinShell::SetLnkAUMI "$newDesktopLink" "${APP_ID}"
  ${EndIf}
  ${If} ${FileExists} "$newStartMenuLink"
    CreateShortCut "$newStartMenuLink" "$appExe" "" "$INSTDIR\resources\app-icon.ico" 0 "" "" "${APP_DESCRIPTION}"
    WinShell::SetLnkAUMI "$newStartMenuLink" "${APP_ID}"
  ${EndIf}
  WriteRegStr SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" "DisplayIcon" "$INSTDIR\resources\app-icon.ico"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

!macro customUnInstall
  ; Upgrades run the old uninstaller with --updated /KEEP_APP_DATA.
  ; Never disconnect clients or remove credentials during an upgrade.
  ${GetParameters} $R0
  ClearErrors
  ${GetOptions} $R0 "/KEEP_APP_DATA" $R1
  ${If} ${Errors}
    ${IfNot} ${isUpdated}
      ClearErrors
      ExecWait '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --uninstall-cleanup --silent --uninstall-state-dir "$LOCALAPPDATA\CodexAnywhere"' $R2
      ${If} ${Errors}
        StrCpy $R2 "2"
      ${EndIf}
      ${If} $R2 != "0"
        MessageBox MB_OK|MB_ICONSTOP "Could not safely restore client settings. Close Claude Code and CC Switch, then retry. If needed, use Restore in Codex-Anywhere first. Your installation and data have been preserved." /SD IDOK
        SetErrorLevel 2
        Quit
      ${EndIf}
      ; Exact application-owned directory only. The helper never removes data.
      SetShellVarContext current
      RMDir /r "$LOCALAPPDATA\CodexAnywhere"
      IfFileExists "$LOCALAPPDATA\CodexAnywhere\*.*" 0 +4
        MessageBox MB_OK|MB_ICONSTOP "Could not remove Codex-Anywhere data. Close programs using this folder and retry uninstall." /SD IDOK
        SetErrorLevel 2
        Quit
      ${If} $installMode == "all"
        SetShellVarContext all
      ${EndIf}
    ${EndIf}
  ${EndIf}
!macroend
