import { useEffect, useMemo, useState } from 'react'
import { api, type DiscoveryResult, type RendererConfig, type SystemConfig } from '../api'
import { defaultRenderer, idOf, labelOf, looksLikeVnc } from '../helpers'

export default function SetupWizard({ onConfigured }: { onConfigured: () => void }) {
  const [draft, setDraft] = useState<SystemConfig | null>(null)
  const [browsers, setBrowsers] = useState<Array<{ name: string; path: string }>>([])
  const [inventory, setInventory] = useState<DiscoveryResult | null>(null)
  const [ctrlUser, setCtrlUser] = useState('')
  const [ctrlPassword, setCtrlPassword] = useState('')
  const [busy, setBusy] = useState(false)
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

  const sortedSources = useMemo(() => {
    const values = [...(inventory?.sources || [])]
    return values.sort((a, b) => Number(looksLikeVnc(b)) - Number(looksLikeVnc(a)))
  }, [inventory])

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

  function applyInventory(result: DiscoveryResult, preferredWorkplaceId = '') {
    setInventory(result)
    const selectedId = preferredWorkplaceId || result.selectedWorkplaceId || idOf(result.workplaces[0])
    const selected = result.workplaces.find(w => idOf(w) === selectedId)
    if (selectedId) {
      setDraft(current => {
        if (!current) return current
        const existing = current.workplaces[0] || workplace
        const currentRenderer = current.renderers[0] || defaultRenderer()
        const vncCandidates = result.sources.filter(source => looksLikeVnc(source))
        const detectedRenderer = !currentRenderer.barco_source_id && vncCandidates.length === 1
          ? { ...currentRenderer, barco_source_id: idOf(vncCandidates[0]), barco_source_label: labelOf(vncCandidates[0]) }
          : currentRenderer
        return {
          ...current,
          workplaces: [{ ...existing, id: selectedId, name: labelOf(selected) || existing.name }],
          renderers: [detectedRenderer, ...current.renderers.slice(1)],
        }
      })
    }
    const warnings = result.warnings?.length ? ` Advertencias: ${result.warnings.join(' | ')}` : ''
    setMessage(`Detectados ${result.workplaces.length} workplace(s), ${result.sources.length} fuente(s) y ${result.compositions.length} composición(es).${warnings}`)
  }

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

  async function discover(workplaceId = '') {
    setError('')
    setMessage('')
    setBusy(true)
    try {
      const result = await api.discoverSetup(draft, ctrlUser, ctrlPassword, workplaceId)
      applyInventory(result, workplaceId)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  async function chooseWorkplace(workplaceId: string) {
    const selected = inventory?.workplaces.find(w => idOf(w) === workplaceId)
    setWorkplace({ id: workplaceId, name: labelOf(selected) })
    await discover(workplaceId)
  }

  async function save() {
    setError('')
    if (!workplace.id) {
      setError('Selecciona o escribe el ID del workplace principal.')
      return
    }
    try {
      await api.saveSetup(draft)
      setCtrlPassword('')
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
          <p>Conecta CTRL, detecta el wall y selecciona el renderer sin copiar IDs manualmente.</p>
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
          <div className="split">
            <label>Usuario CTRL
              <input value={ctrlUser} onChange={e => setCtrlUser(e.target.value)} autoComplete="username" placeholder="Solo para detectar"/>
            </label>
            <label>Contraseña CTRL
              <input type="password" value={ctrlPassword} onChange={e => setCtrlPassword(e.target.value)} autoComplete="current-password" placeholder="No se guarda"/>
            </label>
          </div>
          <p className="help">Estas credenciales se usan únicamente para consultar el inventario durante la instalación y no se guardan en config.yaml.</p>
          <div className="controls compactControls">
            <button onClick={testServer}>Probar OIDC</button>
            <button className="primary" disabled={busy} onClick={() => discover()}>{busy ? 'Detectando…' : 'Conectar y detectar CTRL'}</button>
          </div>
        </section>

        <section>
          <h3>2. Workplace principal</h3>
          {inventory?.workplaces.length ? <label>Workplace detectado
            <select value={workplace.id} onChange={e => chooseWorkplace(e.target.value)}>
              <option value="">Selecciona…</option>
              {inventory.workplaces.map(w => <option key={idOf(w)} value={idOf(w)}>{labelOf(w)}</option>)}
            </select>
          </label> : <>
            <label>Nombre<input value={workplace.name} onChange={e => setWorkplace({ name: e.target.value })}/></label>
            <label>ID del workplace<input value={workplace.id} onChange={e => setWorkplace({ id: e.target.value })} placeholder="Se completa automáticamente al detectar"/></label>
          </>}
          <div className="quad">
            <label>X<input type="number" value={workplace.geometry?.x || 0} onChange={e => setWorkplace({ geometry: { ...workplace.geometry!, x: Number(e.target.value) } })}/></label>
            <label>Y<input type="number" value={workplace.geometry?.y || 0} onChange={e => setWorkplace({ geometry: { ...workplace.geometry!, y: Number(e.target.value) } })}/></label>
            <label>Ancho<input type="number" value={workplace.geometry?.width || 1920} onChange={e => setWorkplace({ geometry: { ...workplace.geometry!, width: Number(e.target.value) } })}/></label>
            <label>Alto<input type="number" value={workplace.geometry?.height || 1080} onChange={e => setWorkplace({ geometry: { ...workplace.geometry!, height: Number(e.target.value) } })}/></label>
          </div>
        </section>

        <section>
          <h3>3. Renderer sin Gateway</h3>
          <p className="help">El PC abre la web, imagen o video; CTRL recibe esa pantalla mediante una fuente VNC.</p>
          {sortedSources.length ? <label>Fuente del PC renderer en CTRL
            <select value={renderer.barco_source_id} onChange={e => {
              const selected = sortedSources.find(s => idOf(s) === e.target.value)
              setRenderer({ barco_source_id: e.target.value, barco_source_label: labelOf(selected) })
            }}>
              <option value="">Selecciona la fuente VNC…</option>
              {sortedSources.map(source => <option key={idOf(source)} value={idOf(source)}>{labelOf(source)}{looksLikeVnc(source) ? ' · VNC' : ''}</option>)}
            </select>
          </label> : <label>ID de fuente VNC en CTRL
            <input value={renderer.barco_source_id} onChange={e => setRenderer({ barco_source_id: e.target.value })} placeholder="Se completa automáticamente al detectar"/>
          </label>}
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
        <button className="primary" onClick={save}>Guardar y continuar</button>
      </div>
    </div>
  </div>
}
