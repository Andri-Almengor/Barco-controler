import { useEffect, useState, type FormEvent } from 'react'
import {
  api, type CameraRule, type CameraStatus, type ExternalSource, type LogEntry,
  type Route, type RouteItem, type RouteRuntime, type SystemConfig, type Workplace,
} from './api'
import ExternalPanel from './components/ExternalPanel'
import SettingsPanel from './components/SettingsPanel'
import SetupWizard from './components/SetupWizard'
import { emptyCamera, fmt, idOf, labelOf } from './helpers'

type Tab = 'routes' | 'external' | 'cameras' | 'manual' | 'settings' | 'logs'

export default function App() {
  const [setupChecked, setSetupChecked] = useState(false)
  const [configured, setConfigured] = useState(false)
  const [auth, setAuth] = useState(false)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [tab, setTab] = useState<Tab>('routes')
  const [config, setConfig] = useState<SystemConfig | null>(null)
  const [workplaces, setWorkplaces] = useState<Workplace[]>([])
  const [workplaceId, setWorkplaceId] = useState('')
  const [compositions, setCompositions] = useState<any[]>([])
  const [sources, setSources] = useState<any[]>([])
  const [routes, setRoutes] = useState<Route[]>([])
  const [routeId, setRouteId] = useState('')
  const [runtimes, setRuntimes] = useState<RouteRuntime[]>([])
  const [externalSources, setExternalSources] = useState<ExternalSource[]>([])
  const [cameraRules, setCameraRules] = useState<CameraRule[]>([])
  const [cameraId, setCameraId] = useState('')
  const [cameraDraft, setCameraDraft] = useState<CameraRule>(emptyCamera())
  const [cameraStatus, setCameraStatus] = useState<CameraStatus | null>(null)
  const [routeLogs, setRouteLogs] = useState<LogEntry[]>([])

  const activeRoute = routes.find(r => r.id === routeId)
  const activeRuntime = runtimes.find(r => r.routeId === routeId)
  const activeCamera = cameraRules.find(r => r.id === cameraId)

  useEffect(() => {
    api.setupStatus()
      .then(async status => {
        setConfigured(status.configured)
        setSetupChecked(true)
        if (status.configured) {
          try { setAuth((await api.authStatus()).authenticated) }
          catch { setAuth(false) }
        }
      })
      .catch(e => { setError(e.message); setSetupChecked(true) })
  }, [])

  useEffect(() => {
    const expired = () => setAuth(false)
    window.addEventListener('barco-auth-expired', expired)
    return () => window.removeEventListener('barco-auth-expired', expired)
  }, [])

  useEffect(() => {
    if (!auth) return
    void refreshBase()
    const timer = window.setInterval(() => void refreshRuntime(), 1000)
    return () => window.clearInterval(timer)
  }, [auth])

  useEffect(() => {
    if (!auth || !workplaceId) return
    Promise.all([api.compositions(), api.sources(workplaceId)])
      .then(([nextCompositions, nextSources]) => {
        setCompositions(nextCompositions)
        setSources(nextSources)
      })
      .catch(e => setError(e.message))
  }, [auth, workplaceId])

  useEffect(() => {
    if (activeCamera) setCameraDraft({ ...activeCamera, password: '' })
  }, [cameraId, activeCamera?.updatedAt])

  async function refreshBase() {
    try {
      const [cfg, nextWorkplaces, nextRoutes, nextExternal, nextCameras] = await Promise.all([
        api.publicConfig(), api.workplaces(), api.routes(), api.externalSources(), api.cameraRules(),
      ])
      setConfig(cfg)
      setWorkplaces(nextWorkplaces)
      setRoutes(nextRoutes)
      setExternalSources(nextExternal)
      setCameraRules(nextCameras)
      setWorkplaceId(current => current || nextWorkplaces[0]?.id || '')
      setRouteId(current => current || nextRoutes[0]?.id || '')
      setCameraId(current => current || nextCameras[0]?.id || '')
      await refreshRuntime()
    } catch (e: any) { setError(e.message) }
  }

  async function refreshRuntime() {
    try {
      const [nextRuntimes, nextCameraStatus, nextLogs] = await Promise.all([
        api.routeRuntimes(), api.cameraStatus(), api.routeLogs(),
      ])
      setRuntimes(nextRuntimes)
      setCameraStatus(nextCameraStatus)
      setRouteLogs(nextLogs)
    } catch { }
  }

  async function login(e: FormEvent) {
    e.preventDefault()
    setError('')
    try {
      await api.login(username, password)
      setPassword('')
      setAuth(true)
    } catch (e: any) { setError(e.message) }
  }

  async function saveRoute(patch: Partial<Route>) {
    try {
      const base: Partial<Route> = activeRoute || {
        name: `Recorrido ${routes.length + 1}`, intervalSec: 30, workplaceId, items: [],
      }
      const response = await api.saveRoute({ ...base, ...patch })
      await refreshBase()
      setRouteId(response.route.id)
    } catch (e: any) { setError(e.message) }
  }

  async function routeCommand(action: 'start' | 'stop' | 'pause' | 'resume') {
    if (!routeId) return
    try {
      if (action === 'start') await api.startRoute(routeId)
      if (action === 'stop') await api.stopRoute(routeId)
      if (action === 'pause') await api.pauseRoute(routeId)
      if (action === 'resume') await api.resumeRoute(routeId)
      await refreshRuntime()
    } catch (e: any) { setError(e.message) }
  }

  function addRouteItem(kind: RouteItem['kind'], id: string) {
    if (!activeRoute || !id) return
    const list = kind === 'source' ? sources : kind === 'composition' ? compositions : externalSources
    const item = list.find(value => idOf(value) === id)
    void saveRoute({ items: [...activeRoute.items, { kind, id, label: labelOf(item) }] })
  }

  async function saveCamera() {
    try {
      const result = await api.saveCameraRule(cameraDraft)
      await refreshBase()
      setCameraId(result.rule.id || '')
    } catch (e: any) { setError(e.message) }
  }

  if (!setupChecked) return <div className="splash"><div className="spinner"/><p>Cargando Barco Controller…</p></div>
  if (!configured) return <SetupWizard onConfigured={() => { setConfigured(true); setError('') }}/>

  if (!auth) {
    return <div className="login">
      <form className="loginCard" onSubmit={login}>
        <div className="productMark">BC</div>
        <h1>Barco Controller</h1>
        <p>Inicia sesión con un usuario de CTRL para operar y administrar el sistema.</p>
        <label>Usuario CTRL<input value={username} onChange={e => setUsername(e.target.value)} autoComplete="username"/></label>
        <label>Contraseña<input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password"/></label>
        {error && <div className="alert error">{error}</div>}
        <button className="primary" type="submit">Conectar</button>
      </form>
    </div>
  }

  return <div className="appShell">
    <header>
      <div className="brand"><span className="productMark small">BC</span><div><strong>Barco Controller</strong><small>Control plane</small></div></div>
      <div className="headerStatus"><span className={cameraStatus?.running ? 'dot ok' : 'dot'}/>{cameraStatus?.running ? 'Cámaras activas' : 'Cámaras detenidas'}<button className="ghost" onClick={async () => { await api.logout(); setAuth(false) }}>Salir</button></div>
    </header>

    <div className="layout">
      <aside>
        <div className="sectionLabel">Workplace</div>
        <select value={workplaceId} onChange={e => setWorkplaceId(e.target.value)}>
          {workplaces.length ? workplaces.map(w => <option key={w.id} value={w.id}>{w.name}</option>) : <option value="">Sin workplaces</option>}
        </select>
        <nav>
          {([
            ['routes', 'Recorridos'], ['external', 'Internet'], ['cameras', 'Cámaras'],
            ['manual', 'Control manual'], ['settings', 'Configuración'], ['logs', 'Actividad'],
          ] as [Tab, string][]).map(([id, label]) => <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>{label}</button>)}
        </nav>
      </aside>

      <main>
        {error && <div className="alert error dismiss">{error}<button onClick={() => setError('')}>×</button></div>}

        {tab === 'routes' && <RoutePanel
          routes={routes}
          routeId={routeId}
          activeRoute={activeRoute}
          activeRuntime={activeRuntime}
          compositions={compositions}
          sources={sources}
          externalSources={externalSources}
          workplaceId={workplaceId}
          onSelect={setRouteId}
          onSave={saveRoute}
          onCommand={routeCommand}
          onAdd={addRouteItem}
        />}

        {tab === 'external' && config && <ExternalPanel
          items={externalSources}
          renderers={config.renderers}
          workplaceId={workplaceId}
          onRefresh={refreshBase}
          onError={setError}
        />}

        {tab === 'cameras' && <CameraPanel
          rules={cameraRules}
          selectedId={cameraId}
          draft={cameraDraft}
          status={cameraStatus}
          workplaces={workplaces}
          compositions={compositions}
          sources={sources}
          workplaceId={workplaceId}
          onSelect={setCameraId}
          onDraft={setCameraDraft}
          onSave={saveCamera}
          onRefresh={refreshBase}
          onRuntime={refreshRuntime}
          onError={setError}
        />}

        {tab === 'manual' && <ManualPanel
          workplaceId={workplaceId}
          compositions={compositions}
          sources={sources}
          externalSources={externalSources}
          onError={setError}
        />}

        {tab === 'settings' && config && <SettingsPanel
          config={config}
          sources={sources}
          onSaved={async () => { await api.logout(); setAuth(false) }}
          onError={setError}
        />}

        {tab === 'logs' && <section className="panel"><h2>Actividad</h2><LogList title="Recorridos" logs={routeLogs}/><LogList title="Motor de cámaras" logs={cameraStatus?.logs || []}/></section>}
      </main>
    </div>
  </div>
}

function RoutePanel(props: {
  routes: Route[]
  routeId: string
  activeRoute?: Route
  activeRuntime?: RouteRuntime
  compositions: any[]
  sources: any[]
  externalSources: ExternalSource[]
  workplaceId: string
  onSelect: (id: string) => void
  onSave: (patch: Partial<Route>) => Promise<void>
  onCommand: (action: 'start' | 'stop' | 'pause' | 'resume') => Promise<void>
  onAdd: (kind: RouteItem['kind'], id: string) => void
}) {
  const { routes, routeId, activeRoute, activeRuntime, compositions, sources, externalSources, workplaceId, onSelect, onSave, onCommand, onAdd } = props
  return <div className="twoCol">
    <section className="panel">
      <div className="panelHead"><div><h2>Recorridos</h2><p>Composiciones, fuentes y contenido de Internet en una misma secuencia.</p></div><button onClick={() => void onSave({ id: undefined, name: `Recorrido ${routes.length + 1}`, workplaceId, items: [] })}>Nuevo</button></div>
      <div className="list">{routes.map(route => <button key={route.id} className={routeId === route.id ? 'selected' : ''} onClick={() => onSelect(route.id)}><strong>{route.name}</strong><span>{route.items.length} elementos · {route.intervalSec}s</span></button>)}</div>
    </section>
    <section className="panel">
      {activeRoute ? <>
        <div className="runtimeBar"><span className={`state ${activeRuntime?.state || 'stopped'}`}>{activeRuntime?.state || 'stopped'}</span><span>Siguiente: {activeRuntime?.nextRunAt ? fmt(activeRuntime.nextRunAt) : '—'}</span></div>
        <label>Nombre<input value={activeRoute.name} onChange={e => void onSave({ name: e.target.value })}/></label>
        <label>Intervalo (s)<input type="number" min="3" value={activeRoute.intervalSec} onChange={e => void onSave({ intervalSec: Number(e.target.value) })}/></label>
        <div className="controls"><button className="primary" onClick={() => void onCommand('start')}>Iniciar</button><button onClick={() => void onCommand('pause')}>Pausar</button><button onClick={() => void onCommand('resume')}>Reanudar</button><button className="danger" onClick={() => void onCommand('stop')}>Detener + limpiar</button></div>
        <div className="divider"/><h3>Secuencia</h3>
        <div className="items">{activeRoute.items.map((item, index) => <div className="item" key={`${item.kind}-${item.id}-${index}`}><span className={`badge ${item.kind}`}>{item.kind}</span><span>{item.label || item.id}</span><button onClick={() => void onSave({ items: activeRoute.items.filter((_, i) => i !== index) })}>×</button></div>)}</div>
        <Adder label="Agregar composición" values={compositions} onAdd={id => onAdd('composition', id)}/>
        <Adder label="Agregar fuente CTRL" values={sources} onAdd={id => onAdd('source', id)}/>
        <Adder label="Agregar contenido de Internet" values={externalSources} onAdd={id => onAdd('external', id)}/>
      </> : <div className="empty">Crea o selecciona un recorrido.</div>}
    </section>
  </div>
}

function CameraPanel(props: {
  rules: CameraRule[]
  selectedId: string
  draft: CameraRule
  status: CameraStatus | null
  workplaces: Workplace[]
  compositions: any[]
  sources: any[]
  workplaceId: string
  onSelect: (id: string) => void
  onDraft: (draft: CameraRule) => void
  onSave: () => Promise<void>
  onRefresh: () => Promise<void>
  onRuntime: () => Promise<void>
  onError: (message: string) => void
}) {
  const { rules, selectedId, draft, status, workplaces, compositions, sources, workplaceId, onSelect, onDraft, onSave, onRefresh, onRuntime, onError } = props
  const content = draft.displayKind === 'composition' ? compositions : sources
  return <div className="twoCol">
    <section className="panel">
      <div className="panelHead"><div><h2>Cámaras</h2><p>Reglas de movimiento con prioridad sobre recorridos.</p></div><button onClick={() => { onSelect(''); onDraft(emptyCamera(workplaceId)) }}>Nueva</button></div>
      <div className="engineControls"><button className="primary" onClick={async () => { await api.startCameras(); await onRuntime() }}>Iniciar motor</button><button className="danger" onClick={async () => { await api.stopCameras(); await onRuntime() }}>Detener motor</button></div>
      <div className="list">{rules.map(rule => <button key={rule.id} className={selectedId === rule.id ? 'selected' : ''} onClick={() => onSelect(rule.id || '')}><strong>{rule.name}</strong><span>{rule.detectionMode} · {rule.durationSec}s {rule.hasPassword ? '· credencial guardada' : ''}</span></button>)}</div>
    </section>
    <section className="panel cameraForm">
      <div className="runtimeBar"><span className={draft.enabled ? 'state running' : 'state stopped'}>{draft.enabled ? 'habilitada' : 'deshabilitada'}</span>{status?.activeEvent && <span>Activa: {status.activeEvent.ruleName}</span>}</div>
      <label>Nombre<input value={draft.name} onChange={e => onDraft({ ...draft, name: e.target.value })}/></label>
      <label>RTSP<input value={draft.rtspUrl || ''} onChange={e => onDraft({ ...draft, rtspUrl: e.target.value })} placeholder="rtsp://192.168.x.x/..."/></label>
      <div className="split"><label>Usuario<input value={draft.username || ''} onChange={e => onDraft({ ...draft, username: e.target.value })}/></label><label>Contraseña<input type="password" value={draft.password || ''} onChange={e => onDraft({ ...draft, password: e.target.value })} placeholder={draft.hasPassword ? 'Guardada · deja vacío para conservar' : 'Opcional'}/></label></div>
      <label>Workplace<select value={draft.workplaceId || workplaceId} onChange={e => onDraft({ ...draft, workplaceId: e.target.value })}>{workplaces.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select></label>
      <div className="split"><label>Salida<select value={draft.displayKind || 'source'} onChange={e => onDraft({ ...draft, displayKind: e.target.value as 'source' | 'composition', itemId: '' })}><option value="source">Fuente</option><option value="composition">Composición</option></select></label><label>Contenido<select value={draft.itemId || ''} onChange={e => { const value = content.find(x => idOf(x) === e.target.value); onDraft({ ...draft, itemId: e.target.value, itemLabel: labelOf(value) }) }}><option value="">Selecciona…</option>{content.map(value => <option key={idOf(value)} value={idOf(value)}>{labelOf(value)}</option>)}</select></label></div>
      <div className="split"><label>Duración<input type="number" min="1" value={draft.durationSec || 15} onChange={e => onDraft({ ...draft, durationSec: Number(e.target.value) })}/></label><label>Cooldown<input type="number" min="0" value={draft.cooldownSec || 0} onChange={e => onDraft({ ...draft, cooldownSec: Number(e.target.value) })}/></label></div>
      <div className="split"><label>Detección<select value={draft.detectionMode || 'manual'} onChange={e => onDraft({ ...draft, detectionMode: e.target.value as 'manual' | 'frame_diff' })}><option value="manual">Manual / prueba</option><option value="frame_diff">Movimiento (frame diff)</option></select></label><label>Área mínima<input type="number" min="1" value={draft.minArea || 2500} onChange={e => onDraft({ ...draft, minArea: Number(e.target.value) })}/></label></div>
      <label className="check"><input type="checkbox" checked={draft.enabled} onChange={e => onDraft({ ...draft, enabled: e.target.checked })}/> Regla habilitada</label>
      <div className="controls"><button className="primary" onClick={() => void onSave()}>Guardar</button>{draft.id && <button onClick={async () => { try { await api.testCameraRule(draft.id!); await onRuntime() } catch (e: any) { onError(e.message) } }}>Probar evento</button>}{draft.id && <button className="danger" onClick={async () => { await api.deleteCameraRule(draft.id!); onSelect(''); onDraft(emptyCamera(workplaceId)); await onRefresh() }}>Eliminar</button>}</div>
    </section>
  </div>
}

function ManualPanel({ workplaceId, compositions, sources, externalSources, onError }: { workplaceId: string; compositions: any[]; sources: any[]; externalSources: ExternalSource[]; onError: (message: string) => void }) {
  return <section className="panel"><h2>Control manual</h2><p>Todas las acciones utilizan el mismo coordinador exclusivo del wall.</p><div className="manualGrid three"><div><h3>Composiciones</h3>{compositions.map(item => <button key={idOf(item)} onClick={() => api.applyItem(workplaceId, { kind: 'composition', id: idOf(item), label: labelOf(item) }).catch(e => onError(e.message))}>{labelOf(item)}</button>)}</div><div><h3>Fuentes CTRL</h3>{sources.map(item => <button key={idOf(item)} onClick={() => api.applyItem(workplaceId, { kind: 'source', id: idOf(item), label: labelOf(item) }).catch(e => onError(e.message))}>{labelOf(item)}</button>)}</div><div><h3>Internet</h3>{externalSources.map(item => <button key={item.id} onClick={() => item.id && api.showExternalSource(item.id, workplaceId).catch(e => onError(e.message))}>{item.name}</button>)}</div></div><button className="danger clearWall" onClick={() => api.clear(workplaceId).catch(e => onError(e.message))}>Limpiar wall</button></section>
}

function Adder({ label, values, onAdd }: { label: string; values: any[]; onAdd: (id: string) => void }) {
  const [value, setValue] = useState('')
  return <div className="adder"><select value={value} onChange={e => setValue(e.target.value)}><option value="">{label}…</option>{values.map(item => <option key={idOf(item)} value={idOf(item)}>{labelOf(item)}</option>)}</select><button disabled={!value} onClick={() => { if (value) { onAdd(value); setValue('') } }}>+</button></div>
}

function LogList({ title, logs }: { title: string; logs: LogEntry[] }) {
  return <div className="logBlock"><h3>{title}</h3>{logs.length ? logs.slice(0, 80).map((log, index) => <div className={`log ${log.level}`} key={`${log.ts}-${index}`}><time>{new Date(log.ts * 1000).toLocaleTimeString()}</time><span>{log.message}</span></div>) : <div className="empty">Sin eventos.</div>}</div>
}
