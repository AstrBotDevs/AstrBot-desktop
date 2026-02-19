!macro NSIS_HOOK_PREUNINSTALL
  ; Ensure packaged backend processes do not keep install files locked during uninstall.
  nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -Command "Get-CimInstance Win32_Process -Filter \"Name=''python.exe'' OR Name=''pythonw.exe''\" | Where-Object { $$_.ExecutablePath -and $$_.ExecutablePath.ToLower().StartsWith(''$INSTDIR''.ToLower()) } | ForEach-Object { Stop-Process -Id $$_.ProcessId -Force -ErrorAction SilentlyContinue }"'
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ; Keep behavior aligned with NSIS checkbox: only remove user data when user asked for it.
  ${If} $DeleteAppDataCheckboxState = 1
  ${AndIf} $UpdateMode <> 1
    ExpandEnvStrings $0 "%USERPROFILE%"
    RmDir /r "$0\.astrbot"
  ${EndIf}
!macroend
