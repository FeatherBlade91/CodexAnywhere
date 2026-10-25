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
