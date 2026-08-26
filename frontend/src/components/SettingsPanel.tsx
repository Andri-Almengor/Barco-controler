import { useEffect, useState } from 'react'
import { api, type RendererConfig, type SystemConfig } from '../api'
import { defaultRenderer, idOf, labelOf } from '../helpers'

export default function SettingsPanel({
  config, sources, onSaved, onError,
}: {
  config: SystemConfig
  sources: any[]
  onSaved: () => void
  onError: (message: string) => void
}) {
  const [draft, setDraft] = useState<SystemConfig>(JSON.parse(JSON.stringify(config)))
  const [browsers, setBrowsers] = useState<Array<{ name: string; path: string }>>([])

  useEffect(() => {
    api.setupBrowsers().then(setBrowsers).catch(() => {})
  }, [])

  const renderer = draft.renderers[0] || defaultRenderer()
  const setRenderer = (patch: Partial<RendererConfig>) => setDraft({
    ...draft,
    renderers: [{ ...renderer, ...patch }, ...draft.renderers.slice(1)],
  })

  return <section className="panel settingsPanel">
    <div className="panelHead">
      <div><h2>Configuración del sistema</h2><p>IPs, OIDC y renderer quedan configurables sin cambiar el código.</p></div>
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
      </div>

      <div>
        <h3>Renderer Internet</h3>
        <label>Fuente VNC de Barco
          <select value={renderer.barco_source_id} onChange={e => {
            const selected = sources.find(s => idOf(s) === e.target.value)
            setRenderer({ barco_source_id: e.target.value, barco_source_label: labelOf(selected) })
          }}>
            <option value="">Selecciona una fuente VNC…</option>
            {sources.map(s => <option key={idOf(s)} value={idOf(s)}>{labelOf(s)}</option>)}
          </select>
        </label>
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
  </section>
}
