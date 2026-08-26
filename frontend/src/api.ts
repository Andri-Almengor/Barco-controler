export type RouteKind = 'composition' | 'source'
export type RouteItem = { kind: RouteKind; id: string; label?: string }
export type Route = { id: string; name: string; intervalSec: number; workplaceId: string; items: RouteItem[]; updatedAt?: number }
export type Workplace = { id: string; name: string; geometry?: { type: string; x: number; y: number; width: number; height: number } }
export type RouteRuntime = { routeId: string; routeName?: string; state: 'stopped' | 'running' | 'paused' | 'error'; index: number; lastError?: string | null; lastItem?: any; nextRunAt?: number | null }
export type CameraRule = {
  id?: string; name: string; enabled: boolean; rtspUrl?: string; username?: string; password?: string; hasPassword?: boolean;
  workplaceId?: string; displayKind?: RouteKind; itemId?: string; itemLabel?: string; group?: string; groupCompositionId?: string;
  priority?: number; durationSec?: number; cooldownSec?: number; scheduleStart?: string; scheduleEnd?: string;
  enabledHoursOnly?: boolean; detectionMode?: 'manual' | 'frame_diff'; minArea?: number; updatedAt?: number
}
export type CameraStatus = { running: boolean; opencvAvailable: boolean; activeEvent: any | null; activeUntil: number; queue: any[]; logs: LogEntry[]; rulesCount: number }
export type LogEntry = { ts: number; level: string; message: string }

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
  authStatus: () => request<{ authenticated: boolean; accessValid: boolean; expiresAt: number | null }>('/api/status'),
  login: (username: string, password: string) => request('/api/login', { method: 'POST', body: JSON.stringify({ username, password }) }),
  logout: () => request('/api/logout', { method: 'POST' }),
  workplaces: () => request<Workplace[]>('/api/workplaces'),
  compositions: () => request<any[]>('/api/compositions'),
  sources: (workplaceId: string) => request<any[]>(`/api/sources?workplaceId=${encodeURIComponent(workplaceId)}`),
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

  cameraRules: () => request<CameraRule[]>('/api/camera-rules'),
  saveCameraRule: (rule: CameraRule) => request<{ ok: boolean; rule: CameraRule }>('/api/camera-rules', { method: 'POST', body: JSON.stringify(rule) }),
  deleteCameraRule: (id: string) => request('/api/camera-rules/' + encodeURIComponent(id), { method: 'DELETE' }),
  testCameraRule: (id: string) => request('/api/camera-rules/' + encodeURIComponent(id) + '/test', { method: 'POST' }),
  cameraStatus: () => request<CameraStatus>('/api/camera-engine/status'),
  startCameras: () => request('/api/camera-engine/start', { method: 'POST' }),
  stopCameras: () => request('/api/camera-engine/stop', { method: 'POST' }),
}
