import { useEffect, useState, type FormEvent } from 'react'
import { api, CameraRule, CameraStatus, LogEntry, Route, RouteItem, RouteRuntime, Workplace } from './api'

type Tab = 'routes' | 'cameras' | 'manual' | 'logs'

const emptyCamera = (workplaceId = ''): CameraRule => ({
  name: 'Nueva cámara', enabled: true, workplaceId, displayKind: 'source', itemId: '', itemLabel: '', rtspUrl: '', username: '', password: '',
  priority: 1, durationSec: 15, cooldownSec: 20, scheduleStart: '00:00', scheduleEnd: '23:59', enabledHoursOnly: false,
  detectionMode: 'manual', minArea: 2500,
})

const labelOf = (value: any) => String(value?.name || value?.title || value?.label || value?.id || value?._id || 'Sin nombre')
const idOf = (value: any) => String(value?.id || value?._id || '')
const fmt = (ts?: number) => ts ? new Date(ts * 1000).toLocaleTimeString() : '—'

export default function App() {
  const [auth, setAuth] = useState(false)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [tab, setTab] = useState<Tab>('routes')
  const [workplaces, setWorkplaces] = useState<Workplace[]>([])
  const [workplaceId, setWorkplaceId] = useState('')
  const [compositions, setCompositions] = useState<any[]>([])
  const [sources, setSources] = useState<any[]>([])
  const [routes, setRoutes] = useState<Route[]>([])
  const [routeId, setRouteId] = useState('')
  const [runtimes, setRuntimes] = useState<RouteRuntime[]>([])
  const [cameraRules, setCameraRules] = useState<CameraRule[]>([])
  const [cameraId, setCameraId] = useState('')
  const [cameraDraft, setCameraDraft] = useState<CameraRule>(emptyCamera())
  const [cameraStatus, setCameraStatus] = useState<CameraStatus | null>(null)
  const [routeLogs, setRouteLogs] = useState<LogEntry[]>([])

  const activeRoute = routes.find(r => r.id === routeId)
  const activeRuntime = runtimes.find(r => r.routeId === routeId)
  const activeCamera = cameraRules.find(r => r.id === cameraId)

  useEffect(() => {
    api.authStatus().then(s => setAuth(s.authenticated)).catch(() => setAuth(false))
  }, [])

  useEffect(() => {
    const expired = () => setAuth(false)
    window.addEventListener('barco-auth-expired', expired)
    return () => window.removeEventListener('barco-auth-expired', expired)
  }, [])

  useEffect(() => {
    if (!auth) return
    refreshBase()
    const timer = window.setInterval(refreshRuntime, 1000)
    return () => window.clearInterval(timer)
  }, [auth])

  useEffect(() => {
    if (!auth || !workplaceId) return
    Promise.all([api.compositions(), api.sources(workplaceId)]).then(([c, s]) => { setCompositions(c); setSources(s) }).catch(e => setError(e.message))
  }, [auth, workplaceId])

  useEffect(() => {
    if (activeCamera) setCameraDraft({ ...activeCamera, password: '' })
  }, [cameraId, activeCamera?.updatedAt])

  async function refreshBase() {
    try {
      const [wps, rs, cr] = await Promise.all([api.workplaces(), api.routes(), api.cameraRules()])
      setWorkplaces(wps); setRoutes(rs); setCameraRules(cr)
      setWorkplaceId(current => current || wps[0]?.id || '')
      setRouteId(current => current || rs[0]?.id || '')
      setCameraId(current => current || cr[0]?.id || '')
      await refreshRuntime()
    } catch (e: any) { setError(e.message) }
  }

  async function refreshRuntime() {
    try {
      const [rr, cs, logs] = await Promise.all([api.routeRuntimes(), api.cameraStatus(), api.routeLogs()])
      setRuntimes(rr); setCameraStatus(cs); setRouteLogs(logs)
    } catch { }
  }

  async function login(e: FormEvent) {
    e.preventDefault(); setError('')
    try { await api.login(username, password); setPassword(''); setAuth(true) }
    catch (e: any) { setError(e.message) }
  }

  async function saveRoute(patch: Partial<Route>) {
    try {
      const response = await api.saveRoute({ ...(activeRoute || { name: `Recorrido ${routes.length + 1}`, intervalSec: 30, workplaceId, items: [] }), ...patch })
      await refreshBase(); setRouteId(response.route.id)
    } catch (e: any) { setError(e.message) }
  }

  async function command(action: 'start'|'stop'|'pause'|'resume') {
    if (!routeId) return
    try {
      if (action === 'start') await api.startRoute(routeId)
      if (action === 'stop') await api.stopRoute(routeId)
      if (action === 'pause') await api.pauseRoute(routeId)
      if (action === 'resume') await api.resumeRoute(routeId)
      await refreshRuntime()
    } catch (e: any) { setError(e.message) }
  }

  function addItem(kind: RouteItem['kind'], id: string) {
    if (!activeRoute || !id) return
    const source = kind === 'source' ? sources.find(x => idOf(x) === id) : compositions.find(x => idOf(x) === id)
    saveRoute({ items: [...activeRoute.items, { kind, id, label: labelOf(source) }] })
  }

  async function saveCamera() {
    try {
      const result = await api.saveCameraRule(cameraDraft)
      await refreshBase(); setCameraId(result.rule.id || '')
    } catch (e: any) { setError(e.message) }
  }

  if (!auth) return <div className="login"><form className="loginCard" onSubmit={login}><div className="productMark">BC</div><h1>Barco Controller</h1><p>Control seguro de recorridos y eventos del video wall.</p><label>Usuario CTRL<input value={username} onChange={e => setUsername(e.target.value)} autoComplete="username" /></label><label>Contraseña<input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" /></label>{error && <div className="alert error">{error}</div>}<button className="primary" type="submit">Conectar</button></form></div>

  return <div className="appShell">
    <header><div className="brand"><span className="productMark small">BC</span><div><strong>Barco Controller</strong><small>Control plane</small></div></div><div className="headerStatus"><span className={cameraStatus?.running ? 'dot ok' : 'dot'}></span>{cameraStatus?.running ? 'Cámaras activas' : 'Cámaras detenidas'}<button className="ghost" onClick={async()=>{await api.logout(); setAuth(false)}}>Salir</button></div></header>
    <div className="layout">
      <aside>
        <div className="sectionLabel">Workplace</div>
        <select value={workplaceId} onChange={e => setWorkplaceId(e.target.value)}>{workplaces.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select>
        <nav>{([['routes','Recorridos'],['cameras','Cámaras'],['manual','Control manual'],['logs','Actividad']] as [Tab,string][]).map(([id,label])=><button key={id} className={tab===id?'active':''} onClick={()=>setTab(id)}>{label}</button>)}</nav>
      </aside>
      <main>
        {error && <div className="alert error dismiss">{error}<button onClick={()=>setError('')}>×</button></div>}
        {tab === 'routes' && <div className="twoCol">
          <section className="panel"><div className="panelHead"><div><h2>Recorridos</h2><p>La ejecución ocurre en el servidor.</p></div><button onClick={()=>saveRoute({ id: undefined, name:`Recorrido ${routes.length+1}`, workplaceId, items:[] })}>Nuevo</button></div><div className="list">{routes.map(r=><button key={r.id} className={routeId===r.id?'selected':''} onClick={()=>setRouteId(r.id)}><strong>{r.name}</strong><span>{r.items.length} elementos · {r.intervalSec}s</span></button>)}</div></section>
          <section className="panel">{activeRoute ? <><div className="runtimeBar"><span className={`state ${activeRuntime?.state || 'stopped'}`}>{activeRuntime?.state || 'stopped'}</span><span>Siguiente: {activeRuntime?.nextRunAt ? fmt(activeRuntime.nextRunAt) : '—'}</span></div><label>Nombre<input value={activeRoute.name} onChange={e=>saveRoute({name:e.target.value})}/></label><label>Intervalo (s)<input type="number" min="3" value={activeRoute.intervalSec} onChange={e=>saveRoute({intervalSec:Number(e.target.value)})}/></label><div className="controls"><button className="primary" onClick={()=>command('start')}>Iniciar</button><button onClick={()=>command('pause')}>Pausar</button><button onClick={()=>command('resume')}>Reanudar</button><button className="danger" onClick={()=>command('stop')}>Detener + limpiar</button></div><div className="divider"/><h3>Secuencia</h3><div className="items">{activeRoute.items.map((item,i)=><div className="item" key={`${item.kind}-${item.id}-${i}`}><span className="badge">{item.kind}</span><span>{item.label || item.id}</span><button onClick={()=>saveRoute({items:activeRoute.items.filter((_,x)=>x!==i)})}>×</button></div>)}</div><Adder label="Agregar composición" values={compositions} onAdd={id=>addItem('composition',id)}/><Adder label="Agregar fuente" values={sources} onAdd={id=>addItem('source',id)}/></> : <div className="empty">Crea o selecciona un recorrido.</div>}</section>
        </div>}
        {tab === 'cameras' && <div className="twoCol">
          <section className="panel"><div className="panelHead"><div><h2>Cámaras</h2><p>Se pueden configurar N reglas.</p></div><button onClick={()=>{setCameraId('');setCameraDraft(emptyCamera(workplaceId))}}>Nueva</button></div><div className="engineControls"><button className="primary" onClick={async()=>{await api.startCameras();refreshRuntime()}}>Iniciar motor</button><button className="danger" onClick={async()=>{await api.stopCameras();refreshRuntime()}}>Detener motor</button></div><div className="list">{cameraRules.map(r=><button key={r.id} className={cameraId===r.id?'selected':''} onClick={()=>setCameraId(r.id||'')}><strong>{r.name}</strong><span>{r.detectionMode} · {r.durationSec}s {r.hasPassword?'· credencial guardada':''}</span></button>)}</div></section>
          <section className="panel cameraForm"><div className="runtimeBar"><span className={cameraDraft.enabled?'state running':'state stopped'}>{cameraDraft.enabled?'habilitada':'deshabilitada'}</span>{cameraStatus?.activeEvent && <span>Activa: {cameraStatus.activeEvent.ruleName}</span>}</div><label>Nombre<input value={cameraDraft.name} onChange={e=>setCameraDraft({...cameraDraft,name:e.target.value})}/></label><label>RTSP<input value={cameraDraft.rtspUrl||''} onChange={e=>setCameraDraft({...cameraDraft,rtspUrl:e.target.value})} placeholder="rtsp://192.168.x.x/..."/></label><div className="split"><label>Usuario<input value={cameraDraft.username||''} onChange={e=>setCameraDraft({...cameraDraft,username:e.target.value})}/></label><label>Contraseña<input type="password" value={cameraDraft.password||''} onChange={e=>setCameraDraft({...cameraDraft,password:e.target.value})} placeholder={cameraDraft.hasPassword?'Guardada · deja vacío para conservar':'Opcional'}/></label></div><label>Workplace<select value={cameraDraft.workplaceId||workplaceId} onChange={e=>setCameraDraft({...cameraDraft,workplaceId:e.target.value})}>{workplaces.map(w=><option key={w.id} value={w.id}>{w.name}</option>)}</select></label><div className="split"><label>Salida<select value={cameraDraft.displayKind||'source'} onChange={e=>setCameraDraft({...cameraDraft,displayKind:e.target.value as any,itemId:''})}><option value="source">Fuente</option><option value="composition">Composición</option></select></label><label>Contenido<select value={cameraDraft.itemId||''} onChange={e=>{const arr=cameraDraft.displayKind==='composition'?compositions:sources;const v=arr.find(x=>idOf(x)===e.target.value);setCameraDraft({...cameraDraft,itemId:e.target.value,itemLabel:labelOf(v)})}}><option value="">Selecciona…</option>{(cameraDraft.displayKind==='composition'?compositions:sources).map(v=><option key={idOf(v)} value={idOf(v)}>{labelOf(v)}</option>)}</select></label></div><div className="split"><label>Duración<input type="number" min="1" value={cameraDraft.durationSec||15} onChange={e=>setCameraDraft({...cameraDraft,durationSec:Number(e.target.value)})}/></label><label>Cooldown<input type="number" min="0" value={cameraDraft.cooldownSec||0} onChange={e=>setCameraDraft({...cameraDraft,cooldownSec:Number(e.target.value)})}/></label></div><div className="split"><label>Detección<select value={cameraDraft.detectionMode||'manual'} onChange={e=>setCameraDraft({...cameraDraft,detectionMode:e.target.value as any})}><option value="manual">Manual / prueba</option><option value="frame_diff">Movimiento (frame diff)</option></select></label><label>Área mínima<input type="number" min="1" value={cameraDraft.minArea||2500} onChange={e=>setCameraDraft({...cameraDraft,minArea:Number(e.target.value)})}/></label></div><label className="check"><input type="checkbox" checked={cameraDraft.enabled} onChange={e=>setCameraDraft({...cameraDraft,enabled:e.target.checked})}/> Regla habilitada</label><div className="controls"><button className="primary" onClick={saveCamera}>Guardar</button>{cameraDraft.id && <button onClick={async()=>{await api.testCameraRule(cameraDraft.id!);refreshRuntime()}}>Probar evento</button>}{cameraDraft.id && <button className="danger" onClick={async()=>{await api.deleteCameraRule(cameraDraft.id!);setCameraId('');setCameraDraft(emptyCamera(workplaceId));refreshBase()}}>Eliminar</button>}</div></section>
        </div>}
        {tab === 'manual' && <section className="panel"><h2>Control manual</h2><p>Estas acciones usan el mismo coordinador exclusivo que recorridos y cámaras.</p><div className="manualGrid"><div><h3>Composiciones</h3>{compositions.map(c=><button key={idOf(c)} onClick={()=>api.applyItem(workplaceId,{kind:'composition',id:idOf(c),label:labelOf(c)}).catch(e=>setError(e.message))}>{labelOf(c)}</button>)}</div><div><h3>Fuentes</h3>{sources.map(s=><button key={idOf(s)} onClick={()=>api.applyItem(workplaceId,{kind:'source',id:idOf(s),label:labelOf(s)}).catch(e=>setError(e.message))}>{labelOf(s)}</button>)}</div></div><button className="danger clearWall" onClick={()=>api.clear(workplaceId).catch(e=>setError(e.message))}>Limpiar wall</button></section>}
        {tab === 'logs' && <section className="panel"><h2>Actividad</h2><LogList title="Recorridos" logs={routeLogs}/><LogList title="Motor de cámaras" logs={cameraStatus?.logs||[]}/></section>}
      </main>
    </div>
  </div>
}

function Adder({label,values,onAdd}:{label:string;values:any[];onAdd:(id:string)=>void}) {
  const [value,setValue]=useState('')
  return <div className="adder"><select value={value} onChange={e=>setValue(e.target.value)}><option value="">{label}…</option>{values.map(v=><option key={idOf(v)} value={idOf(v)}>{labelOf(v)}</option>)}</select><button disabled={!value} onClick={()=>{onAdd(value);setValue('')}}>+</button></div>
}

function LogList({title,logs}:{title:string;logs:LogEntry[]}) {
  return <div className="logBlock"><h3>{title}</h3>{logs.length===0?<div className="empty">Sin actividad.</div>:logs.map((l,i)=><div className={`log ${l.level}`} key={i}><time>{fmt(l.ts)}</time><span>{l.message}</span></div>)}</div>
}
