!include "LogicLib.nsh"

!macro preInit
  StrCpy $INSTDIR "D:\\StudyJournal\\App"
!macroend

!macro isStudyJournalRunning
  nsExec::Exec '"$SYSDIR\cmd.exe" /c tasklist /FI "IMAGENAME eq ${APP_PRODUCT_FILENAME}.exe" /FO csv | "$SYSDIR\find.exe" "${APP_PRODUCT_FILENAME}.exe"'
  Pop $R0
!macroend

!macro stopStudyJournalForUpdate
  !insertmacro isStudyJournalRunning
  ${If} $R0 != 0
    Return
  ${EndIf}

  DetailPrint "正在关闭已运行的学习日志..."
  IfFileExists "$INSTDIR\${APP_PRODUCT_FILENAME}.exe" 0 forceClose
  Exec '"$INSTDIR\${APP_PRODUCT_FILENAME}.exe" --quit-for-update'

  StrCpy $R1 0
  waitForGracefulClose:
    Sleep 500
    !insertmacro isStudyJournalRunning
    ${If} $R0 != 0
      Goto appClosed
    ${EndIf}
    IntOp $R1 $R1 + 1
    IntCmp $R1 10 forceClose waitForGracefulClose forceClose

  forceClose:
    DetailPrint "正在结束未响应的学习日志进程..."
    nsExec::Exec '"$SYSDIR\cmd.exe" /c taskkill /f /t /im "${APP_PRODUCT_FILENAME}.exe"'

    StrCpy $R1 0
    waitForForcedClose:
      Sleep 500
      !insertmacro isStudyJournalRunning
      ${If} $R0 != 0
        Goto appClosed
      ${EndIf}
      IntOp $R1 $R1 + 1
      IntCmp $R1 10 appCannotBeClosed waitForForcedClose appCannotBeClosed

  appCannotBeClosed:
    MessageBox MB_OK|MB_ICONSTOP "无法关闭学习日志。请关闭该应用或以管理员身份运行安装程序后重试。"
    Quit

  appClosed:
!macroend

!ifndef BUILD_UNINSTALLER
Function closeStudyJournalForUpdate
  !insertmacro stopStudyJournalForUpdate
FunctionEnd
!else
Function un.closeStudyJournalForUpdate
  !insertmacro stopStudyJournalForUpdate
FunctionEnd
!endif

!macro customInit
  !ifndef BUILD_UNINSTALLER
  Call closeStudyJournalForUpdate
  !endif
!macroend

!macro customCheckAppRunning
  !ifdef BUILD_UNINSTALLER
    Call un.closeStudyJournalForUpdate
  !else
    Call closeStudyJournalForUpdate
  !endif
!macroend

!macro cleanupFailedUpgrade
  ${If} $R0 != 0
    DetailPrint "旧版卸载失败，正在直接清理安装目录..."
    ClearErrors
    RMDir /r "$INSTDIR"
    ${If} ${Errors}
      MessageBox MB_OK|MB_ICONSTOP "无法清理旧版学习日志文件。请以管理员身份运行安装程序后重试。"
      Quit
    ${EndIf}
    StrCpy $R0 0
  ${EndIf}
!macroend

!macro customUnInstallCheck
  !insertmacro cleanupFailedUpgrade
!macroend

!macro customUnInstallCheckCurrentUser
  !insertmacro cleanupFailedUpgrade
!macroend
