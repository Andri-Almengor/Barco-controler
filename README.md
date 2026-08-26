# Barco Controller

Controlador web reutilizable para **Barco CTRL**. El proyecto separa la lógica de operación del wall, recorridos, cámaras, contenido de Internet, configuración y UI para poder instalar la misma aplicación en diferentes sitios sin cambiar el código fuente.

## Objetivos

- Operar workplaces de CTRL mediante Operate API.
- Crear recorridos de composiciones y fuentes.
- Interrumpir recorridos por eventos de cámaras sin que los procesos compitan por el wall.
- Mostrar páginas web, imágenes y videos por URL **sin usar Barco Gateway**.
- Configurar servidor CTRL, OIDC, TLS, workplaces y renderer desde la interfaz.
- Arrancar aun cuando no exista `config.yaml` y mostrar un asistente de primera ejecución.
- Mantener credenciales y datos locales fuera de Git.

## Contenido de Internet sin Barco Gateway

La documentación actual de Barco CTRL indica que las **Common Web Sources** que pueden mostrarse en CTRLwall usan Barco Gateway. Para evitar esa dependencia, Barco Controller implementa un renderer local:

```text
URL de Internet
     |
     v
Edge / Chrome en el PC del Controller
     |
     v
Servidor VNC del PC
     |
     v
Fuente VNC configurada en Barco CTRL
     |
     v
CTRLwall / Workplace
```

El backend administra el navegador. Cuando se selecciona un contenido externo:

1. valida que la URL sea HTTP/HTTPS;
2. abre el contenido en Edge/Chrome/Chromium;
3. espera el tiempo de arranque configurado;
4. aplica al workplace la fuente VNC asociada al renderer.

Tipos soportados:

- `web`: abre la URL directamente en el navegador;
- `image`: abre una página local de pantalla completa con la imagen remota;
- `video`: abre una página local con reproducción automática y loop de un archivo de video compatible con el navegador.

Para YouTube, dashboards interactivos y plataformas web use el tipo **web**.

### Requisito del renderer

El PC debe tener un servidor VNC accesible por Barco CTRL y esa conexión debe existir como una fuente VNC en CTRL. El ID de esa fuente se selecciona una sola vez en **Configuración > Renderer Internet**.

> `noVNC` es un cliente VNC, no un servidor VNC. La arquitectura de este proyecto toma sus principios de separación de responsabilidades y estados, pero la captura del PC requiere un servidor VNC real.

## Primera instalación en Windows

Desde PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File .\install_windows.ps1
```

Luego:

```bat
start_controller.bat
```

Abra:

```text
http://127.0.0.1:8080
```

Si es la primera ejecución aparecerá el asistente de configuración. No es necesario crear `config.yaml` manualmente.

### El asistente permite configurar

- URL/IP del servidor Barco CTRL;
- API base;
- realm OIDC;
- client ID;
- validación TLS;
- workplace principal y geometría;
- host/puerto de Barco Controller;
- navegador del renderer;
- modo kiosk/fullscreen/app;
- fuente VNC de Barco asociada al renderer.

La configuración queda en `backend/config/config.yaml` y está excluida de Git.

## Desarrollo

```bat
run_dev.bat
```

El frontend Vite usa proxy hacia `127.0.0.1:8080`.

Para compilar la UI integrada en Flask:

```bash
cd frontend
npm install
npm run build
```

Vite escribe el resultado directamente en `backend/static/`.

## Arquitectura

```text
React UI
   |
   v
Flask API
   |
   +-- StateManager / Setup
   +-- RouteEngine
   +-- CameraEngine
   +-- ExternalRendererService
   |
   v
WorkplaceController   <-- único escritor de workplaces
   |
   v
CtrlApiClient + OIDC
   |
   v
Barco CTRL
```

`WorkplaceController` sigue siendo el único componente que modifica contenido en el wall. Recorridos, cámaras, acciones manuales y contenido de Internet deben pasar por él.

## Recorridos

Un recorrido puede mezclar:

```json
[
  { "kind": "composition", "id": "...", "label": "Operación" },
  { "kind": "source", "id": "...", "label": "Cámara" },
  { "kind": "external", "id": "...", "label": "Dashboard web" }
]
```

Para un item `external`, el RouteEngine prepara primero el renderer y luego coloca la fuente VNC correspondiente en el workplace.

## Seguridad

- Las contraseñas de cámaras nunca se devuelven al navegador.
- `backend/data/` no se publica en Git.
- `config.yaml` no se publica en Git.
- La configuración inicial solo se permite desde localhost de forma predeterminada.
- Para habilitar configuración inicial remota de forma intencional use `BARCO_ALLOW_REMOTE_SETUP=1`.
- Después de configurar el sistema, editar configuración requiere una sesión válida de operador CTRL.
- Las URLs externas solo aceptan `http://` y `https://`.
- OIDC y JWT siguen siendo la autenticación hacia Barco CTRL.

## Servicio de Windows y renderer

El backend puede ejecutarse como servicio mediante `backend/service.py`, pero Windows Services se ejecutan normalmente en **Session 0**. Una ventana de navegador lanzada desde Session 0 no aparece en el escritorio que captura VNC.

Por eso, cuando se utilice el renderer de páginas/videos/imágenes, ejecute `start_controller.bat` dentro de la sesión de Windows que captura el servidor VNC. Una fase posterior puede separar el renderer en un agente de sesión de usuario y mantener el backend como servicio.

## Datos locales

Se generan en `backend/data/`:

- `routes.json`
- `camera_rules.json`
- `external_sources.json`
- perfiles de navegador del renderer

Todos permanecen locales al equipo.
