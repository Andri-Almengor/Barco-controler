import { useEffect, useMemo, useState } from 'react'
import {
  api, type ExternalSource, type ExternalType, type Geometry, type LayoutKind,
  type MixedLayout, type RendererConfig, type RendererStatus,
} from '../api'

const emptyExternal = (rendererId = 'main'): ExternalSource => ({
  name: 'Nuevo contenido', type: 'web', url: 'https://', rendererId, enabled: true,
})

const emptyLayout = (workplaceId = ''): MixedLayout => ({
  name: 'Nueva composición mixta', workplaceId, items: [],
})

function idOf(value: any): string {
  return String(value?.id ?? value?.sourceId ?? value?.compositionId ?? '')
}

function labelOf(value: any): string {
  return String(value?.name ?? value?.label ?? value?.title ?? idOf(value))
}

export default function ExternalPanel({
  items, renderers, workplaceId, onRefresh, onError,
}: {
  items: ExternalSource[]
  renderers: RendererConfig[]
  workplaceId: string
  onRefresh: () => Promise<void>
  onError: (message: string) => void
}) {
  const [view, setView] = useState<'content' | 'layouts'>('content')
  const [selectedId, setSelectedId] = useState('')
  const selected = items.find(item => item.id === selectedId)
  const [draft, setDraft] = useState<ExternalSource>(emptyExternal(renderers[0]?.id || 'main'))
  const [status, setStatus] = useState<RendererStatus | null>(null)

  const [layouts, setLayouts] = useState<MixedLayout[]>([])
  const [layoutId, setLayoutId] = useState('')
  const activeLayout = layouts.find(layout => layout.id === layoutId)
  const [layoutDraft, setLayoutDraft] = useState<MixedLayout>(emptyLayout(workplaceId))
  const [sources, setSources] = useState<any[]>([])
  const [compositions, setCompositions] = useState<any[]>([])
  const [wallGeometry, setWallGeometry] = useState<Geometry>({ type: 'px', x: 0, y: 0, width: 1920, height: 1080 })

  useEffect(() => {
    if (!selectedId && items[0]?.id) setSelectedId(items[0].id)
  }, [items, selectedId])
  useEffect(() => { if (selected) setDraft({ ...selected }) }, [selected?.updatedAt, selectedId])
  useEffect(() => { api.rendererStatus().then(setStatus).catch(() => {}) }, [items])

  useEffect(() => {
    if (!workplaceId) return
    Promise.all([api.layouts(), api.sources(workplaceId), api.compositions(), api.publicConfig()])
      .then(([nextLayouts, nextSources, nextCompositions, config]) => {
        setLayouts(nextLayouts)
        setSources(nextSources)
        setCompositions(nextCompositions)
        const workplace = config.workplaces.find(value => value.id === workplaceId)
        if (workplace?.geometry) setWallGeometry(workplace.geometry)
        setLayoutId(current => current || nextLayouts[0]?.id || '')
      })
      .catch(e => onError(e.message))
  }, [workplaceId])

  useEffect(() => {
    if (activeLayout) setLayoutDraft({ ...activeLayout, items: activeLayout.items.map(item => ({ ...item, geometry: { ...item.geometry } })) })
  }, [layoutId, activeLayout?.updatedAt])

  const rendererWarnings = useMemo(() => {
    const used = new Map<string, number>()
    for (const item of layoutDraft.items) {
      if (item.kind !== 'external') continue
      const external = items.find(value => value.id === item.id)
      const rendererId = external?.rendererId || 'main'
      used.set(rendererId, (used.get(rendererId) || 0) + 1)
    }
    return [...used.entries()].filter(([, count]) => count > 1).map(([rendererId]) => rendererId)
  }, [layoutDraft.items, items])

  async function save() {
    try {
      const result = await api.saveExternalSource(draft)
      await onRefresh()
      setSelectedId(result.source.id || '')
    } catch (e: any) { onError(e.message) }
  }

  async function refreshStatus() {
    try { setStatus(await api.rendererStatus()) } catch { }
  }

  async function refreshLayouts(preferredId = '') {
    try {
      const next = await api.layouts()
      setLayouts(next)
      setLayoutId(preferredId || next[0]?.id || '')
    } catch (e: any) { onError(e.message) }
  }

  async function saveLayout() {
    try {
      const result = await api.saveLayout({ ...layoutDraft, workplaceId })
      await refreshLayouts(result.layout.id || '')
    } catch (e: any) { onError(e.message) }
  }

  function addLayoutItem(kind: LayoutKind, id: string) {
    if (!id) return
    const collection = kind === 'source' ? sources : kind === 'composition' ? compositions : items
    const found = collection.find(value => idOf(value) === id)
    const width = Math.max(1, Math.floor(wallGeometry.width / 2))
    const height = Math.max(1, Math.floor(wallGeometry.height / 2))
    const index = layoutDraft.items.length
    const geometry: Geometry = {
      type: 'px',
      x: index % 2 === 0 ? 0 : width,
      y: Math.floor(index / 2) * height,
      width,
      height,
    }
    setLayoutDraft({
      ...layoutDraft,
      items: [...layoutDraft.items, { kind, id, label: labelOf(found), geometry }],
    })
  }

  function updateGeometry(index: number, key: keyof Geometry, value: string | number) {
    setLayoutDraft({
      ...layoutDraft,
      items: layoutDraft.items.map((item, itemIndex) => itemIndex === index ? {
        ...item,
        geometry: { ...item.geometry, [key]: key === 'type' ? String(value) : Number(value) },
      } : item),
    })
  }

  return <div className="externalModule">
    <div className="moduleTabs">
      <button className={view === 'content' ? 'active' : ''} onClick={() => setView('content')}>Contenido de Internet</button>
      <button className={view === 'layouts' ? 'active' : ''} onClick={() => setView('layouts')}>Composiciones mixtas</button>
    </div>

    {view === 'content' ? <div className="twoCol">
      <section className="panel">
        <div className="panelHead">
          <div><h2>Contenido de Internet</h2><p>Páginas, imágenes y videos renderizados localmente, sin Barco Gateway.</p></div>
          <button onClick={() => { setSelectedId(''); setDraft(emptyExternal(renderers[0]?.id || 'main')) }}>Nuevo</button>
        </div>
        <div className="infoBox"><strong>Cómo funciona</strong><span>El PC abre el enlace a pantalla completa y CTRL muestra la fuente VNC asociada al renderer.</span></div>
        <div className="list">
          {items.map(item => <button key={item.id} className={selectedId === item.id ? 'selected' : ''} onClick={() => setSelectedId(item.id || '')}>
            <strong>{item.name}</strong><span>{item.type} · {item.rendererId}</span>
          </button>)}
        </div>
      </section>

      <section className="panel">
        <div className="runtimeBar">
          <span className={draft.enabled ? 'state running' : 'state stopped'}>{draft.enabled ? 'habilitado' : 'deshabilitado'}</span>
          <span>{status?.active.map(a => a.sourceName).filter(Boolean).join(', ') || 'Renderer libre'}</span>
        </div>
        <label>Nombre<input value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })}/></label>
        <div className="split">
          <label>Tipo
            <select value={draft.type} onChange={e => setDraft({ ...draft, type: e.target.value as ExternalType })}>
              <option value="web">Página web</option><option value="image">Imagen</option><option value="video">Video directo</option>
            </select>
          </label>
          <label>Renderer
            <select value={draft.rendererId} onChange={e => setDraft({ ...draft, rendererId: e.target.value })}>
              {renderers.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </label>
        </div>
        <label>URL<input value={draft.url} onChange={e => setDraft({ ...draft, url: e.target.value })} placeholder="https://..."/></label>
        <label className="check"><input type="checkbox" checked={draft.enabled} onChange={e => setDraft({ ...draft, enabled: e.target.checked })}/> Contenido habilitado</label>
        <div className="controls">
          <button className="primary" onClick={save}>Guardar</button>
          {draft.id && <button onClick={async () => { try { await api.prepareExternalSource(draft.id!); await refreshStatus() } catch (e: any) { onError(e.message) } }}>Abrir en renderer</button>}
          {draft.id && workplaceId && <button onClick={async () => { try { await api.showExternalSource(draft.id!, workplaceId); await refreshStatus() } catch (e: any) { onError(e.message) } }}>Mostrar en wall</button>}
          {draft.id && <button className="danger" onClick={async () => { await api.deleteExternalSource(draft.id!); setSelectedId(''); setDraft(emptyExternal(renderers[0]?.id || 'main')); await onRefresh() }}>Eliminar</button>}
        </div>

        <div className="divider"/>
        <h3>Estado de renderers</h3>
        {status?.active.length ? status.active.map(renderer => <div className="rendererRow" key={renderer.rendererId}>
          <div><strong>{renderer.rendererId}</strong><span>{renderer.sourceName} · PID {renderer.pid} · {renderer.foregroundReady === false ? 'ventana no confirmada' : 'ventana al frente'}</span></div>
          <button onClick={async () => { await api.stopRenderer(renderer.rendererId); await refreshStatus() }}>Cerrar navegador</button>
        </div>) : <div className="empty">No hay contenido abierto.</div>}
      </section>
    </div> : <div className="twoCol">
      <section className="panel">
        <div className="panelHead">
          <div><h2>Composiciones mixtas</h2><p>Combina fuentes CTRL, composiciones CTRL y contenido de Internet usando posiciones y tamaños propios.</p></div>
          <button onClick={() => { setLayoutId(''); setLayoutDraft(emptyLayout(workplaceId)) }}>Nueva</button>
        </div>
        <div className="infoBox"><strong>Regla del renderer</strong><span>Cada renderer VNC puede mostrar un solo contenido externo distinto a la vez. Para dos webs simultáneas necesitas dos renderers/VNC.</span></div>
        <div className="list">
          {layouts.map(layout => <button key={layout.id} className={layoutId === layout.id ? 'selected' : ''} onClick={() => setLayoutId(layout.id || '')}>
            <strong>{layout.name}</strong><span>{layout.items.length} elementos</span>
          </button>)}
        </div>
      </section>

      <section className="panel layoutEditor">
        <div className="runtimeBar"><span className="state running">Workplace</span><span>{wallGeometry.width} × {wallGeometry.height}px</span></div>
        <label>Nombre<input value={layoutDraft.name} onChange={e => setLayoutDraft({ ...layoutDraft, name: e.target.value })}/></label>

        {rendererWarnings.length > 0 && <div className="alert error">El mismo renderer está usado más de una vez: {rendererWarnings.join(', ')}. Se necesita un renderer VNC diferente por cada contenido externo simultáneo.</div>}

        <div className="layoutCanvas" style={{ aspectRatio: `${Math.max(1, wallGeometry.width)} / ${Math.max(1, wallGeometry.height)}` }}>
          {layoutDraft.items.map((item, index) => {
            const g = item.geometry
            const left = ((g.x - (wallGeometry.x || 0)) / Math.max(1, wallGeometry.width)) * 100
            const top = ((g.y - (wallGeometry.y || 0)) / Math.max(1, wallGeometry.height)) * 100
            const width = (g.width / Math.max(1, wallGeometry.width)) * 100
            const height = (g.height / Math.max(1, wallGeometry.height)) * 100
            return <div key={`${item.kind}-${item.id}-${index}`} className={`layoutBlock ${item.kind}`} style={{ left: `${left}%`, top: `${top}%`, width: `${width}%`, height: `${height}%` }}>
              <strong>{item.label || item.id}</strong><span>{item.kind}</span>
            </div>
          })}
        </div>

        <div className="layoutItems">
          {layoutDraft.items.map((item, index) => <div className="layoutItem" key={`${item.kind}-${item.id}-${index}`}>
            <div className="layoutItemHead"><span className={`badge ${item.kind}`}>{item.kind}</span><strong>{item.label || item.id}</strong><button onClick={() => setLayoutDraft({ ...layoutDraft, items: layoutDraft.items.filter((_, i) => i !== index) })}>×</button></div>
            <div className="geometryGrid">
              <label>X<input type="number" value={item.geometry.x} onChange={e => updateGeometry(index, 'x', e.target.value)}/></label>
              <label>Y<input type="number" value={item.geometry.y} onChange={e => updateGeometry(index, 'y', e.target.value)}/></label>
              <label>Ancho<input type="number" min="1" value={item.geometry.width} onChange={e => updateGeometry(index, 'width', e.target.value)}/></label>
              <label>Alto<input type="number" min="1" value={item.geometry.height} onChange={e => updateGeometry(index, 'height', e.target.value)}/></label>
            </div>
          </div>)}
        </div>

        <div className="divider"/>
        <h3>Agregar elementos</h3>
        <LayoutAdder label="Fuente CTRL" values={sources} onAdd={id => addLayoutItem('source', id)}/>
        <LayoutAdder label="Composición CTRL" values={compositions} onAdd={id => addLayoutItem('composition', id)}/>
        <LayoutAdder label="Contenido de Internet" values={items} onAdd={id => addLayoutItem('external', id)}/>

        <div className="controls layoutActions">
          <button className="primary" onClick={saveLayout}>Guardar composición</button>
          {layoutDraft.id && <button disabled={rendererWarnings.length > 0} onClick={async () => { try { await api.showLayout(layoutDraft.id!, workplaceId); await refreshStatus() } catch (e: any) { onError(e.message) } }}>Mostrar en wall</button>}
          {layoutDraft.id && <button className="danger" onClick={async () => { await api.deleteLayout(layoutDraft.id!); setLayoutDraft(emptyLayout(workplaceId)); await refreshLayouts() }}>Eliminar</button>}
        </div>
      </section>
    </div>}
  </div>
}

function LayoutAdder({ label, values, onAdd }: { label: string; values: any[]; onAdd: (id: string) => void }) {
  const [value, setValue] = useState('')
  return <div className="layoutAdder">
    <select value={value} onChange={e => setValue(e.target.value)}>
      <option value="">{label}…</option>
      {values.map(item => <option key={idOf(item)} value={idOf(item)}>{labelOf(item)}</option>)}
    </select>
    <button disabled={!value} onClick={() => { onAdd(value); setValue('') }}>Agregar</button>
  </div>
}
