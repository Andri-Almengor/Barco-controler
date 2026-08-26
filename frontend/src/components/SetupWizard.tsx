import { useEffect, useState } from 'react'
import { api, type RendererConfig, type SystemConfig } from '../api'
import { defaultRenderer } from '../helpers'

export default function SetupWizard({ onConfigured }: { onConfigured: () => void }) {
  const [draft, setDraft] = useState<SystemConfig | null>(null)
  const [browsers, setBrowsers] = useState<Array<{ name: string; path: string }>>([])
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    Promise.all([api.setupConfig(), api.setupBrowsers()])
      .then(([cfg, detected]) => {
        setDraft(cfg)
        setBrowsers(detected)
      })
      .catch(e => setError(e.message))
  }, [])

  if (!draft) {
    return <div className="splash"><div className="spinner"/><p>{error || 'Preparando asistente…'}</p></div>
  }

  const workplace = draft.workplaces[0] || {
    id: '',
    name: 'Wall principal',
    geometry: { type: 'px', x: 0, y: 0, width: 3840, height: 2160 },
  }
  const renderer = draft.renderers[0] || defaultRenderer()
  const setWorkplace = (patch: any) => setDraft({ ...draft, workplaces: [{ ...workplace, ...patch }] })
  const setRenderer = (patch: Partial<RendererConfig>) => setDraft({ ...draft, renderers: [{ ...renderer, ...patch }] })

  async function testServer() {
    setError('')
    setMessage('')
    try {
      const result = await api.testSetup(draft)
      setMessage(`Conexión OIDC correcta: ${result.issuer || 'servidor encontrado'}`)
    } catch (e: any) {
      setError(e.message)
    }
  }

  async function save() {
    setError('')
    try {
      await api.saveSetup(draft)
      onConfigured()
    } catch (e: any) {
      setError(e.message)
    }
  }

  return <div className="setupPage">
    <div className="setupCard">
      <div className="setupHero">
        <div className="productMark">BC</div>
        <div>
          <span className="eyebrow">Primera ejecución</span>
          <h1>Configurar Barco Controller</h1>
          <p>La configuración queda guardada localmente. No necesitas editar archivos YAML.</p>
        </div>
      </div>

      {error && <div className="alert error">{error}</div>}
      {message && <div className="alert success">{message}</div>}

      <div className="setupGrid">
        <section>
          <h3>1. Servidor CTRL</h3>
          <label>Dirección CTRL
            <input value={draft.barco.base_url} onChange={e => setDraft({ ...draft, barco: { ...draft.barco, base_url: e.target.value } })} placeholder="https://192.168.68.200"/>
          </label>
          <div className="split">
            <label>API base
              <input value={draft.barco.api_base} onChange={e => setDraft({ ...draft, barco: { ...draft.barco, api_base: e.target.value } })}/>
            </label>
            <label>Realm OIDC
              <input value={draft.barco.oidc.realm} onChange={e => setDraft({ ...draft, barco: { ...draft.barco, oidc: { ...draft.barco.oidc, realm: e.target.value } } })}/>
            </label>
          </div>
          <div className="split">
            <label>Client ID
              <input value={draft.barco.oidc.client_id} onChange={e => setDraft({ ...draft, barco: { ...draft.barco, oidc: { ...draft.barco.oidc, client_id: e.target.value } } })}/>
            </label>
            <label className="check setupCheck">
              <input type="checkbox" checked={draft.barco.tls.verify_tls} onChange={e => setDraft({ ...draft, barco: { ...draft.barco, tls: { verify_tls: e.target.checked } } })}/>
              Validar certificado TLS
            </label>
          </div>
        </section>

        <section>
          <h3>2. Workplace principal</h3>
          <label>Nombre<input value={workplace.name} onChange={e => setWorkplace({ name: e.target.value })}/></label>
          <label>ID del workplace<input value={workplace.id} onChange={e => setWorkplace({ id: e.target.value })} placeholder="ID de CTRL"/></label>
          <div className="quad">
            <label>X<input type="number" value={workplace.geometry?.x || 0} onChange={e => setWorkplace({ geometry: { ...workplace.geometry!, x: Number(e.target.value) } })}/></label>
            <label>Y<input type="number" value={workplace.geometry?.y || 0} onChange={e => setWorkplace({ geometry: { ...workplace.geometry!, y: Number(e.target.value) } })}/></label>
            <label>Ancho<input type="number" value={workplace.geometry?.width || 1920} onChange={e => setWorkplace({ geometry: { ...workplace.geometry!, width: Number(e.target.value) } })}/></label>
            <label>Alto<input type="number" value={workplace.geometry?.height || 1080} onChange={e => setWorkplace({ geometry: { ...workplace.geometry!, height: Number(e.target.value) } })}/></label>
          </div>
        </section>

        <section>
          <h3>3. Renderer sin Gateway</h3>
          <p className="help">El PC abre el contenido y CTRL recibe su pantalla por una fuente VNC.</p>
          <label>ID de fuente VNC en CTRL
            <input value={renderer.barco_source_id} onChange={e => setRenderer({ barco_source_id: e.target.value })} placeholder="Puede configurarse más tarde"/>
          </label>
          <label>Navegador
            <select value={renderer.browser_path} onChange={e => setRenderer({ browser_path: e.target.value })}>
              <option value="">Detectar automáticamente</option>
              {browsers.map(b => <option key={b.path} value={b.path}>{b.name} — {b.path}</option>)}
            </select>
          </label>
          <div className="split">
            <label>Modo
              <select value={renderer.launch_mode} onChange={e => setRenderer({ launch_mode: e.target.value as RendererConfig['launch_mode'] })}>
                <option value="kiosk">Kiosk</option>
                <option value="fullscreen">Pantalla completa</option>
                <option value="app">Ventana App</option>
              </select>
            </label>
            <label>Espera inicial (s)
              <input type="number" step="0.5" min="0" value={renderer.startup_delay_sec} onChange={e => setRenderer({ startup_delay_sec: Number(e.target.value) })}/>
            </label>
          </div>
        </section>

        <section>
          <h3>4. Servicio local</h3>
          <div className="split">
            <label>Host<input value={draft.server.host} onChange={e => setDraft({ ...draft, server: { ...draft.server, host: e.target.value } })}/></label>
            <label>Puerto<input type="number" value={draft.server.port} onChange={e => setDraft({ ...draft, server: { ...draft.server, port: Number(e.target.value) } })}/></label>
          </div>
          <p className="help">Cambiar host o puerto requiere reiniciar Barco Controller después de guardar.</p>
        </section>
      </div>

      <div className="setupActions">
        <button onClick={testServer}>Probar servidor</button>
        <button className="primary" onClick={save}>Guardar y continuar</button>
      </div>
    </div>
  </div>
}
