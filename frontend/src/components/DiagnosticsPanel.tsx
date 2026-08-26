import { useEffect, useState } from 'react'
import { api, type DiagnosticsResult, type SystemConfig } from '../api'

export default function DiagnosticsPanel({ config, onError }: { config: SystemConfig; onError: (message: string) => void }) {
  const [data, setData] = useState<DiagnosticsResult | null>(null)
  const [busy, setBusy] = useState(false)

  async function refresh() {
    setBusy(true)
    try {
      setData(await api.diagnostics())
      onError('')
    } catch (e: any) {
      onError(e.message)
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => { void refresh() }, [])

  const renderer = config.renderers[0]
  return <div className="diagnosticsPage">
    <div className="panelHead">
      <div>
        <h2>Diagnóstico</h2>
        <p>Comprueba la cadena completa: Controller → CTRL → workplace → renderer → VNC → Internet.</p>
      </div>
      <button className="primary" disabled={busy} onClick={refresh}>{busy ? 'Comprobando…' : 'Volver a comprobar'}</button>
    </div>

    {data && <div className={data.ready ? 'readiness ready' : 'readiness notReady'}>
      <strong>{data.ready ? 'Sistema listo para operar' : 'Hay elementos pendientes'}</strong>
      <span>{data.ready ? 'Los componentes críticos respondieron correctamente.' : 'Revisa las tarjetas marcadas en rojo o amarillo.'}</span>
    </div>}

    <div className="diagnosticGrid">
      {(data?.checks || []).map(check => <article key={check.id} className={`diagnosticCard ${check.status}`}>
        <div className="diagnosticHead"><span className={`healthDot ${check.status}`}/><strong>{check.label}</strong><span className="healthLabel">{check.status}</span></div>
        <p>{check.detail}</p>
      </article>)}
    </div>

    <section className="vncHelp">
      <h3>Servidor VNC del renderer</h3>
      <p>Barco Controller espera un servidor RFB en <strong>{renderer?.vnc_host || '127.0.0.1'}:{renderer?.vnc_port || 5900}</strong>. Para este proyecto se recomienda TightVNC configurado como fuente de solo visualización.</p>
      {data?.vnc?.product && <div className="infoBox"><strong>{data.vnc.product} detectado</strong><span>{data.vnc.executable || ''}{data.vnc.serviceRunning ? ' · servicio activo' : ''}</span></div>}
      {!data?.vnc?.reachable && data?.install?.supported && <div className="installBox">
        <strong>VNC no está respondiendo.</strong>
        <span>En el PC del renderer abre PowerShell como Administrador y ejecuta:</span>
        <code>{data.install.command}</code>
        <small>El script instala TightVNC si hace falta, desactiva acceso HTTP y transferencia de archivos, bloquea entrada remota y limita el firewall a la red local.</small>
      </div>}
    </section>
  </div>
}
