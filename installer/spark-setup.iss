; ==========================================================================
; Spark Curiosity – Inno Setup Installer
;
; Produces a single SparkSetup.exe that:
;   1. Copies bundled Node.js + app to %LOCALAPPDATA%\SparkCuriosity\app
;   2. Copies Chrome extension to %LOCALAPPDATA%\SparkCuriosity\extension
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

[CustomMessages]
german.LaunchSpark=Spark starten
english.LaunchSpark=Launch Spark
german.OpenOnboarding=Onboarding oeffnen
english.OpenOnboarding=Open onboarding

[Files]
; Copy the entire dist-package folder
Source: "..\dist-package\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs
; Copy Chrome extension to user data dir (always overwrite on upgrade)
Source: "..\dist-package\apps\desktop-agent\extension\*"; DestDir: "{localappdata}\SparkCuriosity\extension"; Flags: recursesubdirs createallsubdirs

[Dirs]
; Ensure data directories exist
Name: "{localappdata}\SparkCuriosity\config"
Name: "{localappdata}\SparkCuriosity\logs"
Name: "{localappdata}\SparkCuriosity\extension"

[Icons]
; Start menu shortcut
Name: "{userprograms}\{#MyAppName}"; Filename: "{app}\spark-runtime.cmd"; WorkingDir: "{app}"; Comment: "Start Spark Curiosity"

[Run]
; Restore user-memory.md after upgrade (bundled file would otherwise overwrite)
Filename: "{cmd}"; Parameters: "/c if exist ""{tmp}\spark-user-memory.backup.md"" copy /Y ""{tmp}\spark-user-memory.backup.md"" ""{app}\apps\companion\data\user-memory.md"""; Flags: runhidden
; Post-install: copy baked-in config to user config dir (if not already present)
Filename: "{cmd}"; Parameters: "/c if not exist ""{localappdata}\SparkCuriosity\config\runtime.env"" copy ""{app}\config\runtime.env"" ""{localappdata}\SparkCuriosity\config\runtime.env"""; Flags: runhidden
; Write selected installer language to runtime.env (map german→de, english→en)
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -Command ""$f='{localappdata}\SparkCuriosity\config\runtime.env'; $lang=if('{language}' -eq 'german'){{'de'}}else{{'en'}}; if(Test-Path $f){{$c=Get-Content $f; if($c -match 'SPARK_LANG='){{$c=$c -replace 'SPARK_LANG=.*',('SPARK_LANG='+$lang)}}else{{$c+='SPARK_LANG='+$lang}}; $c|Set-Content $f}}"""; Flags: runhidden
; Upgrade: rename SPARK_GROK_MODEL -> SPARK_MODEL, then update model to bundled version
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -Command ""$f='{localappdata}\SparkCuriosity\config\runtime.env'; if(Test-Path $f){{(Get-Content $f) -replace 'SPARK_GROK_MODEL=','SPARK_MODEL=' | Set-Content $f}}"""; Flags: runhidden
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -Command ""$f='{localappdata}\SparkCuriosity\config\runtime.env'; $b='{app}\config\runtime.env'; $m='@cf/qwen/qwen3-30b-a3b-fp8'; if(Test-Path $b){{$l=Select-String 'SPARK_MODEL=(.+)' $b; if($l){{$m=$l.Matches[0].Groups[1].Value}}}}; if(Test-Path $f){{(Get-Content $f) -replace 'SPARK_MODEL=.*',('SPARK_MODEL='+$m) | Set-Content $f}}"""; Flags: runhidden
; Post-install: create startup entry
Filename: "{cmd}"; Parameters: "/c echo @echo off> ""{userstartup}\SparkCuriosity.bat"" & echo powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""{app}\scripts\windows\start-runtime.ps1"" >> ""{userstartup}\SparkCuriosity.bat"""; Flags: runhidden
; Upgrade/reinstall: stop old runtime first. Otherwise start-runtime.ps1 exits with "Already running"
; and never launches run-runtime.ps1 — stale ActiveWindowWatcher overlay + old Node bundle stay in memory.
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\scripts\windows\stop-runtime.ps1"""; Flags: runhidden waituntilterminated
; Launch runtime (run-runtime.ps1 respawns overlay with new native + companion JS)
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""{app}\scripts\windows\start-runtime.ps1"""; Description: "{cm:LaunchSpark}"; Flags: nowait postinstall
; Open onboarding only when not completed (see ShouldOpenOnboardingPage in [Code])
Filename: "{cmd}"; Parameters: "/c timeout /t 4 /nobreak >nul & start http://127.0.0.1:4343/onboard"; Description: "{cm:OpenOnboarding}"; Flags: nowait postinstall runhidden; Check: ShouldOpenOnboardingPage
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

