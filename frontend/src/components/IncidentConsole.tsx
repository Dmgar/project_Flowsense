import { useCallback, useEffect, useState } from 'react';
import {
  analyzeIncidentCandidate, clearIncident, dismissIncidentCandidate,
  fetchIncidentCandidates, fetchIncidentResponseMetrics, validateIncidentCandidate,
  type IncidentCandidate, type IncidentResponseMetrics, createFloodReport, fetchFloodReports, reviewFloodReport,
} from '../api/client';
import { useStore } from '../store/useStore';

const DEMOS = [
  { type: 'collision', name: 'Colisión', icon: '🚗', lat: 40.7508, lon: -73.9892, conf: 0.91, frames: 9, stopped: 38, drop: 72, classes: ['car', 'truck', 'car'] },
  { type: 'stopped_vehicle', name: 'Vehículo detenido', icon: '🚙', lat: 40.7448, lon: -73.9821, conf: 0.83, frames: 8, stopped: 52, drop: 48, classes: ['car'] },
  { type: 'road_obstruction', name: 'Vía obstruida', icon: '🚧', lat: 40.7613, lon: -73.9764, conf: 0.87, frames: 7, stopped: 0, drop: 64, classes: ['truck', 'car'] },
  { type: 'smoke_fire', name: 'Humo / incendio', icon: '🔥', lat: 40.7359, lon: -73.9783, conf: 0.89, frames: 8, stopped: 0, drop: 55, classes: ['smoke', 'car'] },
];
const CARTAGENA_DEMOS = [
  { type: 'collision', name: 'Colisión · Centro', icon: '🚗', lat: 10.3910, lon: -75.4794, conf: 0.91, frames: 9, stopped: 38, drop: 72, classes: ['car', 'truck', 'car'] },
  { type: 'stopped_vehicle', name: 'Vehículo detenido', icon: '🚙', lat: 10.4006, lon: -75.5041, conf: 0.83, frames: 8, stopped: 52, drop: 48, classes: ['car'] },
  { type: 'road_obstruction', name: 'Vía obstruida', icon: '🚧', lat: 10.4180, lon: -75.5515, conf: 0.87, frames: 7, stopped: 0, drop: 64, classes: ['truck', 'car'] },
  { type: 'smoke_fire', name: 'Humo / incendio', icon: '🔥', lat: 10.3950, lon: -75.4900, conf: 0.89, frames: 8, stopped: 0, drop: 55, classes: ['smoke', 'car'] },
];
const FLOOD_DEMOS = [
  { label: 'Agua 20 cm · Centro', depth: 20, lat: 10.3910, lon: -75.4794 },
  { label: 'Agua 40 cm · Zaragocilla', depth: 40, lat: 10.4006, lon: -75.5041 },
];

const STATUS: Record<IncidentCandidate['status'], string> = {
  pending_review: 'Requiere verificación', validated: 'Validado · afecta rutas',
  false_alarm: 'Descartado', cleared: 'Vía despejada',
};

export function IncidentConsole() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<IncidentCandidate[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [metrics, setMetrics] = useState<IncidentResponseMetrics | null>(null);
  const [floods, setFloods] = useState<Awaited<ReturnType<typeof fetchFloodReports>>>([]);
  const setIncidentPoints = useStore((state) => state.setIncidentPoints);
  const setFloodMapPoints = useStore((state) => state.setFloodReports);
  const graphStatus = useStore((state) => state.graphStatus);
  const demos = graphStatus?.city_profile === 'manhattan' ? DEMOS : CARTAGENA_DEMOS;

  const refresh = useCallback(async () => {
    try {
      const [candidates, floodReports] = await Promise.all([fetchIncidentCandidates(), fetchFloodReports()]);
      setItems(candidates);
      setFloods(floodReports);
      setFloodMapPoints(floodReports);
      setMetrics(await fetchIncidentResponseMetrics());
      setIncidentPoints(candidates.filter((item) => item.status === 'pending_review' || item.status === 'validated').map((item) => ({
        incident_id: item.incident_id, label: item.label, status: item.status,
        confidence: item.confidence, latitude: item.latitude, longitude: item.longitude,
      })));
    } catch { /* backend availability is shown elsewhere */ }
  }, [setIncidentPoints, setFloodMapPoints]);
  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 10000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const runDemo = async (scenario: typeof CARTAGENA_DEMOS[number]) => {
    setBusy(true); setMessage('Analizando señales…');
    try {
      await analyzeIncidentCandidate({
        latitude: scenario.lat, longitude: scenario.lon, event_type: scenario.type,
        model_confidence: scenario.conf, corroborating_frames: scenario.frames,
        stationary_seconds: scenario.stopped, speed_drop_pct: scenario.drop,
        detected_classes: scenario.classes, camera_id: `CAM-DEMO-${graphStatus?.city_profile === 'manhattan' ? 'MANHATTAN' : 'CARTAGENA'}`, demo: true,
      });
      setMessage('Candidato creado. Revisa la evidencia antes de afectar las rutas.');
      await refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'No se pudo analizar el evento.'); }
    finally { setBusy(false); }
  };

  const runFloodDemo = async (scenario: typeof FLOOD_DEMOS[number]) => {
    setBusy(true); setMessage('Creando reporte de profundidad de agua simulado…');
    try {
      await createFloodReport({ latitude: scenario.lat, longitude: scenario.lon, depth_cm: scenario.depth,
        radius_m: 220, source: 'SIMULACIÓN · reporte manual', note: 'Escenario sintético para probar el desvío.', demo: true });
      setMessage('Reporte DEMO pendiente. Confírmalo para que el motor evite ese tramo.');
      await refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'No se pudo crear el reporte.'); }
    finally { setBusy(false); }
  };

  const actFlood = async (id: string, action: 'confirm' | 'dismiss' | 'clear') => {
    setBusy(true);
    try {
      await reviewFloodReport(id, action);
      setMessage(action === 'confirm' ? 'Profundidad confirmada; el ruteo evitará esa zona hasta que venza.' : action === 'clear' ? 'Inundación despejada; el corredor vuelve a ser elegible.' : 'Reporte descartado.');
      await refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'No se pudo actualizar el reporte.'); }
    finally { setBusy(false); }
  };

  const act = async (candidate: IncidentCandidate, action: 'validate' | 'dismiss' | 'clear') => {
    setBusy(true); setMessage('Actualizando incidente…');
    try {
      if (action === 'validate') await validateIncidentCandidate(candidate.incident_id);
      else if (action === 'dismiss') await dismissIncidentCandidate(candidate.incident_id);
      else await clearIncident(candidate.incident_id);
      setMessage(action === 'validate' ? 'Incidente validado y vías afectadas en el grafo.' : action === 'dismiss' ? 'Alerta descartada como falso positivo.' : 'Incidente despejado; el grafo restauró las vías.');
      await refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'No se pudo actualizar.'); }
    finally { setBusy(false); }
  };

  const pending = items.filter((item) => item.status === 'pending_review').length + floods.filter((item) => item.status === 'pending_review').length;
  return <>
    <button className="incident-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
      <span>◉</span> Inteligencia vial {pending > 0 && <b>{pending}</b>}
    </button>
    {open && <aside className="incident-console">
      <header className="incident-console-header">
        <div><small>FLOWSENSE · TRIAGE MULTIFUENTE</small><h2>Incidentes en tiempo real</h2></div>
        <button onClick={() => setOpen(false)} aria-label="Cerrar">×</button>
      </header>
      <p className="incident-intro">Clasifica eventos de cámara con persistencia y caída de velocidad. Una persona valida antes de modificar rutas.</p>
      <div className="incident-demo-label">PROBAR ESCENARIO DEMO · evidencia sintética</div>
      <div className="incident-demo-grid">
        {demos.map((demo) => <button key={demo.type} disabled={busy} onClick={() => void runDemo(demo)}><span>{demo.icon}</span>{demo.name}</button>)}
      </div>
      <div className="incident-demo-label">INUNDACIÓN · PROFUNDIDAD REPORTADA · DEMO</div>
      <div className="incident-demo-grid">{FLOOD_DEMOS.map((demo) => <button key={demo.label} disabled={busy} onClick={() => void runFloodDemo(demo)}><span>🌊</span>{demo.label}</button>)}</div>
      <div className="incident-kpis">
        <div><b>{metrics?.verified_count ?? '—'}</b><span>VERIFICADOS</span></div>
        <div><b>{metrics?.median_verify_seconds == null ? '—' : `${metrics.median_verify_seconds}s`}</b><span>MEDIANA A VERIFICAR</span></div>
        <div><b>{metrics?.false_alarm_rate_pct == null ? '—' : `${metrics.false_alarm_rate_pct}%`}</b><span>FALSAS ALARMAS</span></div>
        <div><b>{metrics?.active_confirmed_flood_count ?? '—'}</b><span>INUNDACIONES ACTIVAS</span></div>
      </div>
      <a className="incident-feed-link" href="/api/v1/traffic/feeds/cifs?format=json" target="_blank" rel="noreferrer">
        ⇩ Descargar feed CIFS · {metrics?.published_feed_count ?? 0} incidentes activos
      </a>
      <p className="incident-feed-note">Formato compatible con Waze Partner Feed. Incluye incidentes y profundidades de inundación confirmadas; excluye demos y reportes vencidos. Publicarlo requiere cuenta y aprobación de la agencia.</p>
      {message && <div className="incident-message" role="status">{message}</div>}
      <div className="incident-list-heading"><strong>COLA DE VERIFICACIÓN</strong><button onClick={() => void refresh()}>ACTUALIZAR</button></div>
      <div className="incident-list">
        {items.length === 0 && <p className="incident-empty">Sin candidatos. Prueba un escenario demo o conecta una fuente de percepción.</p>}
        {items.map((item) => <article className="incident-card" key={item.incident_id}>
          <div className="incident-card-top"><strong>{item.label}</strong><span className={`incident-state ${item.status}`}>{STATUS[item.status]}</span></div>
          <div className="incident-score"><span>Score de evidencia</span><b>{Math.round(item.confidence * 100)}%</b><i><em style={{ width: `${Math.round(item.confidence * 100)}%` }} /></i></div>
          <ul>{item.rationale.map((line, i) => <li key={i}>{line}</li>)}</ul>
          <div className="incident-meta">{item.camera_id} · urgencia {item.urgency} · {new Date(item.created_at).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}</div>
          {item.status === 'pending_review' && <div className="incident-actions"><button disabled={busy} onClick={() => void act(item, 'validate')}>Validar y afectar el grafo</button><button disabled={busy} onClick={() => void act(item, 'dismiss')}>Falso positivo</button></div>}
          {item.status === 'validated' && <div className="incident-actions"><span>{item.affected_edges_count} tramos afectados</span><button disabled={busy} onClick={() => void act(item, 'clear')}>Marcar despejado</button></div>}
        </article>)}
      </div>
      <div className="incident-list-heading"><strong>OBSERVACIONES DE AGUA</strong><span>{floods.filter((r) => r.status === 'confirmed').length} activas</span></div>
      <div className="incident-list">
        {floods.length === 0 && <p className="incident-empty">Sin observaciones de agua. Los reportes pendientes no afectan las rutas.</p>}
        {floods.map((report) => <article className="incident-card flood-card" key={report.report_id}>
          <div className="incident-card-top"><strong>{report.demo ? 'DEMO · ' : ''}{report.depth_cm} cm de agua</strong><span className={`incident-state ${report.status === 'confirmed' ? 'validated' : report.status}`}>{report.status === 'confirmed' ? 'Confirmado · cierre activo' : report.status === 'pending_review' ? 'Pendiente de revisión' : report.status}</span></div>
          <div className="incident-meta">Radio {report.radius_m} m · origen {report.source} · vence {new Date(report.expires_at).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}</div>
          {report.note && <p>{report.note}</p>}
          {report.status === 'pending_review' && <div className="incident-actions"><button disabled={busy} onClick={() => void actFlood(report.report_id, 'confirm')}>Confirmar y desviar</button><button disabled={busy} onClick={() => void actFlood(report.report_id, 'dismiss')}>Descartar</button></div>}
          {report.status === 'confirmed' && <div className="incident-actions"><span>Enrutamiento cierra tramos por encima de {graphStatus?.city_profile ? '0 cm configurados para la flota' : 'el límite de la flota'}</span><button disabled={busy} onClick={() => void actFlood(report.report_id, 'clear')}>Despejar</button></div>}
        </article>)}
      </div>
      <footer className="incident-disclaimer">El score ordena evidencia; no representa una probabilidad calibrada ni confirma por sí mismo un incidente.</footer>
    </aside>}
  </>;
}
