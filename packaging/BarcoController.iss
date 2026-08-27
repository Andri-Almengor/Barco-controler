#define MyAppName "Barco Controller"
#define MyAppVersion "0.7.0"
#define MyAppPublisher "Andri-Almengor"
#define MyAppExeName "BarcoController.exe"

[Setup]
; IMPORTANT: keep this AppId unchanged so every new installer upgrades the
; existing Barco Controller installation instead of creating another product.
AppId={{25DF5D40-59C9-4DFD-8C2B-52E1F7EA77B0}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
VersionInfoVersion=0.7.0.0
AppPublisher={#MyAppPublisher}
DefaultDirName={autopf}\Barco Controller
DefaultGroupName=Barco Controller
OutputDir=..\installer_output
OutputBaseFilename=BarcoController-Setup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
UninstallDisplayIcon={app}\{#MyAppExeName}

; Upgrade behavior: keep the same application identity/folder/tasks and close
; the previous desktop process before replacing the PyInstaller bundle.
UsePreviousAppDir=yes
UsePreviousGroup=yes
UsePreviousTasks=yes
DirExistsWarning=no
CloseApplications=yes
CloseApplicationsFilter={#MyAppExeName}
RestartApplications=no
RestartIfNeededByRun=no
SetupLogging=yes

[Tasks]
Name: "desktopicon"; Description: "Crear acceso directo en el escritorio"; GroupDescription: "Accesos directos:"; Flags: unchecked
Name: "autostart"; Description: "Iniciar Barco Controller al iniciar sesión en Windows"; GroupDescription: "Inicio automático:"; Flags: checkedonce
Name: "tightvnc"; Description: "Preparar TightVNC Server para el renderer web (recomendado)"; GroupDescription: "Renderer sin Gateway:"; Flags: checkedonce

; Remove stale PyInstaller runtime files from an older build before copying the
; fresh bundle. Runtime configuration/data live under %LOCALAPPDATA% and are not
; touched by this cleanup.
[InstallDelete]
Type: filesandordirs; Name: "{app}\_internal"
Type: files; Name: "{app}\{#MyAppExeName}"

[Files]
Source: "..\dist\BarcoController\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\scripts\configure_vnc_windows.ps1"; DestDir: "{app}\scripts"; Flags: ignoreversion

[Icons]
Name: "{group}\Barco Controller"; Filename: "{app}\{#MyAppExeName}"
Name: "{autodesktop}\Barco Controller"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon
Name: "{userstartup}\Barco Controller"; Filename: "{app}\{#MyAppExeName}"; Tasks: autostart

[Run]
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\scripts\configure_vnc_windows.ps1"" -InstallIfMissing -Port 5900"; Description: "Configurar TightVNC para el renderer"; Tasks: tightvnc; Flags: waituntilterminated
Filename: "{app}\{#MyAppExeName}"; Description: "Abrir Barco Controller"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
Type: filesandordirs; Name: "{app}\scripts"

[Code]
function InitializeSetup(): Boolean;
begin
  Result := True;
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ResultCode: Integer;
  TaskKillPath: String;
begin
  Result := '';
  TaskKillPath := ExpandConstant('{sys}\taskkill.exe');

  // During an in-place upgrade the old tray process can keep the single-instance
  // mutex alive for a short time even after its HTTP listener has stopped. Stop
  // the complete process tree explicitly before old binaries are removed.
  if FileExists(TaskKillPath) then
  begin
    Exec(
      TaskKillPath,
      '/IM "{#MyAppExeName}" /T /F',
      '',
      SW_HIDE,
      ewWaitUntilTerminated,
      ResultCode
    );
    Sleep(1200);
  end;
end;