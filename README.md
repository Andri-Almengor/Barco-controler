# Barco Controller

Aplicación reutilizable para operar **Barco CTRL** con recorridos, cámaras, contenido de Internet sin Gateway, diagnóstico y configuración desde una interfaz web local.

> El proyecto mantiene una implementación propia. La interfaz toma como referencia visual el proyecto CTRL suministrado: shell grafito, barra superior compacta, navegación lateral, editores en dos columnas, azul para acciones principales y rojo para acciones destructivas. La lógica antigua del proyecto de referencia no se reutiliza.

## Instalación para usuario final

El objetivo de distribución es un único archivo:

```text
BarcoController-Setup.exe
        ↓
Instalar
        ↓
Abrir Barco Controller
        ↓
Asistente de primera ejecución
        ↓
Configurar CTRL + Workplace + VNC
        ↓
Usar
```

El usuario final **no necesita Python, Node.js, npm, pip, un entorno virtual ni PowerShell para iniciar la aplicación**.

El instalador:

- instala `BarcoController.exe` en `Program Files`;
- crea accesos directos;
- puede iniciar Barco Controller al iniciar sesión en Windows;
- puede preparar TightVNC para el renderer web;
- abre Barco Controller al finalizar;
- deja la configuración y datos operativos en `%LOCALAPPDATA%\BarcoController`.

### Datos de la instalación

En una instalación congelada los archivos editables no se escriben en `Program Files`:

```text
%LOCALAPPDATA%\BarcoController\
├── config\config.yaml
├── data\routes.json
├── data\camera_rules.json
├── data\external_sources.json
├── data\browser-profile-main\
└── logs\
```

Esto permite que un usuario estándar cambie recorridos, cámaras y configuración sin ejecutar la aplicación como Administrador.

## Ejecutable de escritorio

`BarcoController.exe` contiene el backend Python y el frontend React compilado. Al iniciarse:

1. comprueba si ya existe otra instancia;
2. inicia Waitress en el puerto configurado;
3. abre `http://127.0.0.1:<puerto>` en el navegador;
4. queda disponible en el área de notificación de Windows;
5. el menú de bandeja permite **Abrir Barco Controller** o **Salir**.

Se ejecuta en la sesión interactiva del usuario porque el renderer de páginas web debe estar visible en la misma sesión que captura VNC.

## Builder.exe para generar el instalador

Para desarrollo existe un ejecutable gráfico separado:

```text
BarcoController-Builder.exe
        ↓
Seleccionar carpeta Barco-controler
        ↓
Comprobar herramientas
        ↓
Generar instalador
        ↓
installer_output\BarcoController-Setup.exe
```

El Builder evita tener que recordar comandos. Muestra el proceso en una ventana, detecta Python, Node/npm, Inno Setup y PowerShell, y puede instalar las herramientas faltantes mediante WinGet. También permite omitir las pruebas backend cuando se necesita una compilación rápida.

`Builder.exe` es una herramienta para quien desarrolla/compila el proyecto; el usuario final solo necesita `BarcoController-Setup.exe`.

El código fuente del Builder está en `tools/installer_builder.py` y el ejecutable compilado queda versionado directamente en:

```text
tools/bin/BarcoController-Builder.exe
```

GitHub Actions vuelve a compilarlo y actualiza automáticamente ese archivo después de una compilación correcta. También lo publica como artifact independiente.

## Construir el Setup.exe

También se puede ejecutar directamente:

```powershell
.\build_windows.ps1
```

El script compila React, ejecuta las pruebas, congela Python con PyInstaller y genera `installer_output\BarcoController-Setup.exe` mediante Inno Setup.

La detección de Inno Setup busca `ISCC.exe` en PATH, `Program Files`, `%LOCALAPPDATA%\Programs\Inno Setup 6` y las claves de registro de Windows. Si no está instalado y WinGet está disponible, intenta instalarlo para el usuario actual y vuelve a detectarlo.

`.github/workflows/windows-installer.yml` construye automáticamente tanto `BarcoController-Setup.exe` como `BarcoController-Builder.exe` en un runner Windows.

## Interfaz CTRL-style

La interfaz propia conserva los patrones más útiles del proyecto de referencia:

- fondo grafito oscuro;
- topbar compacta;
- navegación lateral de aproximadamente 300 px;
- selector de Workplace visible antes de las herramientas;
- paneles con borde fino y baja curvatura;
- editores de lista + detalle en dos columnas;
- estado activo claramente destacado;
- acciones primarias en azul;
- acciones destructivas en rojo;
- logs y diagnósticos integrados en el mismo lenguaje visual.

No se conserva la ejecución de recorridos desde temporizadores del navegador. Toda la lógica crítica permanece en backend.

## Arquitectura

```text
React UI
   │
   ▼
Flask / Waitress
   │
   ├── StateManager / Setup
   ├── RouteEngine
   ├── CameraEngine
   ├── ExternalRendererService
   └── DiagnosticsService
   │
   ▼
WorkplaceController   ← único escritor del wall
   │
   ▼
CtrlApiClient + OIDC
   │
   ▼
Barco CTRL
```

## Contenido de Internet sin Barco Gateway

```text
URL / imagen / video
        ↓
Edge / Chrome / Chromium
        ↓
Escritorio del PC renderer
        ↓
TightVNC / RFB
        ↓
Fuente VNC en CTRL
        ↓
Workplace
```

Tipos: `web`, `image` y `video`. Los recorridos pueden mezclar `composition`, `source` y `external`.

## Primera configuración

El asistente permite configurar CTRL/OIDC/TLS, detectar workplaces y fuentes, seleccionar el Workplace principal, definir geometría, seleccionar la fuente VNC, navegador y modo del renderer, y configurar host/puerto VNC y del Controller.

Las credenciales CTRL usadas para la detección inicial son temporales y no se almacenan en `config.yaml`.

## Diagnóstico

La pantalla de diagnóstico comprueba Controller, configuración, navegador, VNC mediante handshake RFB real, Internet, CTRL/OIDC, sesión del operador, Workplace, fuente VNC y renderer.

## VNC

El instalador puede ejecutar `scripts/configure_vnc_windows.ps1` para preparar TightVNC. La configuración recomendada habilita RFB, deshabilita HTTP y transferencia de archivos, bloquea entrada remota y restringe el firewall a la red autorizada.

## Desarrollo

Para desarrollo local todavía puede usarse `run_dev.bat` o `install_windows.ps1`. El modo de desarrollo mantiene `backend/config/` y `backend/data/`; el ejecutable congelado usa automáticamente `%LOCALAPPDATA%\BarcoController`.

## Seguridad

- credenciales de cámaras no se devuelven al frontend;
- configuración y datos operativos no se publican en Git;
- configuración inicial remota deshabilitada por defecto;
- acciones operativas requieren sesión CTRL válida;
- URLs externas solo aceptan HTTP/HTTPS;
- datos de runtime separados de archivos de aplicación;
- una sola instancia de escritorio por sesión;
- VNC se valida mediante protocolo RFB y no solo por puerto TCP.
