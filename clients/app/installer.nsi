; The One App's Windows installer, built with NSIS (`makensis`) by `tooling/release` for `one/windows-x86_64`: a
; per-user install, as an app that updates itself is, so it needs no administrator. It puts `one.exe` in
; %LOCALAPPDATA%\Programs, adds that folder to the user's PATH, for `one` in a terminal, puts the app in the Start menu
; and in Settings > Apps, and opens it. From then on the app updates itself, by `one update`, as it does on Linux
; and a Mac.
;
;     makensis -DVERSION=<x.y.z> -DPROGRAM=<one.exe> -DOUTFILE=<installer.exe> [-DNETWORK=<network>] [-DSIGN=<tooling/windows-sign>] clients/app/installer.nsi
;
; Given SIGN, the program that signs Windows programs, the uninstaller it writes and the installer are signed with it
; as NSIS makes them.
;
; A network's own installer (`tooling/installers`) is given its `network` file, its address, with its name,
; identifier and command where the network names them, which it puts beside the program, so the app opens on that
; network as that network's app (`bundled` and `bundle` in core/client); and those three, which name the installer,
; its folders and the program, `ptc.exe` for PTC's, so it's an app of its own beside the One App, and its icon:
;
;     makensis ... -DNETWORK=<network> -DNAME=<name> -DIDENTIFIER=<identifier> -DCOMMAND=<command> -DICON=<.ico> clients/app/installer.nsi
!include MUI2.nsh
!include LogicLib.nsh

!ifndef NAME
  !define NAME "the One App"
!endif
; The app's Tauri identifier, which names its folders and the key Windows lists it by.
!ifndef IDENTIFIER
  !define IDENTIFIER "app.theone.client"
!endif
; What its person types to run it, which names its program.
!ifndef COMMAND
  !define COMMAND "one"
!endif
!define UNINSTALL "Software\Microsoft\Windows\CurrentVersion\Uninstall\${IDENTIFIER}"

Name "${NAME}"
OutFile "${OUTFILE}"
!ifdef SIGN
  !uninstfinalize '"${SIGN}" "%1"' = 0
  !finalize '"${SIGN}" "%1"' = 0
!endif
Unicode true
ManifestDPIAware true
RequestExecutionLevel user
SetCompressor /SOLID lzma
InstallDir "$LOCALAPPDATA\Programs\${NAME}"
BrandingText "${NAME} ${VERSION}"

VIProductVersion "${VERSION}.0"
VIAddVersionKey ProductName "${NAME}"
VIAddVersionKey CompanyName "${NAME}"
VIAddVersionKey FileDescription "${NAME} installer"
VIAddVersionKey FileVersion "${VERSION}"
VIAddVersionKey ProductVersion "${VERSION}"
VIAddVersionKey LegalCopyright "${COPYRIGHT}"

; Its icon, an .ico: a network's own (`tooling/installers`), which goes beside the program as `icon.ico`, its windows',
; its Start menu entry's and Settings > Apps' (`icon` in core/client), or the One App's, the program's own.
!ifdef ICON
  !define OWN_ICON
  !define SHOWN "$INSTDIR\icon.ico"
!else
  !define ICON "../../icons/AppIcon.ico"
  !define SHOWN "$INSTDIR\${COMMAND}.exe"
!endif
!define MUI_ICON "${ICON}"
!define MUI_UNICON "${ICON}"
!define MUI_FINISHPAGE_RUN "$INSTDIR\${COMMAND}.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Open ${NAME}"
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE English

; The task that starts a server this device is as its user signs in (`clients/cli/src/serving.rs`).
!define SERVERS "Get-ScheduledTask -TaskName '${NAME} server *'"

Section
  SetOutPath "$INSTDIR"
  ; The app and a server it keeps running are closed, as an installer closes the app it replaces, and the server is
  ; started again on the new one once it's in place.
  nsExec::Exec `powershell -NoProfile -NonInteractive -Command "${SERVERS} | Stop-ScheduledTask"`
  nsExec::Exec `taskkill /f /t /im ${COMMAND}.exe`
  ; One still running, as another user's, can't be written over but can be moved aside, as `one update` does: it
  ; carries on, and the next start is the new one. Each is put aside under a name of its own, as `one update` puts
  ; them (`one.<ms>.old`), and those put aside before that nothing runs any more go.
  Delete "$INSTDIR\${COMMAND}.*.old"
  ${If} ${FileExists} "$INSTDIR\${COMMAND}.exe"
    System::Call 'kernel32::GetTickCount64()l.r0'
    Rename "$INSTDIR\${COMMAND}.exe" "$INSTDIR\${COMMAND}.$0.old"
  ${EndIf}
  File "/oname=${COMMAND}.exe" "${PROGRAM}"
  !ifdef NETWORK
    File "/oname=network" "${NETWORK}"
  !endif
  !ifdef OWN_ICON
    File "/oname=icon.ico" "${ICON}"
  !endif
  WriteUninstaller "$INSTDIR\uninstall.exe"

  ; Beside the folder of the app's apps' shortcuts, which the app keeps (`clients/app/src/shortcuts.rs`).
  CreateShortcut "$SMPROGRAMS\${NAME}.lnk" "$INSTDIR\${COMMAND}.exe" "" "${SHOWN}"

  ; Its command in a terminal, `one`, as the user's own: Windows' PATH is the user's after the system's.
  nsExec::Exec `powershell -NoProfile -NonInteractive -Command "$$d = '$INSTDIR'; $$p = [Environment]::GetEnvironmentVariable('Path', 'User'); if (-not (($$p -split ';') -contains $$d)) { [Environment]::SetEnvironmentVariable('Path', (@($$p, $$d) | ? { $$_ }) -join ';', 'User') }"`

  nsExec::Exec `powershell -NoProfile -NonInteractive -Command "${SERVERS} | Start-ScheduledTask"`

  WriteRegStr HKCU "${UNINSTALL}" DisplayName "${NAME}"
  WriteRegStr HKCU "${UNINSTALL}" DisplayIcon "${SHOWN}"
  WriteRegStr HKCU "${UNINSTALL}" DisplayVersion "${VERSION}"
  WriteRegStr HKCU "${UNINSTALL}" Publisher "${NAME}"
  WriteRegStr HKCU "${UNINSTALL}" InstallLocation "$INSTDIR"
  WriteRegStr HKCU "${UNINSTALL}" UninstallString `"$INSTDIR\uninstall.exe"`
  WriteRegStr HKCU "${UNINSTALL}" QuietUninstallString `"$INSTDIR\uninstall.exe" /S`
  WriteRegDWORD HKCU "${UNINSTALL}" NoModify 1
  WriteRegDWORD HKCU "${UNINSTALL}" NoRepair 1
SectionEnd

; What's the app's goes, and what's the user's stays: its data, in %LOCALAPPDATA%\<identifier>, is theirs and
; their network's, as an app's is when it's uninstalled. A server this device is stays one of the network's, off, as
; when it's shut down; it runs again once the app is installed again.
Section Uninstall
  ; The app and a server it keeps running are stopped, and the task that starts the server as its user signs in
  ; (`clients/cli/src/serving.rs`) goes, so nothing runs a program that's gone.
  nsExec::Exec `powershell -NoProfile -NonInteractive -Command "${SERVERS} | % { Stop-ScheduledTask -InputObject $$_; Unregister-ScheduledTask -InputObject $$_ -Confirm:$$false }"`
  nsExec::Exec `taskkill /f /t /im ${COMMAND}.exe`
  Delete "$SMPROGRAMS\${NAME}.lnk"
  ; The shortcuts to the network's apps and the `one:` links the app keeps (`clients/app/src/shortcuts.rs`,
  ; `computer.rs`).
  RMDir /r "$SMPROGRAMS\${NAME}"
  RMDir /r "$LOCALAPPDATA\${IDENTIFIER}\shortcuts"
  DeleteRegKey HKCU "Software\Classes\one"
  nsExec::Exec `powershell -NoProfile -NonInteractive -Command "$$d = '$INSTDIR'; $$p = [Environment]::GetEnvironmentVariable('Path', 'User'); [Environment]::SetEnvironmentVariable('Path', (($$p -split ';') | ? { $$_ -and $$_ -ne $$d }) -join ';', 'User')"`
  Delete /REBOOTOK "$INSTDIR\${COMMAND}.exe"
  Delete /REBOOTOK "$INSTDIR\${COMMAND}.*.old"
  Delete "$INSTDIR\network"
  Delete "$INSTDIR\icon.ico"
  Delete "$INSTDIR\uninstall.exe"
  RMDir /REBOOTOK "$INSTDIR"
  DeleteRegKey HKCU "${UNINSTALL}"
SectionEnd
