import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import {
  api,
  type CameraRule,
  type CameraStatus,
  type DiagnosticsResult,
  type ExternalSource,
  type LayoutItem,
  type LayoutKind,
  type LogEntry,
  type MixedLayout,
  type RendererStatus,
  type Route,
  type RouteItem,
  type RouteRuntime,
  type SystemConfig,
  type Workplace,
} from './api'
import { WallCanvas, beginPaletteDrag, type WallPalettePayload } from './components/WallCanvas'
import { bringToFront, liveWallItems, sendToBack } from './wallLayout'
import { defaultRenderer, emptyCamera, idOf, labelOf, looksLikeVnc } from './helpers'

type Tab = 'dashboard' | 'manual' | 'routes' | 'cameras' | 'external' | 'compositions' | 'diagnostics' | 'logs' | 'settings'
type Toast = { id: number; kind: 'ok' | 'error' | 'warn'; message: string }
type PaletteFilter = 'source' | 'composition' | 'external'

const icon = (name: string) => <span className="material-symbols-outlined">{name}</span>
const roleOf = (wall?: Workplace) => wall?.role === 'secondary' ? 'secondary' : 'primary'
const fullGeometry = (wall?: Workplace) => ({
  type: 'px',
  x: 0,
  y: 0,
  width: wall?.geometry?.width || 1920,
  height: wall?.geometry?.height || 1080,
})

export default function AppNext() {
  const [setupChecked, setSetupChecked] = useState(false)
  const [configured, setConfigured] = useState(false)
  const [authenticated, setAuthenticated] = useState(false)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [tab, setTab] = useState<Tab>('dashboard')
  const [config, setConfig] = useState<SystemConfig | null>(null)
  const [workplaces, setWorkplaces] = useState<Workplace[]>([])
  const [workplaceId, setWorkplaceId] = useState('')
  const [sources, setSources] = useState<any[]>([])
  const [compositions, setCompositions] = useState<any[]>([])
  const [routes, setRoutes] = useState<Route[]>([])
  const [runtimes, setRuntimes] = useState<RouteRuntime[]>([])
  const [externalSources, setExternalSources] = useState<ExternalSource[]>([])
  const [layouts, setLayouts] = useState<MixedLayout[]>([])
  const [cameraRules, setCameraRules] = useState<CameraRule[]>([])
  const [cameraStatus, setCameraStatus] = useState<CameraStatus | null>(null)
  const [rendererStatus, setRendererStatus] = useState<RendererStatus | null>(null)
  const [diagnostics, setDiagnostics] = useState<DiagnosticsResult | null>(null)
  const [routeLogs, setRouteLogs] = useState<LogEntry[]>([])
  const [wallContent, setWallContent] = useState<any>(null)
  const [toasts, setToasts] = useState<Toast[]>([])

  function notify(kind: Toast['kind'], message: string) {
    if (!message) return
    const id = Date.now() + Math.floor(Math.random() * 1000)
    setToasts(current => [...current.slice(-3), { id, kind, message }])
    window.setTimeout(() => setToasts(current => current.filter(item => item.id !== id)), 4500)
  }

  useEffect(() => {
    api.setupStatus().then(async status => {
      setConfigured(status.configured)
      setSetupChecked(true)
      if (status.configured) {
        try { setAuthenticated((await api.authStatus()).authenticated) }
        catch { setAuthenticated(false) }
      }
    }).catch(error => {
      setSetupChecked(true)
      notify('error', error.message)
    })
  }, [])

  useEffect(() => {
    const expired = () => setAuthenticated(false)
    window.addEventListener('barco-auth-expired', expired)
    return () => window.removeEventListener('barco-auth-expired', expired)
  }, [])

  async function refreshBase() {
    const [cfg, walls, nextRoutes, nextExternal, nextLayouts, nextCameras, nextCompositions] = await Promise.all([
      api.publicConfig(),
      api.workplaces(),
      api.routes(),
      api.externalSources(),
      api.layouts(),
      api.cameraRules(),
      api.compositions(),
    ])
    setConfig(cfg)
    setWorkplaces(walls)
    setRoutes(nextRoutes)
    setExternalSources(nextExternal)
    setLayouts(nextLayouts)
    setCameraRules(nextCameras)
    setCompositions(nextCompositions)
    setWorkplaceId(current => current && walls.some(w => w.id === current)
      ? current
      : walls.find(w => roleOf(w) === 'primary')?.id || walls[0]?.id || '')
  }

  async function refreshRuntime() {
    try {
      const [nextRuntimes, nextCameraStatus, nextRendererStatus, nextLogs] = await Promise.all([
        api.routeRuntimes(), api.cameraStatus(), api.rendererStatus(), api.routeLogs(),
      ])
      setRuntimes(nextRuntimes)
      setCameraStatus(nextCameraStatus)
      setRendererStatus(nextRendererStatus)
      setRouteLogs(nextLogs)
    } catch { }
  }

  async function refreshDiagnostics() {
    try { setDiagnostics(await api.diagnostics()) } catch { }
  }

  async function refreshWallContent() {
    if (!workplaceId) return
    try { setWallContent(await api.workplaceContent(workplaceId)) } catch { }
  }

  useEffect(() => {
    if (!authenticated) return
    void refreshBase().catch(error => notify('error', error.message))
    void refreshRuntime()
    void refreshDiagnostics()
    const fast = window.setInterval(() => void refreshRuntime(), 1500)
    const slow = window.setInterval(() => void refreshDiagnostics(), 8000)
    return () => { window.clearInterval(fast); window.clearInterval(slow) }
  }, [authenticated])

  useEffect(() => {
    if (!authenticated || !workplaceId) return
    setWallContent(null)
    api.sources(workplaceId).then(setSources).catch(error => notify('error', error.message))
    void refreshWallContent()
    const timer = window.setInterval(() => void refreshWallContent(), 1500)
    return () => window.clearInterval(timer)
  }, [authenticated, workplaceId])

  async function login(event: FormEvent) {
    event.preventDefault()
    try {
      await api.login(username, password)
      setPassword('')
      setAuthenticated(true)
    } catch (error: any) { notify('error', error.message) }
  }

  async function emergencyStop() {
    await Promise.allSettled([
      api.stopCameras(),
      ...routes.map(route => api.stopRoute(route.id)),
      ...workplaces.map(wall => api.clear(wall.id)),
    ])
    notify('warn', 'Parada de emergencia ejecutada en todos los walls configurados.')
    void refreshRuntime()
    void refreshWallContent()
  }

  if (!setupChecked) return <Splash />
  if (!configured) return <SetupWizard onConfigured={() => { setConfigured(true); setAuthenticated(false) }} notify={notify} />
  if (!authenticated) return <Login username={username} password={password} setUsername={setUsername} setPassword={setPassword} onSubmit={login} />

  const activeWorkplace = workplaces.find(w => w.id === workplaceId)
  const runningRoute = runtimes.find(runtime => runtime.state === 'running')

  return <div className="bc-app">
    <Topbar workplaces={workplaces} workplaceId={workplaceId} onWorkplace={setWorkplaceId} diagnostics={diagnostics} rendererStatus={rendererStatus} cameraStatus={cameraStatus} onHealth={() => setTab('diagnostics')} onSettings={() => setTab('settings')} />
    <Sidebar tab={tab} onTab={setTab} onEmergency={() => void emergencyStop()} />
    <main className="bc-main">
      {tab === 'dashboard' && <DashboardScreen wall={activeWorkplace} wallContent={wallContent} sources={sources} compositions={compositions} diagnostics={diagnostics} rendererStatus={rendererStatus} cameraStatus={cameraStatus} runningRoute={runningRoute} routes={routes} onStartRoute={async id => { try { await api.startRoute(id); notify('ok', 'Tour iniciado.'); void refreshRuntime() } catch (e: any) { notify('error', e.message) } }} onClear={async () => { if (!workplaceId) return; try { await api.clear(workplaceId); notify('ok', 'Wall limpiado.'); await refreshWallContent() } catch (e: any) { notify('error', e.message) } }} />}
      {tab === 'manual' && <ManualScreen wall={activeWorkplace} workplaces={workplaces} wallContent={wallContent} sources={sources} compositions={compositions} externalSources={externalSources} onWorkplace={setWorkplaceId} notify={notify} refreshWall={refreshWallContent} refreshBase={refreshBase} />}
      {tab === 'routes' && <ToursScreen routes={routes} runtimes={runtimes} workplaces={workplaces} sources={sources} compositions={compositions} externalSources={externalSources} currentWorkplaceId={workplaceId} notify={notify} refresh={async () => { await refreshBase(); await refreshRuntime() }} />}
      {tab === 'cameras' && <CamerasScreen rules={cameraRules} status={cameraStatus} workplaces={workplaces} sources={sources} compositions={compositions} currentWorkplaceId={workplaceId} notify={notify} refresh={refreshBase} refreshRuntime={refreshRuntime} />}
      {tab === 'external' && config && <InternetScreen sources={externalSources} renderers={config.renderers} rendererStatus={rendererStatus} workplaces={workplaces} workplaceId={workplaceId} onWorkplace={setWorkplaceId} notify={notify} refresh={refreshBase} />}
      {tab === 'compositions' && <CompositionsScreen layouts={layouts} sources={sources} compositions={compositions} externalSources={externalSources} workplaces={workplaces} currentWorkplaceId={workplaceId} notify={notify} refresh={refreshBase} refreshWall={refreshWallContent} />}
      {tab === 'diagnostics' && config && <DiagnosticsScreen diagnostics={diagnostics} config={config} onRefresh={refreshDiagnostics} notify={notify} />}
      {tab === 'logs' && <LogsScreen routeLogs={routeLogs} cameraLogs={cameraStatus?.logs || []} />}
      {tab === 'settings' && config && <ConfigurationScreen config={config} sources={sources} onSaved={() => { void refreshBase(); void refreshDiagnostics() }} notify={notify} />}
    </main>
    <div className="bc-toast-stack">{toasts.map(toast => <div key={toast.id} className={`bc-toast ${toast.kind}`}>{icon(toast.kind === 'ok' ? 'check_circle' : toast.kind === 'warn' ? 'warning' : 'error')}<span>{toast.message}</span></div>)}</div>
  </div>
}

function Splash() {
  return <div className="bc-splash"><div className="bc-loader"/><h1>Barco Controller</h1><p>Inicializando plano de control…</p></div>
}

function Login(props: { username: string; password: string; setUsername: (v: string) => void; setPassword: (v: string) => void; onSubmit: (event: FormEvent) => void }) {
  return <div className="bc-login-page"><form className="bc-login-card" onSubmit={props.onSubmit}><div className="bc-login-brand">Barco Controller</div><div className="bc-login-kicker">ADMIN TERMINAL</div><h1>Operator Authentication</h1><p>Use un usuario válido de CTRL para operar el sistema.</p><label>Usuario CTRL<input value={props.username} onChange={e => props.setUsername(e.target.value)} autoComplete="username" /></label><label>Contraseña<input type="password" value={props.password} onChange={e => props.setPassword(e.target.value)} autoComplete="current-password" /></label><button className="bc-btn primary" type="submit">{icon('login')} Conectar</button></form></div>
}

function Topbar(props: { workplaces: Workplace[]; workplaceId: string; onWorkplace: (id: string) => void; diagnostics: DiagnosticsResult | null; rendererStatus: RendererStatus | null; cameraStatus: CameraStatus | null; onHealth: () => void; onSettings: () => void }) {
  const diagnostic = (id: string) => props.diagnostics?.checks.find(check => check.id.toLowerCase().includes(id))
  const ctrlOk = diagnostic('ctrl')?.status === 'ok'
  const vncOk = diagnostic('vnc')?.status === 'ok' || !!props.rendererStatus?.active.length
  const rendererOk = !!props.rendererStatus?.active.some(item => item.running)
  return <header className="bc-topbar"><div className="bc-top-brand">Barco Controller</div><div className="bc-top-statuses"><span><i className={ctrlOk ? 'ok' : ''}/>CTRL</span><span><i className={vncOk ? 'ok' : ''}/>VNC</span><span><i className={rendererOk ? 'ok' : ''}/>Renderer</span><span><i className={props.cameraStatus?.running ? 'ok' : ''}/>Cameras</span></div><div className="bc-top-actions"><label className="bc-workplace-select">{icon('desktop_windows')}<select value={props.workplaceId} onChange={e => props.onWorkplace(e.target.value)}>{props.workplaces.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select></label><button className="bc-top-button" onClick={props.onHealth}>System Health</button><button className="bc-icon-button" onClick={props.onSettings}>{icon('settings')}</button><div className="bc-avatar">BC</div></div></header>
}

function Sidebar(props: { tab: Tab; onTab: (tab: Tab) => void; onEmergency: () => void }) {
  const nav: Array<[Tab, string, string]> = [['dashboard','Dashboard','dashboard'],['manual','Manual Control','tune'],['routes','Tours','route'],['cameras','Cameras','videocam'],['external','Internet','language'],['compositions','Compositions','dashboard_customize'],['diagnostics','Diagnosis','medical_services'],['logs','Activity Logs','history'],['settings','Configuration','settings']]
  return <aside className="bc-sidebar"><div className="bc-side-profile"><div className="bc-avatar large">BC</div><div><strong>Barco Controller</strong><small>Admin Terminal</small></div></div><nav className="bc-side-nav">{nav.map(([value,label,iconName]) => <button key={value} className={props.tab === value ? 'active' : ''} onClick={() => props.onTab(value)}>{icon(iconName)}<span>{label}</span></button>)}</nav><div className="bc-side-bottom"><button className="bc-emergency" onClick={props.onEmergency}>{icon('warning')} Emergency Stop</button><button onClick={() => props.onTab('logs')}>{icon('terminal')} Logs</button></div></aside>
}

function ScreenTitle({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return <div className="bc-screen-title"><div><h1>{title}</h1>{subtitle && <p>{subtitle}</p>}</div>{actions && <div className="bc-title-actions">{actions}</div>}</div>
}

function DashboardScreen(props: { wall?: Workplace; wallContent: any; sources: any[]; compositions: any[]; diagnostics: DiagnosticsResult | null; rendererStatus: RendererStatus | null; cameraStatus: CameraStatus | null; runningRoute?: RouteRuntime; routes: Route[]; onStartRoute: (id: string) => Promise<void>; onClear: () => Promise<void> }) {
  const items = useMemo(() => liveWallItems(props.wallContent, props.wall, props.sources, props.compositions), [props.wallContent, props.wall?.id, props.sources, props.compositions])
  const ctrl = props.diagnostics?.checks.find(c => c.id.toLowerCase().includes('ctrl'))
  const vnc = props.diagnostics?.checks.find(c => c.id.toLowerCase().includes('vnc'))
  const width = props.wall?.geometry?.width || 1920
  const height = props.wall?.geometry?.height || 1080
  return <div className="bc-screen dashboard-screen"><section className="bc-operational-banner"><div><h1><span className={`bc-pulse ${props.diagnostics?.ready === false ? 'warn' : ''}`}/>{props.diagnostics?.ready === false ? 'System Attention' : 'System Operational'}</h1><p>Preview real del contenido reportado por CTRL en {props.wall?.name || 'el wall seleccionado'}.</p></div><div className="bc-uptime">Sources visible: {items.length}<br/>Wall: {width}×{height}</div></section><div className="bc-status-grid"><StatusCard title="CTRL" state={ctrl?.status === 'ok' ? 'Ready' : ctrl?.status || 'Unknown'} tone={ctrl?.status === 'ok' ? 'ok' : 'warn'} /><StatusCard title="VNC" state={vnc?.status === 'ok' ? 'Active' : vnc?.status || 'Unknown'} tone={vnc?.status === 'ok' ? 'red' : 'warn'} /><StatusCard title="Renderer" state={props.rendererStatus?.active.some(r => r.running) ? 'Online' : 'Standby'} tone={props.rendererStatus?.active.some(r => r.running) ? 'ok' : 'muted'} /><StatusCard title="Cameras" state={`${props.cameraStatus?.rulesCount || 0} Rules`} tone={props.cameraStatus?.running ? 'ok' : 'muted'} /><StatusCard title="Tours" state={props.runningRoute?.routeName || 'None'} tone={props.runningRoute ? 'red' : 'muted'} /></div><div className="bc-dashboard-grid"><section className="bc-panel bc-wall-preview-panel"><h3>Video Wall Preview — {props.wall?.name || 'No target'}</h3><WallCanvas items={items} wallWidth={width} wallHeight={height} editable={false} emptyText="WALL VACÍO / SIN CONTENIDO REPORTADO" /></section><aside className="bc-dashboard-right"><section className="bc-panel source-detail"><h3>Visible Content</h3>{items.length ? <div className="dashboard-visible-list">{items.map((item,index) => <div key={`${item.id}-${index}`}><span className={`bc-kind ${item.kind}`}>{item.kind}</span><strong>{item.label || item.id}</strong><small>{Math.round(item.geometry.width)}×{Math.round(item.geometry.height)} · layer {index + 1}</small></div>)}</div> : <p className="bc-help">CTRL no reporta contenido activo en este workplace.</p>}</section><section className="bc-panel quick-actions"><h3>Quick Actions</h3><button className="bc-btn primary" disabled={!props.routes.length} onClick={() => props.routes[0] && void props.onStartRoute(props.routes[0].id)}>Start Tour</button><button className="bc-btn" onClick={() => void props.onClear()}>Clear Wall</button></section></aside></div></div>
}

function StatusCard({ title, state, tone }: { title: string; state: string; tone: 'ok' | 'red' | 'warn' | 'muted' }) {
  return <div className={`bc-status-card ${tone === 'red' ? 'selected' : ''}`}><div><span>{title}</span>{icon(title === 'CTRL' ? 'memory' : title === 'Cameras' ? 'videocam' : title === 'Tours' ? 'route' : 'desktop_windows')}</div><strong className={tone}>{state}</strong></div>
}

function paletteValues(filter: PaletteFilter, sources: any[], compositions: any[], external: ExternalSource[]) {
  if (filter === 'composition') return compositions.map(item => ({ kind: 'composition' as const, id: idOf(item), label: labelOf(item) }))
  if (filter === 'external') return external.filter(item => item.id).map(item => ({ kind: 'external' as const, id: String(item.id), label: item.name }))
  return sources.map(item => ({ kind: 'source' as const, id: idOf(item), label: labelOf(item) }))
}

function EditorPalette(props: { filter: PaletteFilter; setFilter: (value: PaletteFilter) => void; query: string; setQuery: (value: string) => void; sources: any[]; compositions: any[]; external: ExternalSource[]; onQuickAdd: (payload: WallPalettePayload) => void }) {
  const entries = paletteValues(props.filter, props.sources, props.compositions, props.external).filter(item => item.id && item.label.toLowerCase().includes(props.query.toLowerCase()))
  return <aside className="visual-palette bc-panel"><div className="bc-segmented"><button className={props.filter === 'source' ? 'active' : ''} onClick={() => props.setFilter('source')}>Sources</button><button className={props.filter === 'composition' ? 'active' : ''} onClick={() => props.setFilter('composition')}>Compositions</button><button className={props.filter === 'external' ? 'active' : ''} onClick={() => props.setFilter('external')}>Web</button></div><div className="bc-search">{icon('search')}<input value={props.query} onChange={e => props.setQuery(e.target.value)} placeholder="Filter content…" /></div><p className="drag-help">Arrastra cualquier elemento al wall. Doble clic lo agrega al centro.</p><div className="visual-palette-list">{entries.map(entry => <button draggable key={`${entry.kind}-${entry.id}`} onDragStart={event => beginPaletteDrag(event, entry)} onDoubleClick={() => props.onQuickAdd(entry)}><div>{icon(entry.kind === 'external' ? 'language' : entry.kind === 'composition' ? 'dashboard_customize' : 'monitor')}</div><span><strong>{entry.label}</strong><small>{entry.kind}</small></span>{icon('drag_indicator')}</button>)}</div></aside>
}

function ElementInspector(props: { items: LayoutItem[]; selectedIndex: number; wall?: Workplace; onItems: (items: LayoutItem[]) => void; onSelected: (index: number) => void }) {
  const item = props.items[props.selectedIndex]
  if (!item) return <aside className="visual-inspector bc-panel"><h3>Selected Element</h3><p className="bc-help">Selecciona un elemento. Muévelo arrastrándolo y cambia su tamaño desde cualquiera de las cuatro esquinas.</p></aside>
  const wallWidth = props.wall?.geometry?.width || 1920
  const wallHeight = props.wall?.geometry?.height || 1080
  const updateSelected = (next: LayoutItem) => props.onItems(props.items.map((value,index) => index === props.selectedIndex ? next : value))
  return <aside className="visual-inspector bc-panel"><h3>Selected Element</h3><div className="selected-element-name"><span className={`bc-kind ${item.kind}`}>{item.kind}</span><strong>{item.label || item.id}</strong></div><div className="geometry-readout"><span>Position <b>{Math.round(item.geometry.x)}, {Math.round(item.geometry.y)}</b></span><span>Size <b>{Math.round(item.geometry.width)} × {Math.round(item.geometry.height)}</b></span><span>Layer <b>{props.selectedIndex + 1} / {props.items.length}</b></span></div><p className="bc-help">La posición y el tamaño se ajustan directamente con el mouse. Los valores son solo informativos.</p><div className="inspector-actions"><button className="bc-btn" onClick={() => updateSelected({ ...item, geometry: { type: 'px', x: 0, y: 0, width: wallWidth, height: wallHeight } })}>{icon('fullscreen')} Full Wall</button><button className="bc-btn" disabled={props.selectedIndex === props.items.length - 1} onClick={() => { props.onItems(bringToFront(props.items, props.selectedIndex)); props.onSelected(props.items.length - 1) }}>{icon('flip_to_front')} Bring Front</button><button className="bc-btn" disabled={props.selectedIndex === 0} onClick={() => { props.onItems(sendToBack(props.items, props.selectedIndex)); props.onSelected(0) }}>{icon('flip_to_back')} Send Back</button><button className="bc-btn" onClick={() => { const copy = { ...item, geometry: { ...item.geometry, x: Math.min(item.geometry.x + 30, Math.max(0, wallWidth - item.geometry.width)), y: Math.min(item.geometry.y + 30, Math.max(0, wallHeight - item.geometry.height)) } }; props.onItems([...props.items, copy]); props.onSelected(props.items.length) }}>{icon('content_copy')} Duplicate</button><button className="bc-btn danger" onClick={() => { props.onItems(props.items.filter((_,index) => index !== props.selectedIndex)); props.onSelected(-1) }}>{icon('delete')} Remove</button></div></aside>
}

function centerGeometry(wall?: Workplace) {
  const width = wall?.geometry?.width || 1920
  const height = wall?.geometry?.height || 1080
  const itemWidth = Math.round(width * .42)
  const itemHeight = Math.round(height * .44)
  return { type: 'px', x: Math.round((width - itemWidth) / 2), y: Math.round((height - itemHeight) / 2), width: itemWidth, height: itemHeight }
}

function ManualScreen(props: { wall?: Workplace; workplaces: Workplace[]; wallContent: any; sources: any[]; compositions: any[]; externalSources: ExternalSource[]; onWorkplace: (id: string) => void; notify: (kind: Toast['kind'], message: string) => void; refreshWall: () => Promise<void>; refreshBase: () => Promise<void> }) {
  const [filter, setFilter] = useState<PaletteFilter>('source')
  const [query, setQuery] = useState('')
  const [items, setItems] = useState<LayoutItem[]>([])
  const [selectedIndex, setSelectedIndex] = useState(-1)
  const [loadedWall, setLoadedWall] = useState('')
  const width = props.wall?.geometry?.width || 1920
  const height = props.wall?.geometry?.height || 1080

  function syncFromWall() {
    setItems(liveWallItems(props.wallContent, props.wall, props.sources, props.compositions))
    setSelectedIndex(-1)
    if (props.wall?.id) setLoadedWall(props.wall.id)
  }

  useEffect(() => {
    if (props.wall?.id && props.wallContent !== null && loadedWall !== props.wall.id) syncFromWall()
  }, [props.wall?.id, props.wallContent, loadedWall])

  function add(payload: WallPalettePayload, geometry = centerGeometry(props.wall)) {
    setItems(current => [...current, { ...payload, geometry }])
    setSelectedIndex(items.length)
  }

  async function show() {
    if (!props.wall?.id) return props.notify('warn', 'Selecciona un wall de destino.')
    if (!items.length) return props.notify('warn', 'Arrastra al menos una fuente al wall.')
    try {
      await api.applyLayout(props.wall.id, items)
      props.notify('ok', `Layout manual enviado a ${props.wall.name}.`)
      await props.refreshWall()
    } catch (error: any) { props.notify('error', error.message) }
  }

  async function clear() {
    if (!props.wall?.id) return
    try {
      await api.clear(props.wall.id)
      setItems([])
      setSelectedIndex(-1)
      props.notify('ok', `Wall ${props.wall.name} limpiado.`)
      await props.refreshWall()
    } catch (error: any) { props.notify('error', error.message) }
  }

  async function saveAsComposition() {
    if (!props.wall?.id || !items.length) return
    const name = window.prompt('Nombre para guardar esta composición:', 'Manual Layout')?.trim()
    if (!name) return
    try {
      await api.saveLayout({ name, workplaceId: props.wall.id, items })
      await props.refreshBase()
      props.notify('ok', `Composición "${name}" guardada.`)
    } catch (error: any) { props.notify('error', error.message) }
  }

  return <div className="bc-screen visual-editor-screen"><ScreenTitle title="Manual Control" subtitle="Arrastra, superpone, mueve y redimensiona fuentes directamente con el mouse." actions={<><label className="inline-wall-select">Destination Wall<select value={props.wall?.id || ''} onChange={e => props.onWorkplace(e.target.value)}>{props.workplaces.map(wall => <option key={wall.id} value={wall.id}>{wall.name}{roleOf(wall) === 'secondary' ? ' · Secondary' : ' · Principal'}</option>)}</select></label><button className="bc-btn" onClick={syncFromWall}>{icon('sync')} Load Current Wall</button><button className="bc-btn" onClick={() => void saveAsComposition()}>{icon('save')} Save as Composition</button><button className="bc-btn danger" onClick={() => void clear()}>{icon('delete_sweep')} Clear Wall</button><button className="bc-btn primary" onClick={() => void show()}>{icon('cast')} Show on Wall</button></>} /><div className="visual-editor-layout"><EditorPalette filter={filter} setFilter={setFilter} query={query} setQuery={setQuery} sources={props.sources} compositions={props.compositions} external={props.externalSources} onQuickAdd={payload => add(payload)} /><section className="visual-stage bc-panel"><div className="visual-stage-head"><span>{props.wall?.name || 'No wall'}</span><small>{width} × {height} · {items.length} elements</small></div><WallCanvas items={items} wallWidth={width} wallHeight={height} selectedIndex={selectedIndex} onItemsChange={setItems} onSelect={setSelectedIndex} onDropNew={(payload, geometry) => add(payload, geometry)} /></section><ElementInspector items={items} selectedIndex={selectedIndex} wall={props.wall} onItems={setItems} onSelected={setSelectedIndex} /></div></div>
}

function ToursScreen(props: { routes: Route[]; runtimes: RouteRuntime[]; workplaces: Workplace[]; sources: any[]; compositions: any[]; externalSources: ExternalSource[]; currentWorkplaceId: string; notify: (kind: Toast['kind'], message: string) => void; refresh: () => Promise<void> }) {
  const [routeId, setRouteId] = useState(props.routes[0]?.id || '')
  const [draft, setDraft] = useState<Route | null>(props.routes[0] ? { ...props.routes[0], items: [...props.routes[0].items] } : null)
  useEffect(() => {
    const route = props.routes.find(value => value.id === routeId)
    setDraft(route ? { ...route, items: [...route.items] } : null)
  }, [routeId, props.routes])
  useEffect(() => { if (!routeId && props.routes[0]) setRouteId(props.routes[0].id) }, [props.routes])
  const runtime = props.runtimes.find(value => value.routeId === routeId)

  async function save() {
    if (!draft) return
    try {
      const result = await api.saveRoute(draft)
      setRouteId(result.route.id)
      await props.refresh()
      props.notify('ok', 'Tour guardado.')
    } catch (error: any) { props.notify('error', error.message) }
  }

  async function command(action: 'start' | 'pause' | 'resume' | 'stop') {
    if (!routeId) return
    try {
      if (action === 'start') await api.startRoute(routeId)
      if (action === 'pause') await api.pauseRoute(routeId)
      if (action === 'resume') await api.resumeRoute(routeId)
      if (action === 'stop') await api.stopRoute(routeId)
      await props.refresh()
    } catch (error: any) { props.notify('error', error.message) }
  }

  function addRouteItem(kind: RouteItem['kind'], id: string) {
    if (!draft || !id) return
    const list = kind === 'source' ? props.sources : kind === 'composition' ? props.compositions : props.externalSources
    const item = list.find(value => idOf(value) === id)
    setDraft({ ...draft, items: [...draft.items, { kind, id, label: labelOf(item) }] })
  }

  return <div className="bc-screen tours-screen"><ScreenTitle title="Automated Tours" subtitle="Los cambios se editan localmente y solo se escriben al pulsar Save Tour." actions={<><select className="bc-compact-select" value={routeId} onChange={e => setRouteId(e.target.value)}><option value="">Select Tour</option>{props.routes.map(route => <option key={route.id} value={route.id}>{route.name}</option>)}</select><button className="bc-btn" onClick={() => { setRouteId(''); setDraft({ id: '', name: `Tour ${props.routes.length + 1}`, intervalSec: 30, workplaceId: props.currentWorkplaceId, items: [] }) }}>{icon('add')} New Tour</button></>} />{draft ? <section className="tour-editor bc-panel"><div className="tour-heading"><div><span className={`bc-runtime-dot ${runtime?.state === 'running' ? 'running' : ''}`}/><div><input className="tour-name-input" value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })}/><p>{draft.items.length} steps · state {runtime?.state || 'stopped'}</p></div></div><div className="tour-actions"><button className="bc-btn" onClick={() => void save()}>{icon('save')} Save Tour</button><button className="bc-btn" disabled={!routeId} onClick={() => void command('pause')}>{icon('pause')} Pause</button><button className="bc-btn" disabled={!routeId} onClick={() => void command('resume')}>{icon('play_arrow')} Resume</button><button className="bc-btn danger" disabled={!routeId} onClick={() => void command('stop')}>{icon('stop')} Stop</button><button className="bc-btn primary" disabled={!routeId} onClick={() => void command('start')}>{icon('play_arrow')} Start</button></div></div><div className="tour-config-row"><label>Destination Wall<select value={draft.workplaceId} onChange={e => setDraft({ ...draft, workplaceId: e.target.value })}>{props.workplaces.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select></label><label>Interval (seconds)<input type="number" min="3" value={draft.intervalSec} onChange={e => setDraft({ ...draft, intervalSec: Number(e.target.value) })}/></label><div className="runtime-state"><small>STATE</small><strong>{runtime?.state || 'stopped'}</strong></div></div><div className="tour-timeline">{draft.items.map((item,index) => <div className={`tour-step ${runtime?.index === index && runtime.state === 'running' ? 'active' : ''}`} key={`${item.kind}-${item.id}-${index}`}><div className="step-index">{index + 1}</div><div className="step-card"><div><span className={`bc-kind ${item.kind}`}>{item.kind}</span><strong>{item.label || item.id}</strong></div><button onClick={() => setDraft({ ...draft, items: draft.items.filter((_,itemIndex) => itemIndex !== index) })}>{icon('close')}</button></div></div>)}</div><div className="tour-adders"><RouteAdder label="Add CTRL Source" values={props.sources} onAdd={id => addRouteItem('source', id)} /><RouteAdder label="Add Composition" values={props.compositions} onAdd={id => addRouteItem('composition', id)} /><RouteAdder label="Add Internet" values={props.externalSources} onAdd={id => addRouteItem('external', id)} /></div>{routeId && <div className="tour-delete-row"><button className="bc-btn danger" onClick={async () => { try { await api.deleteRoute(routeId); setRouteId(''); setDraft(null); await props.refresh(); props.notify('ok', 'Tour eliminado.') } catch (error: any) { props.notify('error', error.message) } }}>{icon('delete')} Delete Tour</button></div>}</section> : <EmptyState iconName="route" title="No tours configured" />}</div>
}

function RouteAdder({ label, values, onAdd }: { label: string; values: any[]; onAdd: (id: string) => void }) {
  const [value, setValue] = useState('')
  return <label>{label}<div><select value={value} onChange={e => setValue(e.target.value)}><option value="">Select…</option>{values.map(item => <option key={idOf(item)} value={idOf(item)}>{labelOf(item)}</option>)}</select><button className="bc-btn" disabled={!value} onClick={() => { onAdd(value); setValue('') }}>{icon('add')}</button></div></label>
}

function CamerasScreen(props: { rules: CameraRule[]; status: CameraStatus | null; workplaces: Workplace[]; sources: any[]; compositions: any[]; currentWorkplaceId: string; notify: (kind: Toast['kind'], message: string) => void; refresh: () => Promise<void>; refreshRuntime: () => Promise<void> }) {
  const [selectedId, setSelectedId] = useState(props.rules[0]?.id || '')
  const [draft, setDraft] = useState<CameraRule>(props.rules[0] ? { ...props.rules[0], password: '' } : emptyCamera(props.currentWorkplaceId))
  useEffect(() => { const next = props.rules.find(rule => rule.id === selectedId); if (next) setDraft({ ...next, password: '' }) }, [selectedId, props.rules])
  const values = draft.displayKind === 'composition' ? props.compositions : props.sources

  async function save() {
    try {
      const result = await api.saveCameraRule(draft)
      setSelectedId(result.rule.id || '')
      await props.refresh()
      props.notify('ok', 'Camera rule saved.')
    } catch (error: any) { props.notify('error', error.message) }
  }

  return <div className="bc-screen cameras-screen"><ScreenTitle title="Surveillance Feeds" subtitle="Motion-triggered sources with priority over tours." actions={<><button className="bc-btn" onClick={async () => { await api.startCameras(); await props.refreshRuntime() }}>{icon('play_arrow')} Start Engine</button><button className="bc-btn" onClick={async () => { await api.stopCameras(); await props.refreshRuntime() }}>{icon('stop')} Stop Engine</button></>} /><div className="camera-layout"><section className="camera-list bc-panel"><div className="camera-list-head"><h3>Surveillance Feeds</h3><button onClick={() => { setSelectedId(''); setDraft(emptyCamera(props.currentWorkplaceId)) }}>{icon('add')}</button></div>{props.rules.map(rule => <button className={selectedId === rule.id ? 'active' : ''} key={rule.id} onClick={() => setSelectedId(rule.id || '')}><div className="camera-thumb">{icon('videocam')}</div><div><strong>{rule.name}</strong><small>{props.workplaces.find(w => w.id === rule.workplaceId)?.name || 'No wall'} · {rule.detectionMode}</small></div><span className={`bc-dot ${rule.enabled ? 'ok' : ''}`}/></button>)}</section><section className="camera-center bc-panel"><div className="camera-preview"><div className="scan-grid"/>{icon('videocam')}<span>{draft.name}</span></div><div className="camera-form-grid"><label>RTSP URL<input value={draft.rtspUrl || ''} onChange={e => setDraft({ ...draft, rtspUrl: e.target.value })}/></label><label>Username<input value={draft.username || ''} onChange={e => setDraft({ ...draft, username: e.target.value })}/></label><label>Password<input type="password" value={draft.password || ''} placeholder={draft.hasPassword ? 'Saved credential' : ''} onChange={e => setDraft({ ...draft, password: e.target.value })}/></label><label>Detection Mode<select value={draft.detectionMode || 'manual'} onChange={e => setDraft({ ...draft, detectionMode: e.target.value as CameraRule['detectionMode'] })}><option value="manual">Manual test</option><option value="frame_diff">Frame difference</option></select></label></div><div className="camera-actions"><button className="bc-btn" disabled={!draft.id} onClick={async () => { if (!draft.id) return; try { await api.testCameraRule(draft.id); props.notify('ok', 'Camera test event sent.') } catch (error: any) { props.notify('error', error.message) } }}>{icon('science')} Test Stream</button><button className="bc-btn primary" onClick={() => void save()}>{icon('save')} Save Config</button></div></section><aside className="camera-properties bc-panel"><h3>Properties</h3><label>Source / Event Name<input value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })}/></label><label>Destination Wall<select value={draft.workplaceId || props.currentWorkplaceId} onChange={e => setDraft({ ...draft, workplaceId: e.target.value })}>{props.workplaces.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select></label><label>Display Type<select value={draft.displayKind || 'source'} onChange={e => setDraft({ ...draft, displayKind: e.target.value as CameraRule['displayKind'], itemId: '' })}><option value="source">CTRL Source</option><option value="composition">CTRL Composition</option></select></label><label>Content<select value={draft.itemId || ''} onChange={e => { const item = values.find(value => idOf(value) === e.target.value); setDraft({ ...draft, itemId: e.target.value, itemLabel: labelOf(item) }) }}><option value="">Select…</option>{values.map(value => <option key={idOf(value)} value={idOf(value)}>{labelOf(value)}</option>)}</select></label><div className="property-quad"><label>Duration<input type="number" value={draft.durationSec || 15} onChange={e => setDraft({ ...draft, durationSec: Number(e.target.value) })}/></label><label>Cooldown<input type="number" value={draft.cooldownSec || 20} onChange={e => setDraft({ ...draft, cooldownSec: Number(e.target.value) })}/></label><label>Priority<input type="number" value={draft.priority || 1} onChange={e => setDraft({ ...draft, priority: Number(e.target.value) })}/></label><label>Min Area<input type="number" value={draft.minArea || 2500} onChange={e => setDraft({ ...draft, minArea: Number(e.target.value) })}/></label></div><label className="bc-toggle-row"><input type="checkbox" checked={draft.enabled} onChange={e => setDraft({ ...draft, enabled: e.target.checked })}/><span>Rule Enabled</span></label>{draft.id && <button className="bc-btn danger full" onClick={async () => { await api.deleteCameraRule(draft.id!); setSelectedId(''); setDraft(emptyCamera(props.currentWorkplaceId)); await props.refresh() }}>{icon('delete')} Delete Rule</button>}</aside></div><section className="bc-panel camera-events"><h3>Recent Event Log</h3><LogsTable logs={props.status?.logs || []} compact /></section></div>
}

function InternetScreen(props: { sources: ExternalSource[]; renderers: SystemConfig['renderers']; rendererStatus: RendererStatus | null; workplaces: Workplace[]; workplaceId: string; onWorkplace: (id: string) => void; notify: (kind: Toast['kind'], message: string) => void; refresh: () => Promise<void> }) {
  const [selectedId, setSelectedId] = useState(props.sources[0]?.id || '')
  const selected = props.sources.find(source => source.id === selectedId)
  const [draft, setDraft] = useState<ExternalSource>(selected || { name: '', type: 'web', url: 'https://', rendererId: props.renderers[0]?.id || 'main', enabled: true })
  useEffect(() => { const value = props.sources.find(source => source.id === selectedId); if (value) setDraft({ ...value }) }, [selectedId, props.sources])

  async function save() {
    try { const result = await api.saveExternalSource(draft); setSelectedId(result.source.id || ''); await props.refresh(); props.notify('ok', 'Internet source saved.') }
    catch (error: any) { props.notify('error', error.message) }
  }

  return <div className="bc-screen internet-screen"><ScreenTitle title="Internet Sources" subtitle="Manage web content delivery to rendering nodes." /><div className="internet-layout"><section className="internet-library bc-panel"><div className="internet-head"><h3>ACTIVE WEB SOURCES</h3><span>{props.rendererStatus?.active.filter(r => r.running).length || 0} ONLINE</span></div><div className="internet-cards">{props.sources.map(source => <article className={selectedId === source.id ? 'active' : ''} key={source.id} onClick={() => setSelectedId(source.id || '')}><div className="web-thumb">{icon(source.type === 'web' ? 'language' : source.type === 'image' ? 'image' : 'movie')}</div><span className="online-badge">{source.enabled ? 'ONLINE' : 'OFFLINE'}</span><strong>{source.name}</strong><small>{source.url}</small></article>)}</div></section><aside className="internet-form bc-panel"><h3>ADD / EDIT CONTENT</h3><label>Source URL<input value={draft.url} onChange={e => setDraft({ ...draft, url: e.target.value })}/></label><label>Name<input value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })}/></label><label>Type<select value={draft.type} onChange={e => setDraft({ ...draft, type: e.target.value as ExternalSource['type'] })}><option value="web">Web</option><option value="image">Image</option><option value="video">Direct Video</option></select></label><label>Target Renderer<select value={draft.rendererId} onChange={e => setDraft({ ...draft, rendererId: e.target.value })}>{props.renderers.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label><label>Destination Wall<select value={props.workplaceId} onChange={e => props.onWorkplace(e.target.value)}>{props.workplaces.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select></label><div className="internet-actions"><button className="bc-btn" onClick={() => void save()}>{icon('save')} Save</button><button className="bc-btn primary" disabled={!draft.id} onClick={async () => { if (!draft.id) return; try { await api.showExternalSource(draft.id, props.workplaceId); props.notify('ok', 'External source sent to wall.') } catch (error: any) { props.notify('error', error.message) } }}>{icon('cast')} Show Fullscreen</button></div>{draft.id && <button className="bc-text-danger" onClick={async () => { await api.deleteExternalSource(draft.id!); setSelectedId(''); setDraft({ name: '', type: 'web', url: 'https://', rendererId: props.renderers[0]?.id || 'main', enabled: true }); await props.refresh() }}>{icon('delete')} Delete source</button>}</aside></div></div>
}

function CompositionsScreen(props: { layouts: MixedLayout[]; sources: any[]; compositions: any[]; externalSources: ExternalSource[]; workplaces: Workplace[]; currentWorkplaceId: string; notify: (kind: Toast['kind'], message: string) => void; refresh: () => Promise<void>; refreshWall: () => Promise<void> }) {
  const [layoutId, setLayoutId] = useState(props.layouts[0]?.id || '')
  const [draft, setDraft] = useState<MixedLayout>(props.layouts[0] ? JSON.parse(JSON.stringify(props.layouts[0])) : { name: 'New Composition', workplaceId: props.currentWorkplaceId, items: [] })
  const [selectedIndex, setSelectedIndex] = useState(-1)
  const [filter, setFilter] = useState<PaletteFilter>('source')
  const [query, setQuery] = useState('')
  useEffect(() => {
    const next = props.layouts.find(layout => layout.id === layoutId)
    if (next) { setDraft(JSON.parse(JSON.stringify(next))); setSelectedIndex(-1) }
  }, [layoutId, props.layouts])
  const wall = props.workplaces.find(value => value.id === draft.workplaceId) || props.workplaces.find(value => value.id === props.currentWorkplaceId)
  const width = wall?.geometry?.width || 1920
  const height = wall?.geometry?.height || 1080

  function add(payload: WallPalettePayload, geometry = centerGeometry(wall)) {
    setDraft(current => ({ ...current, items: [...current.items, { ...payload, geometry }] }))
    setSelectedIndex(draft.items.length)
  }

  async function save() {
    try {
      const result = await api.saveLayout(draft)
      setLayoutId(result.layout.id || '')
      await props.refresh()
      props.notify('ok', 'Composition saved.')
    } catch (error: any) { props.notify('error', error.message) }
  }

  async function deploy() {
    if (!draft.items.length) return props.notify('warn', 'La composición no tiene elementos.')
    try {
      await api.applyLayout(draft.workplaceId, draft.items)
      props.notify('ok', `Composition deployed to ${wall?.name || 'wall'}.`)
      if (draft.workplaceId === props.currentWorkplaceId) await props.refreshWall()
    } catch (error: any) { props.notify('error', error.message) }
  }

  return <div className="bc-screen visual-editor-screen"><ScreenTitle title="Compositions Editor" subtitle="Los filtros funcionan por tipo y toda la geometría se ajusta con el mouse." actions={<><select className="bc-compact-select" value={layoutId} onChange={e => setLayoutId(e.target.value)}><option value="">New composition</option>{props.layouts.map(layout => <option key={layout.id} value={layout.id}>{layout.name}</option>)}</select><button className="bc-btn" onClick={() => { setLayoutId(''); setDraft({ name: 'New Composition', workplaceId: props.currentWorkplaceId, items: [] }); setSelectedIndex(-1) }}>{icon('add')} New</button><button className="bc-btn" onClick={() => void save()}>{icon('save')} Save Composition</button><button className="bc-btn primary" onClick={() => void deploy()}>{icon('cast')} Deploy to Wall</button></>} /><div className="visual-editor-layout"><EditorPalette filter={filter} setFilter={setFilter} query={query} setQuery={setQuery} sources={props.sources} compositions={props.compositions} external={props.externalSources} onQuickAdd={payload => add(payload)} /><section className="visual-stage bc-panel"><div className="composition-name-row"><input value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })}/><select value={draft.workplaceId} onChange={e => setDraft({ ...draft, workplaceId: e.target.value })}>{props.workplaces.map(value => <option key={value.id} value={value.id}>{value.name}</option>)}</select></div><WallCanvas items={draft.items} wallWidth={width} wallHeight={height} selectedIndex={selectedIndex} onItemsChange={items => setDraft({ ...draft, items })} onSelect={setSelectedIndex} onDropNew={(payload, geometry) => add(payload, geometry)} /></section><ElementInspector items={draft.items} selectedIndex={selectedIndex} wall={wall} onItems={items => setDraft({ ...draft, items })} onSelected={setSelectedIndex} /></div>{draft.id && <div className="composition-delete-row"><button className="bc-btn danger" onClick={async () => { try { await api.deleteLayout(draft.id!); setLayoutId(''); setDraft({ name: 'New Composition', workplaceId: props.currentWorkplaceId, items: [] }); await props.refresh(); props.notify('ok', 'Composition deleted.') } catch (error: any) { props.notify('error', error.message) } }}>{icon('delete')} Delete Composition</button></div>}</div>
}

function DiagnosticsScreen(props: { diagnostics: DiagnosticsResult | null; config: SystemConfig; onRefresh: () => Promise<void>; notify: (kind: Toast['kind'], message: string) => void }) {
  const [local, setLocal] = useState<any>(null)
  async function run() {
    try { await props.onRefresh(); setLocal(await api.localDiagnostics(props.config)); props.notify('ok', 'System diagnostics refreshed.') }
    catch (error: any) { props.notify('error', error.message) }
  }
  return <div className="bc-screen diagnostics-screen"><ScreenTitle title="System Diagnosis" subtitle="Real-time health status of core operational modules." actions={<button className="bc-btn primary" onClick={() => void run()}>{icon('refresh')} Re-check System</button>} /><div className="diagnostic-grid">{(props.diagnostics?.checks || []).map(check => <article className={`diagnostic-card ${check.status}`} key={check.id}><div><small>{check.id}</small>{icon(check.status === 'ok' ? 'check_circle' : check.status === 'warn' ? 'warning' : 'error')}</div><strong>{check.label}</strong><p>{check.detail}</p><span>{check.status.toUpperCase()}</span></article>)}</div><section className="bc-panel system-terminal"><div><h3>System Terminal Log</h3></div><pre>{(props.diagnostics?.checks || []).map(check => `[${check.status.toUpperCase()}] ${check.label}: ${check.detail}`).join('\n')}{local ? `\n[LOCAL] VNC: ${JSON.stringify(local.vnc)}\n[LOCAL] Browsers: ${local.browsers?.map((browser: any) => browser.name).join(', ') || 'none'}` : ''}</pre></section></div>
}

function LogsScreen({ routeLogs, cameraLogs }: { routeLogs: LogEntry[]; cameraLogs: LogEntry[] }) {
  const [query, setQuery] = useState('')
  const combined = useMemo(() => [...routeLogs.map(log => ({ ...log, module: 'TOUR_ENGINE' })), ...cameraLogs.map(log => ({ ...log, module: 'CAMERAS' }))].sort((a,b) => b.ts - a.ts), [routeLogs, cameraLogs])
  const filtered = combined.filter(log => log.message.toLowerCase().includes(query.toLowerCase()))
  return <div className="bc-screen logs-screen"><ScreenTitle title="System Activity Logs" subtitle="Real-time operational auditing and system events." /><section className="bc-panel logs-panel"><div className="logs-filter"><div className="bc-search">{icon('search')}<input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search messages…" /></div></div><LogsTable logs={filtered} showModule /></section></div>
}

function LogsTable({ logs, compact = false, showModule = false }: { logs: Array<LogEntry & { module?: string }>; compact?: boolean; showModule?: boolean }) {
  return <div className={`bc-log-table ${compact ? 'compact' : ''}`}><div className="bc-log-head"><span>Timestamp</span>{showModule && <span>Module</span>}<span>Level</span><span>Message Details</span></div>{logs.length ? logs.map((log,index) => <div className="bc-log-row" key={`${log.ts}-${index}`}><span>{new Date(log.ts * 1000).toLocaleString()}</span>{showModule && <span>{log.module}</span>}<span><b className={`log-level ${log.level}`}>{log.level}</b></span><span>{log.message}</span></div>) : <div className="bc-empty-row">No activity records.</div>}</div>
}

function ConfigurationScreen(props: { config: SystemConfig; sources: any[]; onSaved: () => void; notify: (kind: Toast['kind'], message: string) => void }) {
  const [draft, setDraft] = useState<SystemConfig>(JSON.parse(JSON.stringify(props.config)))
  const [browsers, setBrowsers] = useState<Array<{ name: string; path: string }>>([])
  const [detectedWorkplaces, setDetectedWorkplaces] = useState<any[]>(props.config.workplaces || [])
  const [detectedSources, setDetectedSources] = useState<any[]>(props.sources)
  const [ctrlUser, setCtrlUser] = useState('')
  const [ctrlPassword, setCtrlPassword] = useState('')
  const [selectedWall, setSelectedWall] = useState(0)
  const [busy, setBusy] = useState(false)
  const [advancedBinding, setAdvancedBinding] = useState(false)
  const [wallJustAdded, setWallJustAdded] = useState(false)

  useEffect(() => { api.setupBrowsers().then(setBrowsers).catch(() => {}) }, [])
  useEffect(() => {
    if (selectedWall >= draft.workplaces.length && draft.workplaces.length) setSelectedWall(draft.workplaces.length - 1)
  }, [draft.workplaces.length, selectedWall])

  const renderer = draft.renderers[0] || defaultRenderer()
  const wall = draft.workplaces[selectedWall]
  const setRenderer = (patch: Partial<SystemConfig['renderers'][number]>) => setDraft(current => ({ ...current, renderers: [{ ...renderer, ...patch }, ...current.renderers.slice(1)] }))
  const patchWall = (patch: Partial<Workplace>) => {
    setDraft(current => {
      const walls = [...current.workplaces]
      if (!walls[selectedWall]) return current
      walls[selectedWall] = { ...walls[selectedWall], ...patch }
      return { ...current, workplaces: walls }
    })
  }
  const patchWallGeometry = (patch: Partial<NonNullable<Workplace['geometry']>>) => {
    if (!wall) return
    patchWall({ geometry: { ...(wall.geometry || fullGeometry()), ...patch } })
  }

  async function discover() {
    setBusy(true)
    try {
      const result = await api.discoverSetup(draft, ctrlUser, ctrlPassword, wall?.id || '')
      setDetectedWorkplaces(result.workplaces)
      setDetectedSources(result.sources)
      setCtrlPassword('')
      props.notify(result.warnings?.length ? 'warn' : 'ok', result.warnings?.length ? result.warnings.join(' | ') : `${result.workplaces.length} CTRL workplaces detected.`)
    } catch (error: any) { props.notify('error', error.message) }
    finally { setBusy(false) }
  }

  function addWall() {
    const next: Workplace = {
      id: '',
      name: `Wall secundario ${draft.workplaces.length + 1}`,
      role: 'secondary',
      geometry: { type: 'px', x: 0, y: 0, width: 1920, height: 1080 },
    }
    setDraft(current => ({ ...current, workplaces: [...current.workplaces, next] }))
    setSelectedWall(draft.workplaces.length)
    setWallJustAdded(true)
  }

  function selectDetectedWorkplace(id: string) {
    const selected = detectedWorkplaces.find(value => idOf(value) === id)
    patchWall({
      id,
      name: selected && (wallJustAdded || !wall?.name.trim()) ? labelOf(selected) : wall?.name || labelOf(selected),
    })
  }

  function makePrimary() {
    if (!wall) return
    const walls: Workplace[] = draft.workplaces.map((value,index) => ({ ...value, role: index === selectedWall ? 'primary' : 'secondary' }))
    const chosen = walls.splice(selectedWall, 1)[0]
    setDraft({ ...draft, workplaces: [chosen, ...walls] })
    setSelectedWall(0)
    setWallJustAdded(false)
  }

  function removeWall() {
    if (!wall || draft.workplaces.length <= 1) return
    const walls = draft.workplaces.filter((_,index) => index !== selectedWall)
    if (!walls.some(value => roleOf(value) === 'primary')) walls[0] = { ...walls[0], role: 'primary' }
    setDraft({ ...draft, workplaces: walls })
    setSelectedWall(Math.max(0, selectedWall - 1))
    setWallJustAdded(false)
  }

  function validateWalls() {
    if (!draft.workplaces.length) return 'Debe existir al menos un wall configurado.'
    const missingName = draft.workplaces.find(value => !String(value.name || '').trim())
    if (missingName) return 'Todos los walls deben tener un nombre.'
    const missingId = draft.workplaces.find(value => !String(value.id || '').trim())
    if (missingId) return `El wall "${missingId.name}" necesita el Workplace ID real de CTRL.`
    const duplicate = draft.workplaces.find((value,index) => draft.workplaces.findIndex(other => other.id === value.id) !== index)
    if (duplicate) return `El Workplace ID ${duplicate.id} está asignado más de una vez.`
    const invalidGeometry = draft.workplaces.find(value => !value.geometry || Number(value.geometry.width) <= 0 || Number(value.geometry.height) <= 0)
    if (invalidGeometry) return `El wall "${invalidGeometry.name}" necesita Width y Height mayores que cero.`
    return ''
  }

  async function saveAll() {
    const validation = validateWalls()
    if (validation) return props.notify('warn', validation)
    try {
      const result = await api.saveSetup(draft)
      setDraft(JSON.parse(JSON.stringify(result.config)))
      setWallJustAdded(false)
      props.notify(
        result.sessionPreserved ? 'ok' : 'warn',
        result.restartRequiredForServerBinding
          ? 'Configuración guardada. Reinicia la aplicación para aplicar host/puerto.'
          : result.sessionPreserved
            ? 'Configuración guardada y aplicada correctamente.'
            : 'Configuración guardada. Cambió la conexión CTRL; inicia sesión nuevamente.'
      )
      props.onSaved()
    } catch (error: any) { props.notify('error', error.message) }
  }

  const sortedSources = [...detectedSources].sort((a,b) => Number(looksLikeVnc(b)) - Number(looksLikeVnc(a)))
  const detectedHasCurrent = !!wall?.id && detectedWorkplaces.some(value => idOf(value) === wall.id)

  return <div className="bc-screen settings-screen"><ScreenTitle title="System Configuration" subtitle="Los cambios se validan antes de reemplazar la configuración anterior." /><div className="settings-columns"><section className="settings-card bc-panel"><h3>{icon('dns')} CTRL Server</h3><label>IP Address / URL<input value={draft.barco.base_url} onChange={e => setDraft({ ...draft, barco: { ...draft.barco, base_url: e.target.value } })}/></label><div className="settings-grid-two"><label>Realm<input value={draft.barco.oidc.realm} onChange={e => setDraft({ ...draft, barco: { ...draft.barco, oidc: { ...draft.barco.oidc, realm: e.target.value } } })}/></label><label>Client ID<input value={draft.barco.oidc.client_id} onChange={e => setDraft({ ...draft, barco: { ...draft.barco, oidc: { ...draft.barco.oidc, client_id: e.target.value } } })}/></label></div><div className="settings-grid-two"><label>Temporary User<input value={ctrlUser} onChange={e => setCtrlUser(e.target.value)}/></label><label>Temporary Password<input type="password" value={ctrlPassword} onChange={e => setCtrlPassword(e.target.value)}/></label></div><button className="bc-outline-red" disabled={busy} onClick={() => void discover()}>{busy ? 'Detecting…' : 'Test / Discover Connection'}</button></section><section className="settings-card bc-panel wall-settings-card"><h3>{icon('desktop_windows')} Workplaces / Walls</h3><p className="wall-add-help"><b>Para agregar un wall:</b> pulsa “Agregar wall secundario”, escribe un nombre, selecciona el Workplace detectado por CTRL o pega su ID manualmente, confirma la resolución y finalmente pulsa “Save All Changes”.</p><div className="wall-manager"><div className="wall-list">{draft.workplaces.map((value,index) => <button key={`${value.id}-${index}`} className={selectedWall === index ? 'active' : ''} onClick={() => { setSelectedWall(index); setWallJustAdded(false) }}><span>{roleOf(value) === 'primary' ? icon('star') : icon('desktop_windows')}</span><div><strong>{value.name}</strong><small>{roleOf(value) === 'primary' ? 'Principal' : 'Secundario'} · {value.id || 'ID pendiente'}</small></div></button>)}<button className="add-wall" onClick={addWall}>{icon('add')} Agregar wall secundario</button></div>{wall && <div className="wall-editor">{wallJustAdded && roleOf(wall) === 'secondary' && <div className="wall-new-notice"><b>Nuevo wall secundario.</b><br/>Completa los campos de este panel. No se guardará hasta que pulses “Save All Changes”.</div>}<div className="wall-editor-heading"><div><strong>{wallJustAdded ? 'Configurar nuevo wall' : 'Editar wall seleccionado'}</strong><small>{wall.id ? `Workplace ID: ${wall.id}` : 'Todavía falta asociarlo a un Workplace real de CTRL.'}</small></div><span className={`wall-role-badge ${roleOf(wall) === 'primary' ? 'primary' : ''}`}>{roleOf(wall) === 'primary' ? 'Principal' : 'Secundario'}</span></div><div className="wall-form-grid"><label>Nombre del wall <span className="wall-required">*</span><input required value={wall.name} onChange={e => patchWall({ name: e.target.value })} placeholder="Ej. Sala de crisis" /></label><label>CTRL Workplace detectado<select value={detectedHasCurrent ? wall.id : ''} onChange={e => selectDetectedWorkplace(e.target.value)}><option value="">Seleccionar del inventario…</option>{detectedWorkplaces.map(value => <option key={idOf(value)} value={idOf(value)}>{labelOf(value)} · {idOf(value)}</option>)}</select></label><label className="full">Workplace ID manual <span className="wall-required">*</span><input required value={wall.id} onChange={e => patchWall({ id: e.target.value.trim() })} placeholder="Pega aquí el ID real del Workplace de CTRL" /><span className="wall-manual-id-note">Si seleccionas un Workplace arriba, este campo se completa automáticamente. También puedes pegar el ID manualmente.</span></label></div><div><label>Resolución / área del wall</label><div className="wall-resolution-grid"><label>X<input type="number" value={wall.geometry?.x ?? 0} onChange={e => patchWallGeometry({ x: Number(e.target.value) })}/></label><label>Y<input type="number" value={wall.geometry?.y ?? 0} onChange={e => patchWallGeometry({ y: Number(e.target.value) })}/></label><label>Width <span className="wall-required">*</span><input required type="number" min="1" value={wall.geometry?.width ?? 1920} onChange={e => patchWallGeometry({ width: Number(e.target.value) })}/></label><label>Height <span className="wall-required">*</span><input required type="number" min="1" value={wall.geometry?.height ?? 1080} onChange={e => patchWallGeometry({ height: Number(e.target.value) })}/></label></div></div><p className="wall-add-help">Para un wall completo normalmente usa <b>X=0</b> y <b>Y=0</b>. Width y Height deben representar el área real que CTRL utilizará para colocar las fuentes.</p><div className="wall-editor-actions">{roleOf(wall) !== 'primary' && <button className="bc-btn" onClick={makePrimary}>{icon('star')} Make Principal</button>}{draft.workplaces.length > 1 && <button className="bc-btn danger" onClick={removeWall}>{icon('delete')} Remove Wall</button>}</div></div>}</div></section><section className="settings-card bc-panel"><h3>{icon('language')} Renderer / VNC</h3><label>CTRL VNC Source<select value={renderer.barco_source_id} onChange={e => { const source = sortedSources.find(value => idOf(value) === e.target.value); setRenderer({ barco_source_id: e.target.value, barco_source_label: labelOf(source) }) }}><option value="">Select VNC source…</option>{sortedSources.map(source => <option key={idOf(source)} value={idOf(source)}>{labelOf(source)}{looksLikeVnc(source) ? ' · VNC' : ''}</option>)}</select></label><div className="settings-grid-two"><label>VNC Host<input value={renderer.vnc_host} onChange={e => setRenderer({ vnc_host: e.target.value })}/></label><label>VNC Port<input type="number" value={renderer.vnc_port} onChange={e => setRenderer({ vnc_port: Number(e.target.value) })}/></label></div><label>Browser<select value={renderer.browser_path} onChange={e => setRenderer({ browser_path: e.target.value })}><option value="">Auto-detect</option>{browsers.map(browser => <option key={browser.path} value={browser.path}>{browser.name}</option>)}</select></label></section><section className="settings-card bc-panel"><h3>{icon('lan')} Local Service</h3><label className="bc-toggle-row"><input type="checkbox" checked={advancedBinding} onChange={e => setAdvancedBinding(e.target.checked)}/><span>Editar binding local (avanzado)</span></label><div className="settings-grid-two"><label>Bind Host<input disabled={!advancedBinding} value={draft.server.host} onChange={e => setDraft({ ...draft, server: { ...draft.server, host: e.target.value } })}/></label><label>Port<input disabled={!advancedBinding} type="number" value={draft.server.port} onChange={e => setDraft({ ...draft, server: { ...draft.server, port: Number(e.target.value) } })}/></label></div><p className="bc-help">Normalmente no debes cambiar 127.0.0.1:8080. Los cambios de binding requieren reiniciar la aplicación.</p></section></div><div className="settings-footer"><span>Save valida el runtime. Si falla, el backend restaura automáticamente la configuración anterior.</span><div><button className="bc-btn" onClick={() => { setDraft(JSON.parse(JSON.stringify(props.config))); setSelectedWall(0); setWallJustAdded(false) }}>Discard</button><button className="bc-btn primary" onClick={() => void saveAll()}>{icon('save')} Save All Changes</button></div></div></div>
}

function SetupWizard({ onConfigured, notify }: { onConfigured: () => void; notify: (kind: Toast['kind'], message: string) => void }) {
  const [config, setConfig] = useState<SystemConfig | null>(null)
  const [step, setStep] = useState(1)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [inventory, setInventory] = useState<any[]>([])
  const [sources, setSources] = useState<any[]>([])
  const [busy, setBusy] = useState(false)
  useEffect(() => { api.setupConfig().then(setConfig).catch(error => notify('error', error.message)) }, [])
  if (!config) return <Splash />
  const primary = config.workplaces[0] || { id: '', name: 'Wall principal', role: 'primary' as const, geometry: { type: 'px', x: 0, y: 0, width: 3840, height: 2160 } }
  const renderer = config.renderers[0] || defaultRenderer()
  const patchPrimary = (patch: Partial<Workplace>) => setConfig({ ...config, workplaces: [{ ...primary, ...patch }, ...config.workplaces.slice(1)] })
  const patchRenderer = (patch: Partial<SystemConfig['renderers'][number]>) => setConfig({ ...config, renderers: [{ ...renderer, ...patch }, ...config.renderers.slice(1)] })

  async function discover() {
    setBusy(true)
    try {
      const result = await api.discoverSetup(config, username, password, primary.id)
      setInventory(result.workplaces)
      setSources(result.sources)
      const id = primary.id || result.selectedWorkplaceId || idOf(result.workplaces[0])
      const found = result.workplaces.find(value => idOf(value) === id)
      if (id) patchPrimary({ id, name: found ? labelOf(found) : primary.name, role: 'primary' })
      setPassword('')
      notify('ok', `CTRL detected: ${result.workplaces.length} workplaces.`)
      setStep(4)
    } catch (error: any) { notify('error', error.message) }
    finally { setBusy(false) }
  }

  const progress = Math.round(step / 7 * 100)
  return <div className="bc-setup-page"><header><div className="bc-top-brand">Barco Controller</div><div><small>System Initialization</small><b>{progress}%</b></div></header><div className="setup-progress"><i style={{ width: `${progress}%` }}/></div><div className="setup-steps">{['Welcome','CTRL','Authentication','Walls','Renderer','Diagnostics','Finalize'].map((label,index) => <span className={step >= index + 1 ? 'active' : ''} key={label}><i/>{label}</span>)}</div><main className="setup-main">{step === 1 && <SetupCard title="Barco Controller" subtitle="Mission-critical operations suite for CTRL video walls." iconName="developer_board"><p>Configura el servidor CTRL, el wall principal y el renderer VNC. Los walls secundarios se agregan luego desde Configuration.</p><button className="bc-btn primary" onClick={() => setStep(2)}>Begin Setup {icon('arrow_forward')}</button></SetupCard>}{step === 2 && <SetupCard title="CTRL Server" subtitle="Connect the controller to your Barco CTRL system." iconName="dns"><label>CTRL URL<input value={config.barco.base_url} onChange={e => setConfig({ ...config, barco: { ...config.barco, base_url: e.target.value } })} placeholder="https://CTRL-IP" /></label><div className="settings-grid-two"><label>Realm<input value={config.barco.oidc.realm} onChange={e => setConfig({ ...config, barco: { ...config.barco, oidc: { ...config.barco.oidc, realm: e.target.value } } })}/></label><label>Client ID<input value={config.barco.oidc.client_id} onChange={e => setConfig({ ...config, barco: { ...config.barco, oidc: { ...config.barco.oidc, client_id: e.target.value } } })}/></label></div><button className="bc-btn primary" onClick={() => setStep(3)}>Continue</button></SetupCard>}{step === 3 && <SetupCard title="Authentication & Inventory" subtitle="Credentials are used only for discovery and are not stored." iconName="lock"><label>Username<input value={username} onChange={e => setUsername(e.target.value)}/></label><label>Password<input type="password" value={password} onChange={e => setPassword(e.target.value)}/></label><button className="bc-btn primary" disabled={busy} onClick={() => void discover()}>{busy ? 'Scanning…' : 'Authenticate & Scan'}</button></SetupCard>}{step === 4 && <SetupCard title="Wall Assignment" subtitle="Choose the primary wall." iconName="desktop_windows"><label>Primary Workplace<select value={primary.id} onChange={e => { const found = inventory.find(value => idOf(value) === e.target.value); patchPrimary({ id: e.target.value, name: labelOf(found), role: 'primary' }) }}><option value="">Select…</option>{inventory.map(value => <option key={idOf(value)} value={idOf(value)}>{labelOf(value)}</option>)}</select></label><label>Display Name<input value={primary.name} onChange={e => patchPrimary({ name: e.target.value })}/></label><button className="bc-btn primary" onClick={() => setStep(5)}>Continue</button></SetupCard>}{step === 5 && <SetupCard title="Renderer VNC" subtitle="Associate the local renderer with a VNC source in CTRL." iconName="language"><label>CTRL VNC Source<select value={renderer.barco_source_id} onChange={e => { const source = sources.find(value => idOf(value) === e.target.value); patchRenderer({ barco_source_id: e.target.value, barco_source_label: labelOf(source) }) }}><option value="">Select VNC source…</option>{[...sources].sort((a,b) => Number(looksLikeVnc(b)) - Number(looksLikeVnc(a))).map(value => <option key={idOf(value)} value={idOf(value)}>{labelOf(value)}{looksLikeVnc(value) ? ' · VNC' : ''}</option>)}</select></label><button className="bc-btn primary" onClick={() => setStep(6)}>Continue</button></SetupCard>}{step === 6 && <SetupCard title="Preflight Check" subtitle="Validate configuration before saving." iconName="medical_services"><button className="bc-btn primary" onClick={async () => { try { await api.testSetup(config); setStep(7); notify('ok', 'Preflight completed.') } catch (error: any) { notify('error', error.message) } }}>Run Preflight</button></SetupCard>}{step === 7 && <SetupCard title="Initialization Complete" subtitle="Save the configuration and start Barco Controller." iconName="verified"><button className="bc-btn primary" onClick={async () => { try { await api.saveSetup(config); notify('ok', 'Configuration saved.'); onConfigured() } catch (error: any) { notify('error', error.message) } }}>Save & Launch</button></SetupCard>}</main></div>
}

function SetupCard({ title, subtitle, iconName, children }: { title: string; subtitle: string; iconName: string; children: ReactNode }) {
  return <section className="setup-card"><div className="setup-card-icon">{icon(iconName)}</div><div className="setup-card-head"><h1>{title}</h1><p>{subtitle}</p></div><div className="setup-card-body">{children}</div></section>
}

function EmptyState({ iconName, title }: { iconName: string; title: string }) {
  return <div className="bc-empty-state">{icon(iconName)}<h3>{title}</h3></div>
}
