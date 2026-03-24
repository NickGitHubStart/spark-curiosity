; ==========================================================================
; Spark Curiosity – Inno Setup Installer
;
; Produces a single SparkSetup.exe that:
;   1. Copies bundled Node.js + app to %LOCALAPPDATA%\SparkCuriosity\app
;   2. Writes Chrome extension registry keys (HKCU – no admin required)
;   3. Creates auto-start entry
;   4. Launches the runtime; opens /onboard only if onboarding not yet completed
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
; Restore user-memory.md after upgrade (bundled file would otherwise overwrite)
Filename: "{cmd}"; Parameters: "/c if exist ""{tmp}\spark-user-memory.backup.md"" copy /Y ""{tmp}\spark-user-memory.backup.md"" ""{app}\apps\companion\data\user-memory.md"""; Flags: runhidden
; Post-install: copy baked-in config to user config dir (if not already present)
Filename: "{cmd}"; Parameters: "/c if not exist ""{localappdata}\SparkCuriosity\config\runtime.env"" copy ""{app}\config\runtime.env"" ""{localappdata}\SparkCuriosity\config\runtime.env"""; Flags: runhidden
; Upgrade fix: replace deprecated model name in existing user config
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -Command ""$f='{localappdata}\SparkCuriosity\config\runtime.env'; if(Test-Path $f){{(Get-Content $f) -replace 'grok-4-1-fast-reasoning','grok-4-1-fast' | Set-Content $f}}"""; Flags: runhidden
; Post-install: create startup entry
Filename: "{cmd}"; Parameters: "/c echo @echo off> ""{userstartup}\SparkCuriosity.bat"" & echo powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""{app}\scripts\windows\start-runtime.ps1"" >> ""{userstartup}\SparkCuriosity.bat"""; Flags: runhidden
; Post-install: run extension installer (registers CRX + writes force-install registry keys)
Filename: "{app}\node.exe"; Parameters: "-e ""process.env.SPARK_ROOT_DIR='{app}';process.env.SPARK_WINDOWS_APP_ROOT='{localappdata}\\SparkCuriosity';require('./dist/apps/desktop-agent/src/services/extension-installer.js')"""; WorkingDir: "{app}"; Flags: runhidden waituntilterminated
; Launch runtime
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""{app}\scripts\windows\start-runtime.ps1"""; Description: "Spark starten"; Flags: nowait postinstall
; Open onboarding only when not completed (see ShouldOpenOnboardingPage in [Code])
Filename: "{cmd}"; Parameters: "/c timeout /t 4 /nobreak >nul & start http://127.0.0.1:4343/onboard"; Description: "Onboarding oeffnen"; Flags: nowait postinstall runhidden; Check: ShouldOpenOnboardingPage
; NOTE: Overlay is started automatically by the runtime (desktop-runtime startOverlay()).
; Do NOT start it separately here — that caused duplicate overlay instances.

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
function InitializeSetup(): Boolean;
var
  Src, Dst: String;
begin
  Src := ExpandConstant('{localappdata}\SparkCuriosity\app\apps\companion\data\user-memory.md');
  Dst := ExpandConstant('{tmp}\spark-user-memory.backup.md');
  if FileExists(Src) then
    CopyFile(Src, Dst, False);
  Result := True;
end;

function SparkOnboardingComplete: Boolean;
var
  Path: String;
  Lines: TArrayOfString;
  I: Integer;
  Line, Rest, Low: String;
begin
  Result := False;
  Path := ExpandConstant('{app}\apps\companion\data\user-memory.md');
  if not FileExists(Path) then Exit;
  if not LoadStringsFromFile(Path, Lines) then Exit;
  for I := 0 to GetArrayLength(Lines) - 1 do
  begin
    Line := Trim(Lines[I]);
    if Copy(Line, 1, Length('onboardingComplete:')) = 'onboardingComplete:' then
    begin
      Rest := Trim(Copy(Line, Length('onboardingComplete:') + 1, MaxInt));
      Low := LowerCase(Rest);
      Result := (Low = 'true') or (Low = '1') or (Low = 'yes');
      Exit;
    end;
  end;
  for I := 0 to GetArrayLength(Lines) - 1 do
    if Pos('Nutzer-Anmerkung beim Onboarding', Lines[I]) > 0 then
    begin
      Result := True;
      Exit;
    end;
end;

function ShouldOpenOnboardingPage: Boolean;
begin
  Result := not SparkOnboardingComplete;
end;

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
