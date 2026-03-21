; ==========================================================================
; Spark Curiosity – Inno Setup Installer
;
; Produces a single SparkSetup.exe that:
;   1. Copies bundled Node.js + app to %LOCALAPPDATA%\SparkCuriosity\app
;   2. Writes Chrome extension registry keys (HKCU – no admin required)
;   3. Creates auto-start entry
;   4. Launches the runtime + opens onboarding in browser
;
; Build:  iscc installer\spark-setup.iss
; Prereq: Run scripts\build-dist.ps1 first to create dist-package\
; ==========================================================================

#define MyAppName "Spark Curiosity"
#define MyAppPublisher "Spark"
#define MyAppURL "https://github.com/your-repo/spark-curiosity"

; Read version from package.json (fallback to 0.1.0)
#define MyAppVersion "0.1.0"

[Setup]
AppId={{8F2C4A7E-3B1D-4E5F-A6C8-9D0E1F2A3B4C}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
DefaultDirName={localappdata}\SparkCuriosity\app
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir=..\dist-installer
OutputBaseFilename=SparkSetup
Compression=lzma2/ultra
SolidCompression=yes
WizardStyle=modern
; Disable the directory selection page (always install to %LOCALAPPDATA%)
DisableDirPage=yes

[Languages]
Name: "german"; MessagesFile: "compiler:Languages\German.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Files]
; Copy the entire dist-package folder
Source: "..\dist-package\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs

[Dirs]
; Ensure data directories exist
Name: "{localappdata}\SparkCuriosity\config"
Name: "{localappdata}\SparkCuriosity\logs"
Name: "{localappdata}\SparkCuriosity\extension"

[Registry]
; Chrome extension auto-install via HKCU policy (no admin needed)
; The extension ID will be set by the post-install script after CRX packing
; For now, allow companion as extension source
Root: HKCU; Subkey: "Software\Policies\Google\Chrome\ExtensionInstallSources"; ValueType: string; ValueName: "1"; ValueData: "http://127.0.0.1:4343/*"; Flags: createvalueifdoesntexist noerror
; Same for Edge
Root: HKCU; Subkey: "Software\Policies\Microsoft\Edge\ExtensionInstallSources"; ValueType: string; ValueName: "1"; ValueData: "http://127.0.0.1:4343/*"; Flags: createvalueifdoesntexist noerror

[Icons]
; Start menu shortcut
Name: "{userprograms}\{#MyAppName}"; Filename: "{app}\spark-runtime.cmd"; WorkingDir: "{app}"; Comment: "Start Spark Curiosity"

[Run]
; Post-install: copy baked-in config to user config dir (if not already present)
Filename: "{cmd}"; Parameters: "/c if not exist ""{localappdata}\SparkCuriosity\config\runtime.env"" copy ""{app}\config\runtime.env"" ""{localappdata}\SparkCuriosity\config\runtime.env"""; Flags: runhidden
; Post-install: create startup entry
Filename: "{cmd}"; Parameters: "/c echo @echo off> ""{userstartup}\SparkCuriosity.bat"" & echo powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""{app}\scripts\windows\start-runtime.ps1"" >> ""{userstartup}\SparkCuriosity.bat"""; Flags: runhidden
; Post-install: run extension installer (registers CRX + writes force-install registry keys)
Filename: "{app}\node.exe"; Parameters: "-e ""process.env.SPARK_ROOT_DIR='{app}';process.env.SPARK_WINDOWS_APP_ROOT='{localappdata}\\SparkCuriosity';require('./dist/apps/desktop-agent/src/services/extension-installer.js')"""; WorkingDir: "{app}"; Flags: runhidden waituntilterminated
; Launch runtime
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""{app}\scripts\windows\start-runtime.ps1"""; Flags: nowait postinstall
; Open onboarding in browser
Filename: "{cmd}"; Parameters: "/c timeout /t 4 /nobreak >nul & start http://127.0.0.1:4343/onboard"; Description: "Onboarding oeffnen"; Flags: nowait postinstall runhidden

[UninstallRun]
; Stop runtime before uninstall
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\scripts\windows\stop-runtime.ps1"""; Flags: runhidden waituntilterminated

[UninstallDelete]
; Clean up startup entry
Type: files; Name: "{userstartup}\SparkCuriosity.bat"
; Clean up logs (but keep user config/memory)
Type: filesandordirs; Name: "{localappdata}\SparkCuriosity\logs"
Type: filesandordirs; Name: "{localappdata}\SparkCuriosity\extension"

[Code]
// Remove Chrome extension registry keys on uninstall
procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep = usUninstall then
  begin
    RegDeleteKeyIncludingSubkeys(HKCU, 'Software\Policies\Google\Chrome\ExtensionInstallForcelist');
    RegDeleteKeyIncludingSubkeys(HKCU, 'Software\Policies\Google\Chrome\ExtensionInstallSources');
    RegDeleteKeyIncludingSubkeys(HKCU, 'Software\Policies\Microsoft\Edge\ExtensionInstallForcelist');
    RegDeleteKeyIncludingSubkeys(HKCU, 'Software\Policies\Microsoft\Edge\ExtensionInstallSources');
  end;
end;
