# Barco Controller

Controlador web propio para Barco CTRL, construido a partir del prototipo original del proyecto y reorganizado con una arquitectura modular orientada a estados, servicios y eventos.

> El proyecto toma como referencia patrones de arquitectura observados en noVNC (separación entre núcleo y UI, estado explícito de conexión/ejecución, eventos, configuración desacoplada y manejo robusto de reconexión), pero **no incorpora ni copia código de noVNC**.

## Objetivos

- Controlar fuentes y composiciones de Barco CTRL desde una interfaz web propia.
- Crear y ejecutar recorridos por workplace.
- Detener, pausar y reanudar recorridos de forma confiable desde el backend.
- Interrumpir un recorrido ante eventos de cámara, mostrar la fuente/composición durante un tiempo definido, limpiar el wall y reanudar el recorrido.
- Administrar N cámaras/reglas desde la interfaz.
- Mantener credenciales y datos operativos fuera de Git.
- Ejecutar como aplicación normal o servicio de Windows.

## Arquitectura

```text
React UI
   │
   │ REST /api
   ▼
Flask API
   │
   ├── AuthService (OIDC)
   ├── CtrlApiClient
   ├── WorkplaceController  ← único punto que escribe en el wall
   ├── RouteEngine          ← máquina de estados de recorridos
   ├── CameraEngine         ← eventos/monitoreo de cámaras
   └── JSON repositories    ← persistencia local
             │
             ▼
          Barco CTRL
```

La regla principal es que **ningún componente escribe directamente al workplace salvo `WorkplaceController`**. Esto elimina las carreras entre recorrido, botón manual y eventos de cámaras.

## Cambios principales respecto al prototipo

- El recorrido ya no depende de `setTimeout()` del navegador. Se ejecuta en el backend.
- `STOP` es un estado real del motor; no existe un temporizador viejo capaz de volver a arrancar el recorrido.
- Los eventos de cámara adquieren control exclusivo del workplace, limpian el wall, muestran el contenido configurado, esperan la duración, vuelven a limpiar y liberan el workplace.
- Al terminar la interrupción, el recorrido continúa únicamente si seguía en estado `running` antes/durante el evento.
- Se elimina la implementación duplicada de `camera_engine`.
- Las contraseñas RTSP no se devuelven por API y no se incluyen en el repositorio.
- CORS abierto se elimina por defecto; el frontend y backend trabajan same-origin en producción.
- Se añaden cabeceras HTTP de seguridad.
- Configuración operativa y secretos quedan fuera de Git.

## Configuración

1. Copia:

```bat
copy backend\config\config.yaml.example backend\config\config.yaml
```

2. Edita `backend/config/config.yaml` con la IP/URL del CTRL, workplaces y geometrías.

3. Si el cliente OIDC usa secreto:

```bat
set CTRL_CLIENT_SECRET=tu_secreto
```

Las contraseñas de cámaras se almacenan únicamente en `backend/data/camera_rules.json`, que está ignorado por Git.

## Backend

```bat
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python run_waitress.py --host 127.0.0.1 --port 8080
```

## Frontend - desarrollo

```bat
cd frontend
npm install
npm run dev
```

Vite enviará `/api` a `http://127.0.0.1:8080`.

## Frontend - producción

```bat
cd frontend
npm install
npm run build
```

Después copia `frontend/dist` a `backend/static` si deseas que Flask sirva el frontend.

## Flujo de una interrupción de cámara

```text
Recorrido RUNNING
      │
      ▼
Movimiento detectado
      │
      ▼
CameraEngine encola evento
      │
      ▼
WorkplaceController toma control exclusivo
      │
      ├── limpia workplace
      ├── aplica fuente/composición de cámara
      ├── mantiene N segundos
      └── limpia workplace
      │
      ▼
libera control
      │
      ▼
RouteEngine continúa desde el siguiente elemento
```

## Seguridad

- No subas `backend/config/config.yaml`.
- No subas `backend/data/*.json`.
- En producción usa TLS válido y `verify_tls: true`.
- Usa HTTPS para la interfaz cuando sea accesible desde otras estaciones.
- Mantén el acceso al puerto del backend limitado a las redes de administración necesarias.
