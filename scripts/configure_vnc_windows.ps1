param(
  [int]$Port = 5900,
  [string]$RemoteAddress = "LocalSubnet",
  [switch]$InstallIfMissing
)

$ErrorActionPreference = "Stop"

function Assert-Administrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Ejecuta PowerShell como Administrador para instalar o configurar el servidor VNC."
  }
}

function Find-TightVNC {
  $paths = @(
    "$env:ProgramFiles\TightVNC\tvnserver.exe",
    "${env:ProgramFiles(x86)}\TightVNC\tvnserver.exe"
  )
  foreach ($path in $paths) {
    if ($path -and (Test-Path $path)) { return $path }
  }
  return $null
}

function ConvertTo-PlainText([Security.SecureString]$Secure) {
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Secure)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}

Assert-Administrator
if ($Port -lt 1 -or $Port -gt 65535) { throw "Puerto VNC inválido: $Port" }

$server = Find-TightVNC
if (-not $server -and $InstallIfMissing) {
  if (-not (Get-Command winget.exe -ErrorAction SilentlyContinue)) {
    throw "No se encontró winget. Instala App Installer o TightVNC manualmente y vuelve a ejecutar este script."
  }

  Write-Host "TightVNC Server no está instalado. Se instalará el paquete oficial GlavSoft.TightVNC." -ForegroundColor Yellow
  Write-Host "La contraseña se usa para autenticación VNC y NO se guarda en Barco Controller."
  $securePassword = Read-Host "Contraseña VNC (mínimo 6 caracteres; usa una contraseña dedicada)" -AsSecureString
  $plainPassword = ConvertTo-PlainText $securePassword
  if ($plainPassword.Length -lt 6) { throw "La contraseña VNC debe tener al menos 6 caracteres." }

  $override = @(
    "ADDLOCAL=Server",
    "SERVER_REGISTER_AS_SERVICE=1",
    "SERVER_ADD_FIREWALL_EXCEPTION=0",
    "SET_RFBPORT=1", "VALUE_OF_RFBPORT=$Port",
    "SET_ACCEPTRFBCONNECTIONS=1", "VALUE_OF_ACCEPTRFBCONNECTIONS=1",
    "SET_ACCEPTHTTPCONNECTIONS=1", "VALUE_OF_ACCEPTHTTPCONNECTIONS=0",
    "SET_ALLOWLOOPBACK=1", "VALUE_OF_ALLOWLOOPBACK=1",
    "SET_LOOPBACKONLY=1", "VALUE_OF_LOOPBACKONLY=0",
    "SET_BLOCKREMOTEINPUT=1", "VALUE_OF_BLOCKREMOTEINPUT=1",
    "SET_USEVNCAUTHENTICATION=1", "VALUE_OF_USEVNCAUTHENTICATION=1",
    "SET_PASSWORD=1", "VALUE_OF_PASSWORD=$plainPassword"
  ) -join " "

  try {
    & winget.exe install --id GlavSoft.TightVNC --exact --silent --accept-package-agreements --accept-source-agreements --override $override
    if ($LASTEXITCODE -ne 0) { throw "winget terminó con código $LASTEXITCODE" }
  } finally {
    $plainPassword = $null
    $securePassword = $null
  }
  Start-Sleep -Seconds 2
  $server = Find-TightVNC
}

if (-not $server) {
  throw "No se encontró TightVNC Server. Ejecuta con -InstallIfMissing para instalarlo."
}

$reg = "HKLM:\SOFTWARE\TightVNC\Server"
if (-not (Test-Path $reg)) { New-Item -Path $reg -Force | Out-Null }
$values = @{
  RfbPort = $Port
  AcceptRfbConnections = 1
  AcceptHttpConnections = 0
  AllowLoopback = 1
  LoopbackOnly = 0
  BlockRemoteInput = 1
  EnableFileTransfers = 0
  RunControlInterface = 0
  DisconnectAction = 0
}
foreach ($name in $values.Keys) {
  New-ItemProperty -Path $reg -Name $name -Value $values[$name] -PropertyType DWord -Force | Out-Null
}

$ruleName = "Barco Controller VNC Renderer"
Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction SilentlyContinue
New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Action Allow -Protocol TCP -LocalPort $Port -Profile Domain,Private -RemoteAddress $RemoteAddress | Out-Null

$service = Get-Service -Name tvnserver -ErrorAction SilentlyContinue
if ($service) {
  Restart-Service -Name tvnserver -Force
} else {
  & $server -reinstall -silent
  & $server -start -silent
}

Start-Sleep -Seconds 1
$test = Test-NetConnection -ComputerName 127.0.0.1 -Port $Port -WarningAction SilentlyContinue
if (-not $test.TcpTestSucceeded) {
  Write-Warning "TightVNC fue configurado, pero el puerto $Port aún no responde. Revisa el servicio tvnserver."
} else {
  Write-Host "VNC listo en 127.0.0.1:$Port" -ForegroundColor Green
}
Write-Host "Seguridad aplicada: HTTP desactivado, transferencia de archivos desactivada y entrada remota bloqueada."
