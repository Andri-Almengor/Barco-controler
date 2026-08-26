import { useEffect, useMemo, useState } from 'react'
import { api, type RendererConfig, type SystemConfig } from '../api'
import { defaultRenderer, idOf, labelOf, looksLikeVnc } from '../helpers'
import DiagnosticsPanel from './DiagnosticsPanel'

export default function SettingsPanel({
  config, sources, onSaved, onError,
}: {
  config: SystemConfig
  sources: any[]
  onSaved: () => void
  onError: (message: string) => void
}) {
  const [page, setPage] = useState<'settings' | 'diagnostics'>('settings')
  const [draft, setDraft] = useState<SystemConfig>(JSON.parse(JSON.stringify(config)))
  const [browsers, setBrowsers] = useState<Array<{ name: string; path: string }>>([])
  const [detectedWorkplaces, setDetectedWorkplaces] = useState<any[]>(config.workplaces || [])
  const [detectedSources, setDetectedSources] = useState<any[]>(sources)
  const [ctrlUser, setCtrlUser] = useState('')
  const [ctrlPassword, setCtrlPassword] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api.setupBrowsers().then(setBrowsers).catch(() => {})
  }, [])
  useEffect(() => setDetectedSources(sources), [sources])

  const renderer = draft.renderers[0] || defaultRenderer()
  const workplace = draft.workplaces[0] || { id: '', name: 'Wall principal', geometry: { type: 'px', x: 0, y: 0, width: 1920, height: 1080 } }
  const sortedSources = useMemo(() => [...detectedSources].sort((a, b) => Number(looksLikeVnc(b)) - Number(looksLikeVnc(a))), [detectedSources])

  const setRenderer = (patch: Partial<RendererConfig>) => setDraft({
    ...draft,
    renderers: [{ ...renderer, ...patch }, ...draft.renderers.slice(1)],
  })
  const setWorkplace = (patch: any) => setDraft({ ...draft, workplaces: [{ ...workplace, ...patch }, ...draft.workplaces.slice(1)] })

  async function discover(workplaceId = workplace.id) {
    onError('')
    const serverChanged = draft.barco.base_url.trim().replace(/\/$/, '') !== config.barco.base_url.trim().replace(/\/$/, '')
    if (serverChanged && (!ctrlUser || !ctrlPassword)) {
      onError('Cambiaste el servidor CTRL. Escribe usuario y contraseña temporalmente para detectar el inventario del nuevo servidor.')
      return
    }
    setBusy(true)
    try {
      const result = await api.discoverSetup(draft, ctrlUser, ctrlPassword, workplaceId)
      setDetectedWorkplaces(result.workplaces)
      setDetectedSources(result.sources)
      const selectedId = workplaceId || result.selectedWorkplaceId || idOf(result.workplaces[0])
      const selected = result.workplaces.find(w => idOf(w) === selectedId)
      if (selectedId) setWorkplace({ id: selectedId, name: labelOf(selected) })
      if (result.warnings?.length) onError(result.warnings.join(' | '))
      setCtrlPassword('')
    } catch (e: any) {
      onError(e.message)
    } finally {
      setBusy(false)
    }
  }

  async function chooseWorkplace(id: string) {
    const selected = detectedWorkplaces.find(w => idOf(w) === id)
    setWorkplace({ id, name: labelOf(selected) })
    await discover(id)
  }

  return <section className="panel settingsPanel">
    <div className="settingsTabs">
      <button className={page === 'settings' ? 'active' : ''} onClick={() => setPage('settings')}>Configuración</button>
      <button className={page === 'diagnostics' ? 'active' : ''} onClick={() => setPage('diagnostics')}>Diagnóstico</button>
    </div>

    {page === 'diagnostics' ? <DiagnosticsPanel config={draft} onError={onError}/> : <>
      <div className="panelHead">
        <div><h2>Configuración del sistema</h2><p>Servidor, workplace, VNC y renderer se pueden redetectar sin editar archivos.</p></div>
      </div>
      <div className="settingsGrid">
        <div>
          <h3>Barco CTRL</h3>
          <label>Servidor<input value={draft.barco.base_url} onChange={e => setDraft({ ...draft, barco: { ...draft.barco, base_url: e.target.value } })}/></label>
          <div className="split">
            <label>Realm<input value={draft.barco.oidc.realm} onChange={e => setDraft({ ...draft, barco: { ...draft.barco, oidc: { ...draft.barco.oidc, realm: e.target.value } } })}/></label>
            <label>Client ID<input value={draft.barco.oidc.client_id} onChange={e => setDraft({ ...draft, barco: { ...draft.barco, oidc: { ...draft.barco.oidc, client_id: e.target.value } } })}/></label>
          </div>
          <label className="check"><input type="checkbox" checked={draft.barco.tls.verify_tls} onChange={e => setDraft({ ...draft, barco: { ...draft.barco, tls: { verify_tls: e.target.checked } } })}/> Validar certificado TLS</label>
          <div className="split">
            <label>Usuario temporal<input value={ctrlUser} onChange={e => setCtrlUser(e.target.value)} placeholder="Solo si cambias de servidor"/></label>
            <label>Contraseña temporal<input type="password" value={ctrlPassword} onChange={e => setCtrlPassword(e.target.value)} placeholder="No se guarda"/></label>
          </div>
          <button disabled={busy} onClick={() => discover()}>{busy ? 'Detectando…' : 'Detectar inventario de CTRL'}</button>
        </div>

        <div>
          <h3>Workplace</h3>
          {detectedWorkplaces.length ? <label>Workplace principal
            <select value={workplace.id} onChange={e => chooseWorkplace(e.target.value)}>
              <option value="">Selecciona…</option>
              {detectedWorkplaces.map(w => <option key={idOf(w)} value={idOf(w)}>{labelOf(w)}</option>)}
            </select>
          </label> : <>
            <label>Nombre<input value={workplace.name} onChange={e => setWorkplace({ name: e.target.value })}/></label>
            <label>ID<input value={workplace.id} onChange={e => setWorkplace({ id: e.target.value })}/></label>
          </>}
          <div className="quad">
            <label>X<input type="number" value={workplace.geometry?.x || 0} onChange={e => setWorkplace({ geometry: { ...workplace.geometry!, x: Number(e.target.value) } })}/></label>
            <label>Y<input type="number" value={workplace.geometry?.y || 0} onChange={e => setWorkplace({ geometry: { ...workplace.geometry!, y: Number(e.target.value) } })}/></label>
            <label>Ancho<input type="number" value={workplace.geometry?.width || 1920} onChange={e => setWorkplace({ geometry: { ...workplace.geometry!, width: Number(e.target.value) } })}/></label>
            <label>Alto<input type="number" value={workplace.geometry?.height || 1080} onChange={e => setWorkplace({ geometry: { ...workplace.geometry!, height: Number(e.target.value) } })}/></label>
          </div>
        </div>

        <div>
          <h3>Renderer Internet</h3>
          <label>Fuente del PC renderer en CTRL
            <select value={renderer.barco_source_id} onChange={e => {
              const selected = sortedSources.find(s => idOf(s) === e.target.value)
              setRenderer({ barco_source_id: e.target.value, barco_source_label: labelOf(selected) })
            }}>
              <option value="">Selecciona una fuente VNC…</option>
              {sortedSources.map(s => <option key={idOf(s)} value={idOf(s)}>{labelOf(s)}{looksLikeVnc(s) ? ' · VNC' : ''}</option>)}
            </select>
          </label>
          <div className="split">
            <label>Host VNC<input value={renderer.vnc_host || '127.0.0.1'} onChange={e => setRenderer({ vnc_host: e.target.value })}/></label>
            <label>Puerto VNC<input type="number" min="1" max="65535" value={renderer.vnc_port || 5900} onChange={e => setRenderer({ vnc_port: Number(e.target.value) })}/></label>
          </div>
          <label>Navegador
            <select value={renderer.browser_path} onChange={e => setRenderer({ browser_path: e.target.value })}>
              <option value="">Detectar automáticamente</option>
              {browsers.map(b => <option key={b.path} value={b.path}>{b.name}</option>)}
            </select>
          </label>
          <div className="split">
            <label>Modo
              <select value={renderer.launch_mode} onChange={e => setRenderer({ launch_mode: e.target.value as RendererConfig['launch_mode'] })}>
                <option value="kiosk">Kiosk</option><option value="fullscreen">Fullscreen</option><option value="app">App</option>
              </select>
            </label>
            <label>Espera (s)<input type="number" step="0.5" value={renderer.startup_delay_sec} onChange={e => setRenderer({ startup_delay_sec: Number(e.target.value) })}/></label>
          </div>
        </div>

        <div>
          <h3>Servidor local</h3>
          <div className="split">
            <label>Host<input value={draft.server.host} onChange={e => setDraft({ ...draft, server: { ...draft.server, host: e.target.value } })}/></label>
            <label>Puerto<input type="number" value={draft.server.port} onChange={e => setDraft({ ...draft, server: { ...draft.server, port: Number(e.target.value) } })}/></label>
          </div>
          <p className="help">Host/puerto se aplican al próximo reinicio.</p>
        </div>
      </div>

      <div className="controls">
        <button onClick={async () => { try { await api.testSetup(draft); onError('') } catch (e: any) { onError(e.message) } }}>Probar CTRL</button>
        <button className="primary" onClick={async () => { try { await api.saveSetup(draft); onSaved() } catch (e: any) { onError(e.message) } }}>Guardar configuración</button>
      </div>
    </>}
  </section>
}
