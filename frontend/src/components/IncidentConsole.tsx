import { useCallback, useEffect, useState } from 'react';
import {
  analyzeIncidentCandidate, clearIncident, dismissIncidentCandidate,
  fetchIncidentCandidates, fetchIncidentResponseMetrics, validateIncidentCandidate,
  type IncidentCandidate, type IncidentResponseMetrics, createFloodReport, fetchFloodReports, reviewFloodReport,
} from '../api/client';
import { useStore } from '../store/useStore';

const DEMOS = [
  { type: 'collision', name: "Collision", icon: '🚗', lat: 40.7508, lon: -73.9892, conf: 0.91, frames: 9, stopped: 38, drop: 72, classes: ['car', 'truck', 'car'] },
  { type: 'stopped_vehicle', name: "Stopped vehicle", icon: '🚙', lat: 40.7448, lon: -73.9821, conf: 0.83, frames: 8, stopped: 52, drop: 48, classes: ['car'] },
  { type: 'road_obstruction', name: "Blocked road", icon: '🚧', lat: 40.7613, lon: -73.9764, conf: 0.87, frames: 7, stopped: 0, drop: 64, classes: ['truck', 'car'] },
  { type: 'smoke_fire', name: "Smoke / fire", icon: '🔥', lat: 40.7359, lon: -73.9783, conf: 0.89, frames: 8, stopped: 0, drop: 55, classes: ['smoke', 'car'] },
];
const CARTAGENA_DEMOS = [
  { type: 'collision', name: "Collision · Downtown", icon: '🚗', lat: 10.3910, lon: -75.4794, conf: 0.91, frames: 9, stopped: 38, drop: 72, classes: ['car', 'truck', 'car'] },
  { type: 'stopped_vehicle', name: "Stopped vehicle", icon: '🚙', lat: 10.4006, lon: -75.5041, conf: 0.83, frames: 8, stopped: 52, drop: 48, classes: ['car'] },
  { type: 'road_obstruction', name: "Blocked road", icon: '🚧', lat: 10.4180, lon: -75.5515, conf: 0.87, frames: 7, stopped: 0, drop: 64, classes: ['truck', 'car'] },
  { type: 'smoke_fire', name: "Smoke / fire", icon: '🔥', lat: 10.3950, lon: -75.4900, conf: 0.89, frames: 8, stopped: 0, drop: 55, classes: ['smoke', 'car'] },
];
const FLOOD_DEMOS = [
  { label: "Water 20 cm · Downtown", depth: 20, lat: 10.3910, lon: -75.4794 },
  { label: "Water 40 cm · Zaragocilla", depth: 40, lat: 10.4006, lon: -75.5041 },
];

const STATUS: Record<IncidentCandidate['status'], string> = {
  pending_review: "Verification required", validated: "Validated · affects routes",
  false_alarm: "Dismissed", cleared: "Road cleared",
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
    const initial = window.setTimeout(() => { void refresh(); }, 0);
    const timer = window.setInterval(() => { void refresh(); }, 10000);
    return () => { window.clearTimeout(initial); window.clearInterval(timer); };
  }, [refresh]);

  const runDemo = async (scenario: typeof CARTAGENA_DEMOS[number]) => {
    setBusy(true); setMessage("Analyzing signals…");
    try {
      await analyzeIncidentCandidate({
        latitude: scenario.lat, longitude: scenario.lon, event_type: scenario.type,
        model_confidence: scenario.conf, corroborating_frames: scenario.frames,
        stationary_seconds: scenario.stopped, speed_drop_pct: scenario.drop,
        detected_classes: scenario.classes, camera_id: `CAM-DEMO-${graphStatus?.city_profile === 'manhattan' ? 'MANHATTAN' : 'CARTAGENA'}`, demo: true,
      });
      setMessage("Candidate created. Review the evidence before affecting routes.");
      await refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not analyze the event."); }
    finally { setBusy(false); }
  };

  const runFloodDemo = async (scenario: typeof FLOOD_DEMOS[number]) => {
    setBusy(true); setMessage("Creating a simulated water depth report…");
    try {
      await createFloodReport({ latitude: scenario.lat, longitude: scenario.lon, depth_cm: scenario.depth,
        radius_m: 220, source: "SIMULATION · manual report", note: "Synthetic scenario for testing a detour.", demo: true });
      setMessage("DEMO report pending. Confirm it so the engine avoids that segment.");
      await refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not create the report."); }
    finally { setBusy(false); }
  };

  const actFlood = async (id: string, action: 'confirm' | 'dismiss' | 'clear') => {
    setBusy(true);
    try {
      await reviewFloodReport(id, action);
      setMessage(action === 'confirm' ? "Depth confirmed; routing will avoid this area until the report expires." : action === 'clear' ? "Flooding cleared; the corridor is eligible again." : "Report dismissed.");
      await refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not update the report."); }
    finally { setBusy(false); }
  };

  const act = async (candidate: IncidentCandidate, action: 'validate' | 'dismiss' | 'clear') => {
    setBusy(true); setMessage("Updating incident…");
    try {
      if (action === 'validate') await validateIncidentCandidate(candidate.incident_id);
      else if (action === 'dismiss') await dismissIncidentCandidate(candidate.incident_id);
      else await clearIncident(candidate.incident_id);
      setMessage(action === 'validate' ? "Incident validated and affected roads updated in the graph." : action === 'dismiss' ? "Alert dismissed as a false positive." : "Incident cleared; the graph restored the roads.");
      await refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not update."); }
    finally { setBusy(false); }
  };

  const pending = items.filter((item) => item.status === 'pending_review').length + floods.filter((item) => item.status === 'pending_review').length;
  return <>
    <button className="incident-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
      <span>◉</span>  Road intelligence {pending > 0 && <b>{pending}</b>}
    </button>
    {open && <aside className="incident-console">
      <header className="incident-console-header">
        <div><small>FLOWSENSE · MULTISOURCE TRIAGE</small><h2>Real-time incidents</h2></div>
        <button onClick={() => setOpen(false)} aria-label="Close">×</button>
      </header>
      <p className="incident-intro">Classify camera events using persistence and speed drops. A person validates them before routes are modified.</p>
      <div className="incident-demo-label">TRY A DEMO SCENARIO · synthetic evidence</div>
      <div className="incident-demo-grid">
        {demos.map((demo) => <button key={demo.type} disabled={busy} onClick={() => void runDemo(demo)}><span>{demo.icon}</span>{demo.name}</button>)}
      </div>
      <div className="incident-demo-label">FLOODING · REPORTED DEPTH · DEMO</div>
      <div className="incident-demo-grid">{FLOOD_DEMOS.map((demo) => <button key={demo.label} disabled={busy} onClick={() => void runFloodDemo(demo)}><span>🌊</span>{demo.label}</button>)}</div>
      <div className="incident-kpis">
        <div><b>{metrics?.verified_count ?? '—'}</b><span>VERIFIED</span></div>
        <div><b>{metrics?.median_verify_seconds == null ? '—' : `${metrics.median_verify_seconds}s`}</b><span>MEDIAN VERIFICATION TIME</span></div>
        <div><b>{metrics?.false_alarm_rate_pct == null ? '—' : `${metrics.false_alarm_rate_pct}%`}</b><span>FALSE ALARMS</span></div>
        <div><b>{metrics?.active_confirmed_flood_count ?? '—'}</b><span>ACTIVE FLOOD REPORTS</span></div>
      </div>
      <a className="incident-feed-link" href="/api/v1/traffic/feeds/cifs?format=json" target="_blank" rel="noreferrer">

        ⇩ Download CIFS feed · {metrics?.published_feed_count ?? 0}  active incidents
      </a>
      <p className="incident-feed-note">Waze Partner Feed compatible format. Includes confirmed incidents and flood depths; excludes demos and expired reports. Publishing requires an agency account and approval.</p>
      {message && <div className="incident-message" role="status">{message}</div>}
      <div className="incident-list-heading"><strong>VERIFICATION QUEUE</strong><button onClick={() => void refresh()}>REFRESH</button></div>
      <div className="incident-list">
        {items.length === 0 && <p className="incident-empty">No candidates. Try a demo scenario or connect a perception source.</p>}
        {items.map((item) => <article className="incident-card" key={item.incident_id}>
          <div className="incident-card-top"><strong>{item.label}</strong><span className={`incident-state ${item.status}`}>{STATUS[item.status]}</span></div>
          <div className="incident-score"><span>Evidence score</span><b>{Math.round(item.confidence * 100)}%</b><i><em style={{ width: `${Math.round(item.confidence * 100)}%` }} /></i></div>
          <ul>{item.rationale.map((line, i) => <li key={i}>{line}</li>)}</ul>
          <div className="incident-meta">{item.camera_id} · urgency {item.urgency === 'cr\u00edtica' ? 'critical' : item.urgency === 'alta' ? 'high' : 'pending assessment'} · {new Date(item.created_at).toLocaleTimeString("en-US", { hour: '2-digit', minute: '2-digit' })}</div>
          {item.status === 'pending_review' && <div className="incident-actions"><button disabled={busy} onClick={() => void act(item, 'validate')}>Validate and update the graph</button><button disabled={busy} onClick={() => void act(item, 'dismiss')}>False positive</button></div>}
          {item.status === 'validated' && <div className="incident-actions"><span>{item.affected_edges_count}  affected segments</span><button disabled={busy} onClick={() => void act(item, 'clear')}>Mark as cleared</button></div>}
        </article>)}
      </div>
      <div className="incident-list-heading"><strong>WATER OBSERVATIONS</strong><span>{floods.filter((r) => r.status === 'confirmed').length}  active</span></div>
      <div className="incident-list">
        {floods.length === 0 && <p className="incident-empty">No water observations. Pending reports do not affect routes.</p>}
        {floods.map((report) => <article className="incident-card flood-card" key={report.report_id}>
          <div className="incident-card-top"><strong>{report.demo ? 'DEMO · ' : ''}{report.depth_cm}  cm of water</strong><span className={`incident-state ${report.status === 'confirmed' ? 'validated' : report.status}`}>{report.status === 'confirmed' ? "Confirmed · closure active" : report.status === 'pending_review' ? "Pending review" : report.status}</span></div>
          <div className="incident-meta">Radius {report.radius_m}  m · source {report.source}  · expires {new Date(report.expires_at).toLocaleTimeString("en-US", { hour: '2-digit', minute: '2-digit' })}</div>
          {report.note && <p>{report.note}</p>}
          {report.status === 'pending_review' && <div className="incident-actions"><button disabled={busy} onClick={() => void actFlood(report.report_id, 'confirm')}>Confirm and reroute</button><button disabled={busy} onClick={() => void actFlood(report.report_id, 'dismiss')}>Dismiss</button></div>}
          {report.status === 'confirmed' && <div className="incident-actions"><span>Routing closes segments above {graphStatus?.city_profile ? "0 cm configured for the fleet" : "the fleet limit"}</span><button disabled={busy} onClick={() => void actFlood(report.report_id, 'clear')}>Clear</button></div>}
        </article>)}
      </div>
      <footer className="incident-disclaimer">The score ranks evidence; it is not a calibrated probability and does not independently confirm an incident.</footer>
    </aside>}
  </>;
}
