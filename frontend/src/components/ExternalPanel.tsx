import { useEffect, useState } from 'react'
import { api, type ExternalSource, type ExternalType, type RendererConfig, type RendererStatus } from '../api'

const emptyExternal = (rendererId = 'main'): ExternalSource => ({
  name: 'Nuevo contenido', type: 'web', url: 'https://', rendererId, enabled: true,
})

export default function ExternalPanel({
  items, renderers, workplaceId, onRefresh, onError,
}: {
  items: ExternalSource[]
  renderers: RendererConfig[]
  workplaceId: string
  onRefresh: () => Promise<void>
  onError: (message: string) => void
}) {
  const [selectedId, setSelectedId] = useState('')
  const selected = items.find(item => item.id === selectedId)
  const [draft, setDraft] = useState<ExternalSource>(emptyExternal(renderers[0]?.id || 'main'))
  const [status, setStatus] = useState<RendererStatus | null>(null)

  useEffect(() => {
    if (!selectedId && items[0]?.id) setSelectedId(items[0].id)
  }, [items, selectedId])
  useEffect(() => { if (selected) setDraft({ ...selected }) }, [selected?.updatedAt, selectedId])
  useEffect(() => { api.rendererStatus().then(setStatus).catch(() => {}) }, [items])

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

  return <div className="twoCol">
    <section className="panel">
      <div className="panelHead">
        <div><h2>Contenido de Internet</h2><p>Páginas, imágenes y videos renderizados localmente, sin Barco Gateway.</p></div>
        <button onClick={() => { setSelectedId(''); setDraft(emptyExternal(renderers[0]?.id || 'main')) }}>Nuevo</button>
      </div>
      <div className="infoBox"><strong>Cómo funciona</strong><span>El PC abre el enlace y CTRL muestra la fuente VNC asociada al renderer.</span></div>
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
        <div><strong>{renderer.rendererId}</strong><span>{renderer.sourceName} · PID {renderer.pid}</span></div>
        <button onClick={async () => { await api.stopRenderer(renderer.rendererId); await refreshStatus() }}>Cerrar navegador</button>
      </div>) : <div className="empty">No hay contenido abierto.</div>}
    </section>
  </div>
}
