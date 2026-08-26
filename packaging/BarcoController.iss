#define MyAppName "Barco Controller"
#define MyAppVersion "0.4.0"
#define MyAppPublisher "Andri-Almengor"
#define MyAppExeName "BarcoController.exe"

[Setup]
AppId={{25DF5D40-59C9-4DFD-8C2B-52E1F7EA77B0}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
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
CloseApplications=yes
RestartApplications=no
AppMutex=Local\BarcoControllerDesktop
SetupLogging=yes

[Tasks]
Name: "desktopicon"; Description: "Crear acceso directo en el escritorio"; GroupDescription: "Accesos directos:"; Flags: unchecked
Name: "autostart"; Description: "Iniciar Barco Controller al iniciar sesión en Windows"; GroupDescription: "Inicio automático:"; Flags: checkedonce
Name: "tightvnc"; Description: "Preparar TightVNC Server para el renderer web (recomendado)"; GroupDescription: "Renderer sin Gateway:"; Flags: checkedonce

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
