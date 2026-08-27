export type RouteKind = 'composition' | 'source' | 'external'
export type RouteItem = { kind: RouteKind; id: string; label?: string }
export type Route = { id: string; name: string; intervalSec: number; workplaceId: string; items: RouteItem[]; updatedAt?: number }
export type Geometry = { type: string; x: number; y: number; width: number; height: number }
export type Workplace = { id: string; name: string; role?: 'primary' | 'secondary'; geometry?: Geometry }
export type RouteRuntime = { routeId: string; routeName?: string; state: 'stopped' | 'running' | 'paused' | 'error'; index: number; lastError?: string | null; lastItem?: any; nextRunAt?: number | null }
export type CameraRule = {
  id?: string; name: string; enabled: boolean; rtspUrl?: string; username?: string; password?: string; hasPassword?: boolean;
  workplaceId?: string; displayKind?: 'composition' | 'source'; itemId?: string; itemLabel?: string; group?: string; groupCompositionId?: string;
  priority?: number; durationSec?: number; cooldownSec?: number; scheduleStart?: string; scheduleEnd?: string;
  enabledHoursOnly?: boolean; detectionMode?: 'manual' | 'frame_diff'; minArea?: number; updatedAt?: number
}
export type CameraStatus = { running: boolean; opencvAvailable: boolean; activeEvent: any | null; activeUntil: number; queue: any[]; logs: LogEntry[]; rulesCount: number }
export type LogEntry = { ts: number; level: string; message: string }
export type ExternalType = 'web' | 'image' | 'video'
export type ExternalSource = { id?: string; name: string; type: ExternalType; url: string; rendererId: string; enabled: boolean; updatedAt?: number }
export type LayoutKind = 'source' | 'composition' | 'external'
export type LayoutItem = { kind: LayoutKind; id: string; label?: string; geometry: Geometry }
export type MixedLayout = { id?: string; name: string; workplaceId: string; items: LayoutItem[]; updatedAt?: number }
export type RendererConfig = {
  id: string; name: string; barco_source_id: string; barco_source_label: string; vnc_host: string; vnc_port: number; browser_path: string;
  launch_mode: 'kiosk' | 'app' | 'fullscreen'; startup_delay_sec: number; profile_dir: string; extra_args: string[]
}
export type SystemConfig = {
  server: { host: string; port: number; cors_origins?: string[]; trust_proxy?: boolean }
  barco: {
    base_url: string; api_base: string;
    oidc: { realm: string; client_id: string; client_secret_env: string }
    tls: { verify_tls: boolean }
    request_timeout_sec: number; pre_clear_delay_ms: number
  }
  workplaces: Workplace[]
  routes: { default_interval_sec?: number; minimum_interval_sec?: number }
  cameras: Record<string, any>
  renderers: RendererConfig[]
}
export type SetupStatus = { configured: boolean; configError?: string | null; remoteSetupEnabled?: boolean }
export type DiscoveryResult = { ok: boolean; authMode: 'temporary' | 'existing-session'; selectedWorkplaceId: string; workplaces: any[]; sources: any[]; compositions: any[]; warnings: string[] }
export type DiagnosticCheck = { id: string; label: string; status: 'ok' | 'warn' | 'error'; detail: string; meta?: Record<string, any> }
export type DiagnosticsResult = {
  ready: boolean; time: number; checks: DiagnosticCheck[]; vnc: Record<string, any>;
  install: { supported: boolean; package: string; script: string; requiresAdministrator: boolean; command: string }
}
export type LocalDiagnostics = {
  time: number; platform: string; vnc: Record<string, any>; browsers: Array<{ name: string; path: string }>;
  recommended: { vncHost: string; vncPort: number; windowsInstallCommand: string }
}
export type RendererStatus = { active: Array<{ rendererId: string; sourceId: string; sourceName: string; sourceType: string; url: string; pid: number; running: boolean; startedAt: number; barcoSourceId: string; foregroundReady?: boolean }>; detectedBrowsers: Array<{ name: string; path: string }> }

async function request<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', 'X-Barco-Request': '1', ...(init.headers || {}) },
    credentials: 'same-origin',
  })
  const contentType = response.headers.get('content-type') || ''
  const data: any = contentType.includes('application/json') ? await response.json() : await response.text()
  if (response.status === 401) window.dispatchEvent(new Event('barco-auth-expired'))
  if (!response.ok) throw new Error(typeof data === 'string' ? data : data?.error || `HTTP ${response.status}`)
  return data as T
}

export const api = {
  health: () => request<{ ok: boolean }>('/api/health'),
  setupStatus: () => request<SetupStatus>('/api/setup/status'),
  setupConfig: () => request<SystemConfig>('/api/setup/config'),
  setupBrowsers: () => request<Array<{ name: string; path: string }>>('/api/setup/browsers'),
  testSetup: (config: SystemConfig) => request<{ ok: boolean; issuer?: string; tokenEndpoint?: string }>('/api/setup/test', { method: 'POST', body: JSON.stringify({ config }) }),
  discoverSetup: (config: SystemConfig, username = '', password = '', workplaceId = '') => request<DiscoveryResult>('/api/setup/discover', { method: 'POST', body: JSON.stringify({ config, username, password, workplaceId }) }),
  saveSetup: (config: SystemConfig) => request<{ ok: boolean; config: SystemConfig; restartRequiredForServerBinding: boolean }>('/api/setup/config', { method: 'POST', body: JSON.stringify({ config }) }),
  diagnostics: () => request<DiagnosticsResult>('/api/diagnostics'),
  localDiagnostics: (config: SystemConfig) => request<LocalDiagnostics>('/api/diagnostics/local', { method: 'POST', body: JSON.stringify({ config }) }),

  authStatus: () => request<{ configured?: boolean; authenticated: boolean; accessValid: boolean; expiresAt: number | null }>('/api/status'),
  login: (username: string, password: string) => request('/api/login', { method: 'POST', body: JSON.stringify({ username, password }) }),
  logout: () => request('/api/logout', { method: 'POST' }),
  publicConfig: () => request<SystemConfig>('/api/config'),
  workplaces: () => request<Workplace[]>('/api/workplaces'),
  compositions: () => request<any[]>('/api/compositions'),
  sources: (workplaceId: string) => request<any[]>(`/api/sources?workplaceId=${encodeURIComponent(workplaceId)}`),
  workplaceContent: (workplaceId: string) => request<any>(`/api/workplace/content?workplaceId=${encodeURIComponent(workplaceId)}`),
  applyItem: (workplaceId: string, item: RouteItem) => request('/api/workplace/apply', { method: 'POST', body: JSON.stringify({ workplaceId, ...item }) }),
  clear: (workplaceId: string) => request('/api/workplace/clear?workplaceId=' + encodeURIComponent(workplaceId), { method: 'DELETE' }),

  routes: () => request<Route[]>('/api/routes'),
  saveRoute: (route: Partial<Route>) => request<{ ok: boolean; route: Route }>('/api/routes', { method: 'POST', body: JSON.stringify(route) }),
  deleteRoute: (id: string) => request('/api/routes/' + encodeURIComponent(id), { method: 'DELETE' }),
  routeRuntimes: () => request<RouteRuntime[]>('/api/routes/runtime'),
  startRoute: (id: string) => request('/api/routes/' + encodeURIComponent(id) + '/start', { method: 'POST' }),
  stopRoute: (id: string) => request('/api/routes/' + encodeURIComponent(id) + '/stop', { method: 'POST', body: JSON.stringify({ clearWall: true }) }),
  pauseRoute: (id: string) => request('/api/routes/' + encodeURIComponent(id) + '/pause', { method: 'POST' }),
  resumeRoute: (id: string) => request('/api/routes/' + encodeURIComponent(id) + '/resume', { method: 'POST' }),
  routeLogs: () => request<LogEntry[]>('/api/routes/logs'),

  externalSources: () => request<ExternalSource[]>('/api/external-sources'),
  saveExternalSource: (source: ExternalSource) => request<{ ok: boolean; source: ExternalSource }>('/api/external-sources', { method: 'POST', body: JSON.stringify(source) }),
  deleteExternalSource: (id: string) => request('/api/external-sources/' + encodeURIComponent(id), { method: 'DELETE' }),
  prepareExternalSource: (id: string) => request('/api/external-sources/' + encodeURIComponent(id) + '/prepare', { method: 'POST' }),
  showExternalSource: (id: string, workplaceId: string) => request('/api/external-sources/' + encodeURIComponent(id) + '/show', { method: 'POST', body: JSON.stringify({ workplaceId }) }),
  rendererStatus: () => request<RendererStatus>('/api/external-renderer/status'),
  stopRenderer: (id: string) => request('/api/external-renderer/' + encodeURIComponent(id) + '/stop', { method: 'POST' }),

  layouts: () => request<MixedLayout[]>('/api/layouts'),
  saveLayout: (layout: MixedLayout) => request<{ ok: boolean; layout: MixedLayout }>('/api/layouts', { method: 'POST', body: JSON.stringify(layout) }),
  deleteLayout: (id: string) => request('/api/layouts/' + encodeURIComponent(id), { method: 'DELETE' }),
  showLayout: (id: string, workplaceId: string) => request<{ ok: boolean; items: number }>('/api/layouts/' + encodeURIComponent(id) + '/show', { method: 'POST', body: JSON.stringify({ workplaceId }) }),

  cameraRules: () => request<CameraRule[]>('/api/camera-rules'),
  saveCameraRule: (rule: CameraRule) => request<{ ok: boolean; rule: CameraRule }>('/api/camera-rules', { method: 'POST', body: JSON.stringify(rule) }),
  deleteCameraRule: (id: string) => request('/api/camera-rules/' + encodeURIComponent(id), { method: 'DELETE' }),
  testCameraRule: (id: string) => request('/api/camera-rules/' + encodeURIComponent(id) + '/test', { method: 'POST' }),
  cameraStatus: () => request<CameraStatus>('/api/camera-engine/status'),
  startCameras: () => request('/api/camera-engine/start', { method: 'POST' }),
  stopCameras: () => request('/api/camera-engine/stop', { method: 'POST' }),
}
