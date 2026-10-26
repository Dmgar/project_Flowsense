import { JourneyEntry } from './JourneyEntry';
import { scrollBehavior, tourSteps } from './journey';
import { BrandMark } from '../components/BrandMark';
import { parseCoordinates } from './coordinates';
import { ThemeSettings } from './ThemeControl';
import './reports.css';
import './sourceConnection.css';
import './cameraCatalog.css';
import './corridorPlanner.css';
import './mobilityContext.css';
import './reviewQueue.css';
import './corridorReading.css';
import { apiUrl } from '../api/urls';
import { regions, matchesZone } from './coverage';
import { CoverageDashboard } from './CoverageDashboard';
import { cameraStatus, checkedAt } from './cameraStatus';
import { cameraCatalogStatus } from './cameraCatalogStatus';
import { calibrationCorridorProgress, calibrationPlaybackCoverage, hasPreviouslyVerifiedVideo, nextCalibrationCamera } from './cameraCalibration';
import { lazy, Suspense, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ComponentProps, FormEvent } from 'react';
import { computeAlternativeRoutes } from '../api/client';
import { useStore } from '../store/useStore';
import { connectCamera, getCameras } from './api';
import { recordPolicyAcceptance } from './api';
import { PolicyAcceptanceFields } from './LegalPages';
import { usePolicyChoices } from './usePolicyChoices';
import { CaseDialog } from './ReviewWorkflow';
import { CameraThumb } from './CameraThumb';
import { observedCaseSignal, resolveSignalCameraEvidence, signalNextCheck } from './signalEvidence';
import { caseExportAvailability, caseRefreshNotice, caseReportStatus, cityPulseEmptyState } from './caseDataState';
import { shouldLoadMap } from './mapLoading';
import { refreshCameraCatalogAfterConnect } from './cameraConnectionState';
import { validateCameraConnection, type CameraConnectionErrors } from './cameraConnectionForm';
import { corridors, signals, statusLabels, trendSeries } from './data';
import { ScenarioComposition } from './ScenarioComposition';
import { ReportAuditPreview } from './ReportAuditPreview';
import { GuideGlossary } from './GuideGlossary';
import { useProduct } from './store';
import { Badge, ConfidenceMeter, EmptyState, Icon, MetricCard, Panel, ReviewBadge, SeverityBadge, Sparkline, TrendChart } from './ui';
import type { Camera, Signal } from './types';

const LazyCityMap = lazy(() => import('./CityMap').then(module => ({ default: module.CityMap })));

function MapView(props: ComponentProps<typeof LazyCityMap>) {
  const host = useRef<HTMLDivElement>(null);
  const [nearViewport, setNearViewport] = useState(false);
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    if (!('IntersectionObserver' in window)) {
      const frame = requestAnimationFrame(() => setNearViewport(true));
      return () => cancelAnimationFrame(frame);
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry || !shouldLoadMap(entry)) return;
      setNearViewport(true);
      observer.disconnect();
    }, { root: element.closest('#product-content'), rootMargin: '280px 0px' });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  if (!nearViewport) return <div ref={host} className="p-city-map p-map-loading p-map-placeholder"><div><span className="p-map-placeholder-icon" aria-hidden="true"><Icon name="map" size={25} /></span><strong>Map view</strong><p>This view opens as you reach it. Its loading state does not indicate camera or road coverage.</p></div></div>;
  return <Suspense fallback={<div className="p-city-map p-map-loading p-map-placeholder" role="status" aria-busy="true"><div><span className="p-map-placeholder-icon" aria-hidden="true"><span className="p-request-progress"><Icon name="refresh" size={24} /></span></span><strong>Preparing map view…</strong><p>Road and source availability are shown separately once the view opens.</p></div></div>}><LazyCityMap {...props} /></Suspense>;
}

function downloadCsv(name: string, rows: Record<string, unknown>[]) {

  const keys = Object.keys(rows[0] || { status: "No data" });
  const cell = (value: unknown) => { const text = String(value ?? ''); return '"' + (text.match(/^[=+@-]/) ? "'" + text : text).replaceAll('"', '""') + '"'; };
  const blob = new Blob(['\ufeff' + [keys.map(cell).join(','), ...rows.map((r) => keys.map((k) => cell(r[k])).join(','))].join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = name; link.click(); URL.revokeObjectURL(url);
  useProduct.getState().notify(`${name} prepared. Check your browser downloads for the CSV file.`);

}

export function PageHeading({ eyebrow, title, subtitle, action }: { eyebrow: string; title: string; subtitle: string; action?: React.ReactNode }) { return <div className="p-page-heading"><div><span className="p-eyebrow">{eyebrow}</span><h1>{title}</h1><p>{subtitle}</p></div>{action && <div className="p-heading-actions">{action}</div>}</div>; }

export function Layers() {
  const layers = useProduct(state => state.layers);
  const observed = useProduct(state => state.mode === 'observed');
  return <div className="p-layer-controls">{[['congestion', observed ? 'Road network' : 'Traffic', 'route'], ['cameras', 'Cameras', 'camera'], ['incidents', 'Signals', 'alert'], ['pedestrians', 'Pedestrians', 'walk'], ['freight', 'Freight', 'car']].map(([key, label, icon]) => {
    const unavailable = observed && (key === 'pedestrians' || key === 'freight');
    return <button key={key} disabled={unavailable} title={unavailable ? 'Available in presentation mode; no calibrated observations are available.' : label} className={layers[key] && !unavailable ? 'active' : ''} aria-pressed={layers[key] && !unavailable} onClick={() => useProduct.getState().toggleLayer(key)}><Icon name={icon} size={15} />{label}<i /></button>;
  })}</div>;
}

export function Overview({ mapOnly = false }: { mapOnly?: boolean }) {

  const cameras = useProduct((s) => s.cameras);
  const cases = useProduct((s) => s.cases);
  const casesLoaded = useProduct(s => s.casesLoaded);
  const casesLoadStatus = useProduct(s => s.casesLoadStatus);
  const caseRefreshMessage = caseRefreshNotice(casesLoadStatus, casesLoaded);
  const catalogLoaded = useProduct(s => s.cameraCatalogLoaded);
  const catalogFailed = useProduct(s => s.cameraCatalogFailed);
  const mode = useProduct((s) => s.mode);
  const district = useProduct((s) => s.district);
  const query = useProduct((s) => s.query);
  const status = useStore((s) => s.graphStatus);
  const mapFocus = useProduct((s) => s.mapFocus);
  const zoneCameras = cameras.filter(c => matchesZone(district, c.district));
  const scopedCases = cases.filter(c => c.data_origin === (mode === 'presentation' ? 'presentation' : 'observation') && (district === "All districts" || (c.data_origin === 'observation' ? zoneCameras.some(camera => camera.id === c.evidence_camera_id) : signals.some(signal => signal.id === c.signal_id && matchesZone(district, signal.district)))));
  const visible = mode === 'presentation' ? signals.filter((s) => matchesZone(district, s.district) && `${s.title} ${s.location}`.toLowerCase().includes(query.toLowerCase())) : [];
  const observedReviews = cases.filter(item => item.data_origin === 'observation').map(item => observedCaseSignal(item, cameras)).filter(signal => matchesZone(district, signal.district) && `${signal.title} ${signal.location} ${signal.id}`.toLowerCase().includes(query.toLowerCase()));
  const cityPulseSignals = mode === 'presentation' ? visible : observedReviews;
  const emptyCityPulse = cityPulseEmptyState(casesLoadStatus, casesLoaded, query, district);
  return <div className={`p-screen p-overview ${mapOnly ? 'map-only' : ''}`}>
    <PageHeading eyebrow="MOBILITY INTELLIGENCE" title={mapOnly ? "The region in context" : "A clearer region."} subtitle="Greater Los Angeles, California · coast, valley and regional corridors." action={<button className="p-button primary" onClick={() => useProduct.getState().navigate('/explore')}>Explore a street <Icon name="search" /></button>} />
    {!mapOnly && <JourneyEntry />}
    {!mapOnly && <div className="p-metrics four"><MetricCard label="Registered cameras" value={catalogLoaded && !catalogFailed ? zoneCameras.length : '—'} unit="sources" icon="camera" note={catalogFailed ? "Catalog unavailable" : catalogLoaded ? "Registered source catalog" : "Loading source catalog"} /><MetricCard label="Road network" value={status ? status.edge_count.toLocaleString("en-US") : '—'} unit="segments" icon="route" note={!status ? "Road context not loaded" : status.is_synthetic ? "Illustrative network" : "OpenStreetMap reference network"} /><MetricCard label="Review needed" value={casesLoaded ? mode === 'presentation' ? visible.filter((s) => !cases.some((c) => c.signal_id === s.id && ['resolved', 'dismissed'].includes(c.status))).length : scopedCases.filter((c) => !['resolved', 'dismissed'].includes(c.status)).length : '—'} icon="alert" tone="amber" note={caseRefreshMessage ? "Last loaded cases" : !casesLoaded ? casesLoadStatus === 'error' ? "Cases unavailable" : "Loading cases" : mode === 'presentation' ? "Scenario signals" : "Observed cases"} /><MetricCard label="Confirmed cases" value={casesLoaded ? scopedCases.filter((c) => c.status === 'confirmed').length : '—'} icon="check" note={caseRefreshMessage ? "Last loaded cases" : casesLoaded ? mode === 'presentation' ? "Scenario cases" : "Operator confirmation" : "Cases unavailable"} /></div>}
    {!mapOnly && caseRefreshMessage && <p className="p-small-note p-case-data-notice" role="status">{caseRefreshMessage}</p>}
    <div className="p-region-explorer" aria-label="Explore areas"><button className={district === "All districts" ? 'active' : ''} onClick={() => { useProduct.getState().setMapFocus(null); useProduct.getState().setDistrict("All districts"); }}>Entire region <b>{catalogLoaded && !catalogFailed ? cameras.length : '—'}</b></button>{regions.map(region => <button key={region.name} className={district === region.name ? 'active' : ''} onClick={() => { useProduct.getState().setMapFocus(null); useProduct.getState().setDistrict(region.name); }}><Icon name="pin" size={13} />{region.name}<b>{catalogLoaded && !catalogFailed ? cameras.filter(c => matchesZone(region.name, c.district)).length : '—'}</b></button>)}</div>
    <div className={`p-overview-layout ${mapOnly ? 'map-only' : ''}`}><section className="p-overview-map"><Layers /><MapView focus={mapOnly && mapFocus ? mapFocus : undefined} />{!mapOnly && <div className="p-map-story"><Badge>{mode === 'presentation' ? "Explore the scenario" : "Public sources"}</Badge><h3>Context changes<br />the decision.</h3><p>Select a segment, camera or signal to open its evidence.</p><button className="p-text-button" onClick={() => useProduct.getState().navigate('/corridors/harbor')}>Explore the corridor <Icon name="arrow" size={15} /></button></div>}</section>
      {!mapOnly && <aside className="p-mobility-sidebar"><Panel title={mode === 'presentation' ? 'City pulse' : 'Saved review cases'} action={<span className="p-live-dot">{mode === 'presentation' ? "Scenario" : "Operations"}</span>}>{mode === 'presentation' && <p className="p-small-note">Illustrative scenario indicators; they do not represent current traffic observations.</p>}<div className="p-signal-cards">{cityPulseSignals.slice(0, 4).map((signal) => <button key={signal.id} className="p-signal-card" onClick={() => { useProduct.getState().selectSignal(signal.id); useProduct.getState().navigate('/hotspots'); }}><div className={`p-signal-icon ${signal.severity}`}><Icon name={signal.type === "Pedestrians" ? 'walk' : signal.type === "Freight" ? 'car' : 'alert'} size={22} /></div><div><span><b>{signal.title}</b><SeverityBadge value={signal.severity} /></span><small><Icon name="pin" size={11} />{signal.location}</small><p>{signal.evidence}</p>{mode === 'presentation' && signal.data_origin !== 'observation' && <span className="p-example-sparkline"><small>Example trend</small><Sparkline tone={signal.severity === 'high' ? 'red' : 'amber'} /></span>}</div></button>)}{!cityPulseSignals.length && <EmptyState title={mode === 'observed' ? emptyCityPulse.title : query ? "No matches" : "No review signals"} detail={mode === 'observed' ? emptyCityPulse.detail : "Try another district or search."} />}</div><button className="p-text-button" onClick={() => useProduct.getState().navigate('/risk-signals')}>View review queue <Icon name="arrow" size={14} /></button></Panel><Panel title="Window into the city" action={<button className="p-text-button" onClick={() => useProduct.getState().navigate('/cameras')}>View all</button>}><div className="p-preview-grid">{cameras.filter(c => matchesZone(district, c.district)).sort((a, b) => Number(cameraStatus(b).usable) - Number(cameraStatus(a).usable)).slice(0, 2).map((camera) => <CameraThumb key={camera.id} camera={camera} />)}</div>{!catalogLoaded && <p className="p-small-note">{catalogFailed ? "Camera catalog unavailable. Use Retry connection above to check again." : "Loading public camera sources…"}</p>}{catalogLoaded && !zoneCameras.length && <p className="p-small-note">No public cameras are listed for this area.</p>}{catalogLoaded && zoneCameras.length > 0 && <p className="p-small-note">Registered video sources. Availability and source terms depend on the provider.</p>}</Panel></aside>}
    </div>
    {!mapOnly && <CoverageDashboard />}
    {!mapOnly && <div className="p-overview-footer"><span><Icon name="shield" size={16} />Aggregate intelligence. Decisions remain with the operator.</span><button className="p-text-button" onClick={() => useProduct.getState().navigate('/storyboard')}>How FlowSense works <Icon name="arrow" size={14} /></button></div>}
  </div>;

}

export function Hotspots({ risk = false }: { risk?: boolean }) {

  const queueId = useId();
  const selectedHeading = useRef<HTMLHeadingElement>(null);
  const mode = useProduct((s) => s.mode);
  const period = useProduct(s => s.period);
  const district = useProduct((s) => s.district);
  const query = useProduct((s) => s.query);
  const selectedId = useProduct((s) => s.selectedSignal);
  const cameras = useProduct((s) => s.cameras);
  const cases = useProduct((s) => s.cases);
  const casesLoaded = useProduct(s => s.casesLoaded);
  const casesLoadStatus = useProduct(s => s.casesLoadStatus);
  const caseRefreshMessage = caseRefreshNotice(casesLoadStatus, casesLoaded);
  const scopedCases = cases.filter((c) => c.data_origin === (mode === 'presentation' ? 'presentation' : 'observation'));
  const [severity, setSeverity] = useState('all');
  const [type, setType] = useState('all');
  const [confidence, setConfidence] = useState(0);
  const [reviewStatus, setReviewStatus] = useState('all');
  const [sort, setSort] = useState('impact');
  const effectiveSort = mode === 'observed' && sort === 'duration' ? 'impact' : sort;
  const [dialog, setDialog] = useState<Signal | null>(null);
  const reviewTrigger = useRef<HTMLButtonElement | null>(null);
  const queueResults = useRef<HTMLDivElement>(null);
  const queueFilters = useRef<HTMLElement>(null);
  const observedSignals: Signal[] = useMemo(() => cases.filter(item => item.data_origin === 'observation').map(item => observedCaseSignal(item, cameras)), [cases, cameras]);
  const items = (mode === 'presentation' ? signals : observedSignals).filter((s) => matchesZone(district, s.district) && (severity === 'all' || severity === s.severity) && (type === 'all' || type === s.type) && (!risk || (s.confidence ?? 0) * 100 >= confidence) && `${s.title} ${s.location} ${s.id}`.toLowerCase().includes(query.toLowerCase()) && (reviewStatus === 'all' || (cases.find((c) => c.signal_id === s.id)?.status || 'new') === reviewStatus)).sort((a, b) => effectiveSort === 'confidence' ? (b.confidence ?? 0) - (a.confidence ?? 0) : effectiveSort === 'duration' ? b.duration - a.duration : b.impact - a.impact);
  const selected = items.find((s) => s.id === selectedId) || items[0];
  const selectedCase = cases.find((c) => c.signal_id === selected?.id);
  const cameraCatalogLoaded = useProduct(s => s.cameraCatalogLoaded);
  const cameraCatalogFailed = useProduct(s => s.cameraCatalogFailed);
  const selectedEvidence = selected ? resolveSignalCameraEvidence(selected, cameras, cameraCatalogLoaded, cameraCatalogFailed) : null;
  const selectedCamera = selectedEvidence && 'camera' in selectedEvidence ? selectedEvidence.camera : undefined;
  const focus: [number, number] | undefined = selected && (selected.data_origin !== 'observation' || selectedCamera) ? [selected.lat, selected.lng] : undefined;
  const hasQueueFilters = severity !== 'all' || type !== 'all' || risk && confidence > 0 || reviewStatus !== 'all' || district !== 'All districts' || Boolean(query.trim());
  const resetQueueFilters = () => {
    setSeverity('all'); setType('all'); setConfidence(0); setReviewStatus('all'); const state = useProduct.getState(); state.setDistrict('All districts'); state.setQuery('');
    requestAnimationFrame(() => queueFilters.current?.querySelector<HTMLSelectElement>('select')?.focus({ preventScroll: false }));
  };
  const openSignalDetails = (id: string) => { useProduct.getState().selectSignal(id); requestAnimationFrame(() => selectedHeading.current?.focus()); };
  const returnToQueue = () => {
    const destination = queueResults.current?.querySelector<HTMLButtonElement>('button[aria-expanded="true"]') || queueResults.current;
    destination?.focus({ preventScroll: true });
    destination?.scrollIntoView({ block: 'center', behavior: scrollBehavior(window.matchMedia('(prefers-reduced-motion: reduce)').matches) });
  };
  return <div className="p-screen p-queue-screen">
    <PageHeading eyebrow={risk ? "EVIDENCE BEFORE ACTION" : "CITY PRIORITIES"} title={risk ? "Risk signals" : "Hotspots"} subtitle={risk ? "Review what changed. Check the evidence before confirming." : mode === 'observed' ? "Review saved observations by location, evidence score and status." : "Explore an illustrative ranking by impact and evidence."} action={<button className="p-button" disabled={mode === 'observed' && (!casesLoaded || casesLoadStatus !== 'ready')} title={mode === 'observed' && (!casesLoaded || casesLoadStatus !== 'ready') ? 'Wait for a successful case refresh before exporting this view.' : undefined} onClick={() => downloadCsv(risk ? 'flowsense-risk-signals.csv' : 'flowsense-hotspots.csv', items.map((s) => ({ id: s.id, location: s.location, issue: s.title, severity: s.severity, confidence_score: s.confidence, status: casesLoaded ? cases.find((c) => c.signal_id === s.id)?.status || 'new' : 'unavailable', case_status_freshness: !casesLoaded ? 'unavailable' : casesLoadStatus === 'error' ? 'last_loaded_refresh_failed' : casesLoadStatus === 'refreshing' ? 'refreshing_last_loaded' : 'current', data_origin: s.data_origin || 'presentation' })))}><Icon name="download" />{mode === 'observed' && (!casesLoaded || casesLoadStatus !== 'ready') ? 'CSV unavailable' : 'Export CSV'}</button>} />
    <div className="p-queue-context"><span aria-hidden="true"><Icon name={mode === 'presentation' ? 'play' : 'camera'} size={20} /></span><div><strong>{mode === 'presentation' ? 'Illustrative scenario signals' : 'Saved observation cases'}</strong><p>{mode === 'presentation' ? 'Use these examples to learn the review flow. Rankings and scores do not describe verified current traffic.' : 'Review the saved record, its source and the next human check. A recorded observation alone does not confirm an incident.'}</p></div></div>
    <section ref={queueFilters} className="p-queue-filter-section" aria-label="Review queue filters"><div className="p-queue-filter-heading"><h2>Refine this view</h2><span role="status">{mode === 'observed' && !casesLoaded ? 'Signal count unavailable' : `${items.length} ${casesLoadStatus !== 'ready' && mode === 'observed' ? 'last loaded ' : ''}${items.length === 1 ? 'signal' : 'signals'}`}</span></div>
      <div className="p-filter-bar"><label>Signal type<select value={type} onChange={event => setType(event.target.value)}><option value="all">All types</option>{[...new Set([...signals.map(signal => signal.type), 'Manual review'])].map(signalType => <option key={signalType}>{signalType}</option>)}</select></label><label>Priority<select value={severity} onChange={event => setSeverity(event.target.value)}><option value="all">All priorities</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select></label><label>Review status<select disabled={!casesLoaded} value={reviewStatus} onChange={event => setReviewStatus(event.target.value)} aria-describedby={!casesLoaded ? `${queueId}-filter-status` : caseRefreshMessage ? `${queueId}-filter-stale` : undefined}><option value="all">All statuses</option>{Object.entries(statusLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>{!casesLoaded && <small id={`${queueId}-filter-status`}>Saved case statuses are unavailable.</small>}{caseRefreshMessage && <small id={`${queueId}-filter-stale`}>{caseRefreshMessage}</small>}</label><label>Sort by<select value={effectiveSort} onChange={event => setSort(event.target.value)}><option value="impact">{mode === 'presentation' ? 'Impact · highest first' : 'Default saved-record order'}</option><option value="confidence">Evidence score</option><option value="duration" disabled={mode === 'observed'}>{mode === 'observed' ? 'Duration unavailable for saved records' : 'Duration'}</option></select></label></div>
      {risk && <label className="p-queue-score-filter">Minimum evidence score <output htmlFor={`${queueId}-minimum-score`}>{confidence} / 100</output><input id={`${queueId}-minimum-score`} type="range" min="0" max="100" value={confidence} aria-valuetext={`${confidence} out of 100; not a calibrated probability`} onChange={event => setConfidence(Number(event.target.value))} /><small>Scores help prioritize review; they are not calibrated probabilities.</small></label>}
      {hasQueueFilters && <div className="p-queue-active-filters" aria-label="Active review filters" onClick={event => {
        const trigger = (event.target as HTMLElement).closest('button');
        requestAnimationFrame(() => {
          if (trigger && !trigger.isConnected && document.activeElement === document.body) queueFilters.current?.querySelector<HTMLSelectElement>('select')?.focus({ preventScroll: false });
        });
      }}>{query.trim() && <button type="button" aria-label={`Clear review search: ${query}`} onClick={() => useProduct.getState().setQuery('')}><Icon name="search" size={13} /><span>“{query}”</span><Icon name="close" size={12} /></button>}{district !== 'All districts' && <button type="button" aria-label={`Clear review area: ${district}`} onClick={() => useProduct.getState().setDistrict('All districts')}><Icon name="pin" size={13} /><span>{district}</span><Icon name="close" size={12} /></button>}<button type="button" className="p-queue-reset" onClick={resetQueueFilters}>Clear search and filters<Icon name="refresh" size={13} /></button></div>}
    </section>
    {!risk && mode === 'observed' && effectiveSort === 'impact' && <p className="p-queue-order-note"><Icon name="info" size={15} /><span>Default order follows the loaded saved records. No measured impact baseline is available; use Evidence score or the filters to review a different order.</span></p>}
    {mode === 'observed' && <p className="p-small-note p-queue-period-context">The reference period labels this view; it does not filter saved cases by date. Check each case's recorded timestamps.</p>}
    {caseRefreshMessage && <p className="p-small-note p-case-data-notice" role="status">{caseRefreshMessage}</p>}
    <div className={`p-queue-layout ${risk ? 'risk' : ''}${selected ? ' has-selection' : ' empty-selection'}`}>
      {risk && items.length > 0 && <section className="p-risk-map"><MapView focus={focus} compact selected={selected?.id} signalItems={items} onSignal={(s) => useProduct.getState().selectSignal(s.id)} /><div className="p-risk-map-key"><span><i className="red" />High priority</span><span><i className="amber" />Review required</span></div></section>}
      <section className="p-panel p-table-panel"><div className="p-panel-head"><h3>{risk ? "Review queue" : mode === 'observed' && effectiveSort === 'impact' ? 'Saved observations' : effectiveSort === 'confidence' ? 'Ranked by evidence score' : effectiveSort === 'duration' ? 'Ranked by duration' : 'Ranked by impact'}</h3><Badge tone="gray">Reference: {period}</Badge></div><p className="p-table-scroll-hint" aria-hidden="true">Scroll table sideways to see all columns.</p>{items.length ? <div ref={queueResults} className="p-table-scroll" role="region" aria-label={risk ? "Risk review queue table; scroll horizontally for all columns" : "Hotspot ranking table; scroll horizontally for all columns"} tabIndex={0}><table className="p-table"><caption className="p-sr-only">{risk ? "Risk signals" : "Hotspots"}: {mode === 'presentation' ? 'illustrative scenario' : 'saved observations'}. Use View details to read a signal and its evidence.</caption><thead><tr><th scope="col">#</th><th scope="col">{risk ? "Signal / location" : "Location / signal"}</th><th scope="col">Priority</th><th scope="col">{risk ? 'Score' : "Evidence"}</th>{!risk && <th scope="col">Impact</th>}<th scope="col">{risk ? "Duration" : 'Score'}</th><th scope="col">Status</th></tr></thead><tbody>{items.map((signal, i) => <tr key={signal.id} className={selected?.id === signal.id ? 'selected' : ''} onClick={() => useProduct.getState().selectSignal(signal.id)}><td>{i + 1}</td><td><div className="p-table-location">{!risk && <SignalSourceMarker signal={signal} cameras={cameras} catalogLoaded={cameraCatalogLoaded} catalogFailed={cameraCatalogFailed} />}<div><b>{risk ? signal.title : signal.location}</b><small>{risk ? signal.location : signal.title} · {signal.district}</small><button type="button" className="p-text-button p-queue-detail-button" aria-label={`View details for ${signal.title} at ${signal.location}`} aria-controls={`${queueId}-selected-detail`} aria-expanded={selected?.id === signal.id} onClick={event => { event.stopPropagation(); openSignalDetails(signal.id); }}>{selected?.id === signal.id ? 'Viewing details' : 'View details'}<Icon name="arrow" size={13} /></button></div></div></td><td><SeverityBadge value={signal.severity} /></td><td>{risk ? <ConfidenceMeter value={signal.confidence} /> : <><span>{signal.evidence}</span>{mode === 'presentation' && signal.data_origin !== 'observation' && <span className="p-example-sparkline"><small>Example trend</small><Sparkline tone={signal.severity === 'high' ? 'red' : 'amber'} /></span>}</>}</td>{!risk && <td><b className={signal.severity === 'high' ? 'p-red' : 'p-amber'}>{signal.data_origin === 'observation' ? "No baseline" : `↑ +${signal.impact}%`}</b><small>{signal.data_origin === 'observation' ? "No measured comparison" : "vs. illustrative baseline"}</small></td>}<td>{risk ? signal.data_origin === 'observation' ? "Manual review" : `${signal.duration} min` : <ConfidenceMeter value={signal.confidence} />}</td><td>{casesLoaded ? <ReviewBadge value={cases.find((c) => c.signal_id === signal.id)?.status || 'new'} /> : <Badge tone="gray">Unavailable</Badge>}</td></tr>)}</tbody></table></div> : <EmptyState title={mode === 'observed' && !casesLoaded ? casesLoadStatus === 'loading' ? "Loading saved observations" : "Saved observations are unavailable" : "No signals in this view"} action={<div className="p-queue-empty-actions">{hasQueueFilters && <button type="button" className="p-button" onClick={resetQueueFilters}>Clear search and filters<Icon name="refresh" /></button>}<button type="button" className="p-button" onClick={() => useProduct.getState().navigate('/explore')}>Find camera evidence <Icon name="camera" /></button></div>} detail={mode === 'observed' ? casesLoaded ? "No saved observations match this view. Find a camera to inspect evidence, or reset the filters." : "Wait for saved cases to load, or use Retry connection above. Your filters are kept." : "Change the filters to broaden your search."} />}<div className="p-table-foot"><span>{mode === 'observed' && !casesLoaded ? "Results unavailable" : `${items.length} results`} · scores are not calibrated probabilities.</span>{hasQueueFilters && <button className="p-text-button" onClick={resetQueueFilters}>Clear search and filters</button>}</div></section>
      {selected && <aside id={`${queueId}-selected-detail`} className="p-detail-drawer" aria-labelledby={`${queueId}-selected-title`}><header><div className={`p-detail-rank ${selected.severity}`}>{items.indexOf(selected) + 1}</div><div><h2 id={`${queueId}-selected-title`} ref={selectedHeading} className="p-queue-selected-title" tabIndex={-1}>{selected.title}</h2><p><Icon name="pin" size={12} />{selected.location}</p></div></header>{!risk && <div className="p-detail-map">{selected.data_origin === 'observation' && !selectedCamera ? <EmptyState icon="pin" title="Source location unavailable" detail="This record has no linked camera location available in the current catalog. Review its source reference below." /> : <MapView focus={focus} compact selected={selected.id} />}</div>}<div className="p-detail-metrics"><span>Priority<SeverityBadge value={selected.severity} /></span><span>Score<ConfidenceMeter value={selected.confidence} /></span><span>{selected.data_origin === 'observation' ? "Source" : "Duration"}<b>{selected.data_origin === 'observation' ? selectedCamera ? selectedCamera.provider || 'Linked source' : selectedEvidence?.state === 'unlinked' ? 'Not linked' : 'Unavailable' : selected.duration + ' min'}</b></span></div><SignalEvidencePanel evidence={selectedEvidence!} /><Panel title="Why it needs attention"><p className="p-detail-description">{selected.action}</p><ul className="p-cause-list">{selected.causes.map((cause) => <li key={cause}>{cause}</li>)}</ul></Panel><Panel title="Next check"><div className="p-next-check"><Icon name="search" /><p>{signalNextCheck(selectedEvidence!.state)}</p></div></Panel>{selectedCase && <div className="p-case-summary"><span>{selectedCase.id}</span><ReviewBadge value={selectedCase.status} /><small>{selectedCase.owner} · {selectedCase.audit.length}  audit log entries</small></div>}<div className="p-review-actions"><button className="p-button primary" onClick={(event) => { reviewTrigger.current = event.currentTarget; setDialog(selected); }}><Icon name="check" />{selectedCase && ['resolved', 'dismissed'].includes(selectedCase.status) ? "View audit log" : selectedCase ? "Continue review" : "Assign review"}</button><button className="p-button" onClick={() => useProduct.getState().navigate(selectedCamera ? `/cameras/${encodeURIComponent(selectedCamera.id)}` : '/cameras')}><Icon name="camera" />{selectedCamera ? 'Open linked camera' : selectedEvidence?.state === 'catalog_unavailable' || selectedEvidence?.state === 'linked_catalog_unavailable' ? 'Open camera catalog to retry' : selected?.data_origin === 'observation' ? 'Find camera evidence' : 'Explore camera sources'}</button></div><button type="button" className="p-text-button p-queue-return" onClick={returnToQueue}><Icon name="arrow" size={14} />Back to selected signal</button></aside>}
    </div>
    {risk && <div className="p-metrics four p-queue-kpis"><MetricCard label={mode === 'presentation' ? "Scenario signals" : "Camera cases"} value={mode === 'presentation' ? signals.length : casesLoaded ? observedSignals.length : '—'} icon="alert" note={mode === 'presentation' ? "Illustrative scenario" : casesLoaded ? casesLoadStatus === 'ready' ? "Saved observations" : "Last loaded cases" : "Case data unavailable"} /><MetricCard label="Assigned cases" value={casesLoaded ? scopedCases.filter((c) => c.status === 'assigned').length : '—'} icon="clock" note={casesLoaded ? casesLoadStatus === 'ready' ? "Saved case status" : "Last loaded cases" : "Case data unavailable"} /><MetricCard label="Confirmed by operator" value={casesLoaded ? scopedCases.filter((c) => c.status === 'confirmed').length : '—'} icon="check" note={casesLoaded ? casesLoadStatus === 'ready' ? "Saved case status" : "Last loaded cases" : "Case data unavailable"} /><MetricCard label="Dismissed" value={casesLoaded ? scopedCases.filter((c) => c.status === 'dismissed').length : '—'} icon="shield" note={casesLoaded ? casesLoadStatus === 'ready' ? "Saved case status" : "Last loaded cases" : "Case data unavailable"} /></div>}
    {dialog && <CaseDialog signal={dialog} onClose={() => { setDialog(null); requestAnimationFrame(() => { const trigger = reviewTrigger.current; if (trigger?.isConnected && trigger.offsetParent !== null) trigger.focus(); else document.getElementById('product-content')?.focus(); }); }} />}
  </div>;

}

function SignalSourceMarker({ signal, cameras, catalogLoaded, catalogFailed }: { signal: Signal; cameras: Camera[]; catalogLoaded: boolean; catalogFailed: boolean }) {
  const evidence = resolveSignalCameraEvidence(signal, cameras, catalogLoaded, catalogFailed);
  if ('camera' in evidence) return <CameraThumb camera={evidence.camera} />;
  const label = evidence.state === 'illustrative' ? 'Illustrative example' : evidence.state === 'unlinked' ? 'No linked camera' : 'Camera details unavailable';
  return <div className="p-photo-empty p-signal-placeholder" role="img" aria-label={label}><Icon name={evidence.state === 'illustrative' ? 'alert' : 'camera'} /><span>{label}</span></div>;
}

function SignalEvidencePanel({ evidence }: { evidence: ReturnType<typeof resolveSignalCameraEvidence> }) {
  const scenario = evidence.state === 'illustrative';
  const linked = 'camera' in evidence;
  const messages: Partial<Record<typeof evidence.state, string>> = {
    illustrative: 'This example is not linked to a live camera or a verified observation.',
    unlinked: 'No camera source was linked to this saved observation.',
    loading: 'Loading camera details for this saved observation.',
    catalog_unavailable: 'The saved camera reference remains on the case, but the catalog could not load.',
    not_in_catalog: 'The saved camera reference is not present in the current catalog.',
    linked_catalog_unavailable: 'The catalog refresh failed. Showing the last loaded camera record.',
  };
  const retryCatalog = evidence.state === 'catalog_unavailable' || evidence.state === 'linked_catalog_unavailable';
  return <Panel title={scenario ? 'Scenario context' : 'Camera evidence'} action={<Badge tone="gray">{scenario ? 'Illustrative' : linked ? 'Linked source' : 'Source status'}</Badge>}>
    {linked ? <>
      {evidence.state === 'linked_catalog_unavailable' && <p className="p-small-note" role="status">{messages[evidence.state]}</p>}
      <div className="p-evidence-strip"><CameraThumb camera={evidence.camera} /></div>
    </> : <p className="p-small-note" role="status">{messages[evidence.state]}</p>}
    <p className="p-small-note">{scenario ? 'The signal and its metrics are illustrative; they do not describe a verified current condition.' : 'A saved camera observation does not independently confirm an incident or guarantee historical video.'}</p>
    {retryCatalog && <button className="p-text-button" onClick={() => useProduct.getState().navigate('/cameras')}>Open camera catalog to retry <Icon name="arrow" size={14} /></button>}
    {evidence.state === 'not_in_catalog' && <button className="p-text-button" onClick={() => useProduct.getState().navigate('/cameras')}>Open camera catalog <Icon name="arrow" size={14} /></button>}
  </Panel>;
}

export function CorridorAnalytics({ id }: { id?: string }) {
  const readingHelpId = useId();

  const corridor = corridors.find((c) => c.id === id) || corridors[0];
  const cameras = useProduct((s) => s.cameras);
  const catalogLoaded = useProduct(s => s.cameraCatalogLoaded);
  const catalogFailed = useProduct(s => s.cameraCatalogFailed);
  const mode = useProduct((s) => s.mode);
  const period = useProduct((s) => s.period);
  const [baseline, setBaseline] = useState(true);
  const [segment, setSegment] = useState(1);
  const roadEdges = useStore((s) => s.geojsonEdges);
  const corridorEdges = useMemo(() => {
    const names: Record<string, string> = { harbor: 'Harbor Freeway', hollywood: 'Hollywood Freeway', 'santa-monica': 'Santa Monica Freeway' };
    const seen = new Set<string>();
    return roadEdges.filter(edge => {
      const key = [edge.properties.u, edge.properties.v].sort().join('-');
      if (edge.geometry.type !== 'LineString' || edge.properties.name !== names[corridor.id] || seen.has(key)) return false;
      seen.add(key); return true;
    }).sort((a, b) => {
      const point = (edge: typeof a) => edge.geometry.type === 'LineString' ? Math.hypot(edge.geometry.coordinates[0][1] - corridor.lat, edge.geometry.coordinates[0][0] - corridor.lng) : Infinity;
      return point(a) - point(b);
    });
  }, [roadEdges, corridor.id, corridor.lat, corridor.lng]);
  const realSegments = corridorEdges.slice(0, 7);
  const activeSegment = Math.min(segment, Math.max(realSegments.length, 1));
  const selectedEdge = realSegments[activeSegment - 1];
  const nearbyCameras = useMemo(() => [...cameras].sort((a, b) => Math.hypot(a.lat - corridor.lat, a.lng - corridor.lng) - Math.hypot(b.lat - corridor.lat, b.lng - corridor.lng)), [cameras, corridor.lat, corridor.lng]);
  const example = mode === 'presentation';
  const factor = period === "Last 15 min" ? 1 : period === "Last hour" ? .87 : period === "Last 24 h" ? .73 : .65;
  const speedValue = Math.round(corridor.speed + (1 - factor) * 12);
  const change = (current: number, base: number) => `${current >= base ? '\u2191' : '\u2193'} ${Math.round(Math.abs(current / base - 1) * 100)}% vs. baseline`;
  const delta = (current: number, base: number) => example && baseline ? change(current, base) : undefined;
  return <div className="p-screen p-corridor-screen"><PageHeading eyebrow="CORRIDOR DIAGNOSTICS" title={corridor.name} subtitle={`${corridor.length} reference km · ${corridor.intersections} intersections · ${corridor.district}`} action={<><select className="p-select" aria-label="Choose corridor" value={corridor.id} onChange={(e) => { setSegment(1); useProduct.getState().navigate(`/corridors/${e.target.value}`); }}>{corridors.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select><label className="p-toggle-label"><input type="checkbox" aria-describedby={readingHelpId} disabled={!example} checked={baseline} onChange={(e) => setBaseline(e.target.checked)} />Compare illustrative baseline</label><button className="p-button" onClick={() => downloadCsv('flowsense-corridor.csv', trendSeries(factor).map((row) => ({ corridor: corridor.name, data_origin: 'presentation', period, ...row })))} disabled={!example} aria-describedby={readingHelpId} title={!example ? 'No calibrated corridor series is available to export.' : 'Export the illustrative scenario series'}><Icon name="download" />Export scenario CSV</button></>} />
    <div className="p-corridor-reading-note"><Icon name={example ? 'play' : 'info'} size={18} /><p id={readingHelpId}>{example ? 'Scenario values illustrate the corridor workflow. Changing the mapped segment changes the highlight, not the corridor-wide example metrics.' : 'Mapped segments provide road context. Speeds, queues and congestion need calibrated measurements; nearby cameras do not establish segment coverage. Baseline comparison and CSV export stay unavailable because no calibrated corridor series has been supplied.'}</p></div><div className="p-analytics-layout"><div><div className="p-corridor-map"><MapView focus={[corridor.lat, corridor.lng]} highlight={selectedEdge} viewEdges={corridorEdges} /><div className="p-corridor-caption"><Badge>{corridor.district}</Badge><b>{selectedEdge ? `Segment ${activeSegment.toString().padStart(2, '0')}` : 'Road segment unavailable'}</b><span>{example ? "Illustrative congestion " + (corridor.congestion * factor).toFixed(2) : "No calibrated traffic counts"}</span></div></div><div className="p-segment-selector" role="group" aria-label="Choose a mapped road segment">{realSegments.map((edge, i) => <button key={`${edge.properties.u}-${edge.properties.v}`} aria-pressed={activeSegment === i + 1} title={`${edge.properties.name} · ${Math.round(edge.properties.length ?? 0)} m`} aria-label={`Highlight mapped segment ${i + 1} on ${edge.properties.name}`} onClick={() => setSegment(i + 1)} className={activeSegment === i + 1 ? 'active' : ''}><i aria-hidden="true" style={{ background: 'var(--brand-link)' }} />Segment {i + 1}</button>)}</div><div className="p-metrics five"><MetricCard note={example ? "Scenario without comparison" : "No calibrated measurement"} label="Congestion" value={example ? (corridor.congestion * factor).toFixed(2) : '—'} delta={delta(corridor.congestion * factor, corridor.congestion / 1.22)} tone="red" /><MetricCard note={example ? "Scenario without comparison" : "No calibrated measurement"} label="Average speed" value={example ? speedValue : '\u2014'} unit="km/h" delta={delta(speedValue, corridor.speed / .82)} /><MetricCard note={example ? "Scenario without comparison" : "No calibrated measurement"} label="Freight pressure" value={example ? Math.round(corridor.truck * factor) : '\u2014'} unit="/100" delta={delta(corridor.truck * factor, corridor.truck / 1.75)} tone="amber" /><MetricCard note={example ? "Scenario without comparison" : "No calibrated measurement"} label="Pedestrian crossings" value={example ? (corridor.pedestrians * factor / 1000).toFixed(1) + 'k' : '—'} unit="/day" delta={delta(corridor.pedestrians * factor, corridor.pedestrians / 1.28)} /><MetricCard note={example ? "Scenario without comparison" : "No calibrated measurement"} label="Estimated queue" value={example ? Math.round(corridor.queue * factor) : '\u2014'} unit="m" delta={delta(corridor.queue * factor, corridor.queue / 1.68)} tone="red" /></div>
    {example ? <div className="p-chart-grid"><Panel title="Hourly congestion" action={<span className="p-chart-key">Period{baseline && " / baseline"}</span>}><TrendChart baseline={baseline} factor={factor} /></Panel><Panel title="Speed trend"><TrendChart metric="speed" baseline={baseline} factor={factor} /></Panel><Panel title="Traffic composition"><ScenarioComposition baseline={baseline} /></Panel><Panel title="Pedestrian demand"><TrendChart metric="pedestrians" bars height={150} /></Panel></div> : <EmptyState title="Calibrated corridor measurements are unavailable" detail="A series of traffic counts and road calibration is required to estimate speeds, queues and changes over time." />}</div><aside className="p-analytics-insights"><Panel title="What changed" action={<Icon name="info" size={16} />}>{example ? <div className="p-insight-list">{[["More peak-hour pressure", "Demand in the illustrative period increases at corridor access points."], ["Greater freight presence", "The example increases the relative share of trucks; review access conditions."], ["More crossing demand", "Compare crossing windows and accessibility conditions."]].map(([title, text], i) => <div key={title}><b>{i + 1}</b><section><h4>{title}</h4><p>{text}</p></section></div>)}</div> : <p className="p-small-note">No real comparison between periods is available yet.</p>}<div className="p-insight-action"><h4>Next check</h4><p>Inspect the source, viewing direction and road link before attributing a cause. A nearby location alone does not establish coverage.</p><button className="p-button primary" aria-label={nearbyCameras[0] ? `Inspect nearby source: ${nearbyCameras[0].name}` : 'Open camera catalog'} onClick={() => useProduct.getState().navigate(nearbyCameras[0] ? `/cameras/${encodeURIComponent(nearbyCameras[0].id)}` : '/cameras')}>{nearbyCameras[0] ? 'Inspect a nearby source' : 'Open camera catalog'}<Icon name="arrow" /></button></div></Panel><Panel title="Nearby camera sources"><p className="p-small-note">Sorted by proximity to the corridor reference point; not by coverage of the selected segment.</p>{catalogFailed && <p className="p-small-note p-inline-error" role="status">The catalog refresh failed. Any listed sources are from the last loaded catalog.</p>}{!nearbyCameras.length && <p className="p-small-note" role="status">{catalogFailed ? 'Source details are unavailable. Open the catalog to retry.' : !catalogLoaded ? 'Loading camera source locations…' : 'No camera sources are listed in the loaded catalog.'}</p>}<div className="p-preview-grid">{nearbyCameras.slice(0, 2).map((c) => <CameraThumb key={c.id} camera={c} />)}</div></Panel></aside></div>
  </div>;

}

export function Pedestrians() {
  const mode = useProduct(s => s.mode);
  const [zone, setZone] = useState(0);
  const [transport, setTransport] = useState('Pedestrians');
  const zones = [signals[2], signals[7], signals[4]];
  const selected = zones[zone];
  const example = mode === 'presentation';
  const pedestrianExample = example && transport === 'Pedestrians';
  const travelModes = [{ name: 'Vehicles', icon: 'car' }, { name: 'Pedestrians', icon: 'walk' }, { name: 'Cyclists', icon: 'route' }, { name: 'Transit', icon: 'map' }];
  const openPedestrianExample = () => { useProduct.getState().setMode('presentation'); setTransport('Pedestrians'); };
  const findLocationEvidence = () => { const state = useProduct.getState(); state.setDistrict('All districts'); state.setMapFocus(null); state.navigate(`/explore?q=${encodeURIComponent(selected.location)}`); };
  return <div className="p-screen p-mobility-screen">
    <PageHeading eyebrow="MOBILITY AT HUMAN SCALE" title="Pedestrian flow" subtitle="Explore crossing context, understand the limits and choose an evidence check." action={<><label className="p-mobility-location">Reference location<select className="p-select" value={zone} onChange={event => setZone(Number(event.target.value))}>{zones.map((location, i) => <option key={location.id} value={i}>{location.location}</option>)}</select></label><div className="p-segmented" role="group" aria-label="Travel mode context">{travelModes.map(travelMode => <button type="button" key={travelMode.name} aria-pressed={transport === travelMode.name} className={transport === travelMode.name ? 'active' : ''} onClick={() => setTransport(travelMode.name)}><Icon name={travelMode.icon} size={15} />{travelMode.name}</button>)}</div></>} />
    <section className="p-mobility-context" aria-label="Measurement context"><span aria-hidden="true"><Icon name={example ? 'play' : 'info'} size={22} /></span><div><h2>{pedestrianExample ? 'Illustrative pedestrian context' : example ? `${transport} · map context only` : 'No calibrated crossing measurements'}</h2><p>{pedestrianExample ? 'The values below demonstrate a pedestrian review. They do not establish current demand, signal compliance or a confirmed conflict.' : example ? 'This view has no demand or signal-phase measurements for the selected travel mode. Choose Pedestrians to explore the existing example.' : 'This view has no observed mode-demand or signal-phase measurements. Search for a source and review its evidence, or explore a clearly labeled presentation example.'}</p></div>{!pedestrianExample && <button className="p-button" onClick={openPedestrianExample}>{example ? 'View pedestrian example' : 'Open presentation example'}<Icon name="arrow" size={14} /></button>}</section>
    <div className="p-pedestrian-layout">
      <section className="p-pedestrian-map"><MapView focus={[selected.lat, selected.lng]} pedestrians={pedestrianExample} /><div className="p-zone-label"><Icon name={travelModes.find(item => item.name === transport)?.icon || 'walk'} size={22} /><span><b>{selected.location}</b><small>{transport} · {selected.district}</small></span></div><div className="p-zone-context"><Icon name="pin" /><span>Reference location<br /><b>{zone === 0 ? 'Civic center' : zone === 1 ? 'Commercial crossing' : 'Corridor access'}</b></span></div></section>
      <aside><Panel title={pedestrianExample ? 'Pedestrian scenario' : `${transport} · measurements unavailable`}><div className="p-metrics two"><MetricCard label="Pedestrian demand" value={pedestrianExample ? [1420, 860, 650][zone] : '—'} unit="/hour" icon="walk" delta={pedestrianExample ? '↑ 18% vs. baseline' : undefined} note="Not measured in this view" /><MetricCard label="Space pressure" value={pedestrianExample ? (.76 - zone * .09).toFixed(2) : '—'} icon="alert" tone="amber" delta={pedestrianExample ? 'High-demand scenario' : undefined} note="Not measured in this view" /><MetricCard label="Estimated wait" value={pedestrianExample ? 28 + zone * 4 : '—'} unit="s" icon="clock" delta={pedestrianExample ? '↓ 12% vs. baseline' : undefined} note="Not measured in this view" /><MetricCard label="Interactions to review" value={pedestrianExample ? 14 - zone * 2 : '—'} unit="/hour" tone="red" delta={pedestrianExample ? '↑ 27% vs. baseline' : undefined} note="Not measured in this view" /></div><div className="p-accessibility"><Icon name="shield" size={24} /><span><b>Human accessibility review</b><small>Check crossing time, continuity and conditions.</small></span><Badge tone="gray">Not assessed</Badge></div></Panel></aside>
    </div>
    <div className={`p-pedestrian-charts ${pedestrianExample ? '' : 'p-mobility-no-series'}`}>
      {pedestrianExample ? <><Panel title="Pedestrian volume · scenario"><TrendChart metric="pedestrians" bars /></Panel><Panel title="Crossings within the signal phase · scenario"><div className="p-compliance"><div className="p-donut" style={{ background: 'conic-gradient(var(--brand-action) 0% 92%, #d2b266 92% 98%, #c87566 98%)' }}><div><b>92%</b><small>scenario</small></div></div><ul><li><i className="green" />Within phase <b>92%</b></li><li><i className="amber" />Late crossing <b>6%</b></li><li><i className="red" />Outside phase <b>2%</b></li></ul></div><p className="p-small-note">Measuring compliance requires integration with the actual traffic signal phase.</p></Panel><Panel title="Potential interactions · scenario"><TrendChart metric="conflicts" bars /></Panel></> : <Panel title="Measurement context"><EmptyState icon="walk" title={example ? `No ${transport.toLowerCase()} series in this view` : 'Crossing observations are not available here'} detail="A map location alone does not establish demand, crossing compliance or a conflict. Use the presentation example to learn the format, and check connected sources before drawing a conclusion." action={<button className="p-button" onClick={openPedestrianExample}>{example ? 'View pedestrian example' : 'Open presentation example'}<Icon name="arrow" size={14} /></button>} /></Panel>}
      <Panel title="Find supporting evidence"><div className="p-mobility-evidence-location"><Icon name="pin" size={15} /><span>{selected.location}</span></div><EmptyState icon="camera" title="Choose a source to review" detail="No camera is linked to this reference location in this view. Search nearby sources and check each camera's viewing direction before treating it as crossing evidence." action={<button className="p-button primary" onClick={findLocationEvidence}>Explore nearby sources<Icon name="arrow" size={14} /></button>} /></Panel>
    </div>
  </div>;
}

export function EmergencyCorridor() {

  const cameras = useProduct((s) => s.cameras);
  const catalogLoaded = useProduct(s => s.cameraCatalogLoaded);
  const catalogFailed = useProduct(s => s.cameraCatalogFailed);
  const route = useStore((s) => s.activeRoute);
  const options = useStore((s) => s.routeOptions);
  const [origin, setOrigin] = useState(() => { const point = route?.waypoints[0]; return point ? `${point.latitude},${point.longitude}` : '34.0437,-118.2505'; });
  const [destination, setDestination] = useState(() => { const point = route?.waypoints.at(-1); return point ? `${point.latitude},${point.longitude}` : '34.0533,-118.2657'; });
  const [vehicle, setVehicle] = useState<'ambulance' | 'fire_truck'>(() => route?.vehicle_type === 'fire_truck' ? 'fire_truck' : 'ambulance');
  const inputKey = `${origin.trim()}|${destination.trim()}|${vehicle}`;
  const [calculatedInputs, setCalculatedInputs] = useState(inputKey);
  const routeInputsChanged = Boolean(route) && calculatedInputs !== inputKey;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [coordinateErrors, setCoordinateErrors] = useState<{ origin: string; destination: string }>({ origin: '', destination: '' });
  const originInput = useRef<HTMLInputElement>(null);
  const destinationInput = useRef<HTMLInputElement>(null);
  const validationFocusTarget = useRef<HTMLInputElement | null>(null);
  const submitting = useRef(false);
  const policy = usePolicyChoices();
  const assessment = useStore(state => state.routeResilience);
  const [pick, setPick] = useState<'origin' | 'destination' | null>(null);
  const mapSection = useRef<HTMLDivElement>(null);
  useEffect(() => { if (pick) mapSection.current?.scrollIntoView({ block: 'center', behavior: scrollBehavior(window.matchMedia('(prefers-reduced-motion: reduce)').matches) }); }, [pick]);
  useEffect(() => { const target = validationFocusTarget.current; validationFocusTarget.current = null; target?.focus(); }, [coordinateErrors]);

  const calculate = async (event: FormEvent) => {
    event.preventDefault();
    if (submitting.current) return;
    const originValue = origin;
    const destinationValue = destination;
    const vehicleValue = vehicle;
    const policyValue = { form_type: 'emergency_corridor' as const, operator_reference: policy.operatorReference, terms_accepted: policy.termsAccepted, privacy_acknowledged: policy.privacyAcknowledged };
    const nextErrors = { origin: '', destination: '' };
    let originCoordinates: ReturnType<typeof parseCoordinates> | null = null;
    let destinationCoordinates: ReturnType<typeof parseCoordinates> | null = null;
    try { originCoordinates = parseCoordinates(originValue); } catch (reason) { nextErrors.origin = reason instanceof Error ? reason.message : 'Enter valid origin coordinates.'; }
    try { destinationCoordinates = parseCoordinates(destinationValue); } catch (reason) { nextErrors.destination = reason instanceof Error ? reason.message : 'Enter valid destination coordinates.'; }
    setCoordinateErrors(nextErrors);
    if (nextErrors.origin || nextErrors.destination) {
      validationFocusTarget.current = (nextErrors.origin ? originInput : destinationInput).current;
      return;
    }
    if (!policyValue.terms_accepted || !policyValue.privacy_acknowledged || policyValue.operator_reference.trim().length < 2) {
      setError('Complete the operator reference and both policy choices before calculating this corridor.');
      return;
    }
    submitting.current = true; setBusy(true); setPick(null); setError('');
    let receiptId = '';
    try {
      const receipt = await recordPolicyAcceptance(policyValue);
      receiptId = receipt.receipt_id;
      const response = await computeAlternativeRoutes({ origin: originCoordinates!, destination: destinationCoordinates!, vehicle_type: vehicleValue, priority: 'high' });
      useStore.getState().setActiveRoute(response.primary); useStore.getState().setRouteOptions([response.primary, ...response.alternatives]);
      useStore.getState().setRouteResilience(response.resilience ?? null);
      setCalculatedInputs(`${originValue.trim()}|${destinationValue.trim()}|${vehicleValue}`);
      useProduct.getState().notify(`Corridor calculated · policy receipt ${receiptId}`);
    } catch (error) { setError(`${error instanceof Error ? error.message : "No route found."}${receiptId ? ` Policy receipt: ${receiptId}.` : ''}`); }
    finally { submitting.current = false; setBusy(false); }
  };
  const updateCoordinate = (field: 'origin' | 'destination', value: string) => {
    if (field === 'origin') setOrigin(value); else setDestination(value);
    setCoordinateErrors(current => ({ ...current, [field]: '' }));
    setError('');
  };
  const finishMapPick = (field: 'origin' | 'destination') => {
    setPick(null);
    requestAnimationFrame(() => (field === 'origin' ? originInput : destinationInput).current?.focus());
  };
  const routePoints = route?.waypoints || [];
  const checkpoints = cameras.filter((c) => routePoints.some((wp) => Math.hypot((wp.latitude - c.lat) * 111139, (wp.longitude - c.lng) * 92000) < 700)).slice(0, 5);
  const eta = route ? route.total_estimated_time_s / 60 : null;
    return <div className="p-screen p-emergency-screen"><PageHeading eyebrow="EMERGENCY DECISION SUPPORT" title="One corridor. One backup." subtitle="Compare routes and review evidence near the journey." action={<Badge tone="gray">Decision support</Badge>} /><form aria-busy={busy} className="p-dispatch-form" aria-labelledby="corridor-planner-title" onSubmit={event => void calculate(event)}>
  <div className="p-corridor-form-heading"><span aria-hidden="true"><Icon name="route" size={23} /></span><div><h2 id="corridor-planner-title">Plan the comparison</h2><p>Choose two points, review the source context and compare the available routes.</p></div></div>
  <label className="p-corridor-vehicle-field" htmlFor="corridor-vehicle-profile">Vehicle profile<select id="corridor-vehicle-profile" disabled={busy} value={vehicle} onChange={event => setVehicle(event.target.value as typeof vehicle)}><option value="ambulance">Ambulance</option><option value="fire_truck">Fire truck</option></select></label>
  <div className="p-corridor-points">
    <div className="p-corridor-point"><label htmlFor="corridor-origin"><span className="p-corridor-point-marker" aria-hidden="true">A</span>Origin</label><input id="corridor-origin" ref={originInput} aria-label="Origin coordinates" aria-describedby={coordinateErrors.origin ? 'dispatch-coordinate-help dispatch-origin-error' : 'dispatch-coordinate-help'} aria-invalid={Boolean(coordinateErrors.origin)} disabled={busy} required value={origin} onChange={event => updateCoordinate('origin', event.target.value)} placeholder="34.0437, -118.2505" />{coordinateErrors.origin && <small id="dispatch-origin-error" className="p-coordinate-error">{coordinateErrors.origin}</small>}<button type="button" className="p-pick-button" disabled={busy} onClick={() => setPick('origin')} aria-pressed={pick === 'origin'} aria-label="Choose origin on map" aria-controls="corridor-comparison-map"><Icon name="pin" size={14} />{pick === 'origin' ? 'Selecting origin…' : 'Choose on map'}</button></div>
    <span className="p-corridor-points-link" aria-hidden="true"><Icon name="arrow" size={20} /></span>
    <div className="p-corridor-point"><label htmlFor="corridor-destination"><span className="p-corridor-point-marker destination" aria-hidden="true">B</span>Destination</label><input id="corridor-destination" ref={destinationInput} aria-label="Destination coordinates" aria-describedby={coordinateErrors.destination ? 'dispatch-coordinate-help dispatch-destination-error' : 'dispatch-coordinate-help'} aria-invalid={Boolean(coordinateErrors.destination)} disabled={busy} required value={destination} onChange={event => updateCoordinate('destination', event.target.value)} placeholder="34.0533, -118.2657" />{coordinateErrors.destination && <small id="dispatch-destination-error" className="p-coordinate-error">{coordinateErrors.destination}</small>}<button type="button" className="p-pick-button" disabled={busy} onClick={() => setPick('destination')} aria-pressed={pick === 'destination'} aria-label="Choose destination on map" aria-controls="corridor-comparison-map"><Icon name="pin" size={14} />{pick === 'destination' ? 'Selecting destination…' : 'Choose on map'}</button></div>
  </div>
  <p id="dispatch-coordinate-help" className="p-corridor-coordinate-help">Use decimal latitude, longitude (for example, 34.0437, -118.2505), or choose each point on the map.{!route && ' The initial points are Downtown Los Angeles examples; replace them with the locations you want to compare.'}</p>
  <PolicyAcceptanceFields formType="emergency_corridor" operatorReference={policy.operatorReference} onOperatorReference={policy.setOperatorReference} termsAccepted={policy.termsAccepted} onTermsAccepted={policy.setTermsAccepted} privacyAcknowledged={policy.privacyAcknowledged} onPrivacyAcknowledged={policy.setPrivacyAcknowledged} disabled={busy} />
  <div className="p-corridor-form-action"><p><Icon name="shield" size={16} />Route estimates support human review. They do not dispatch a unit.</p><button className="p-button primary" disabled={busy || !policy.termsAccepted || !policy.privacyAcknowledged || policy.operatorReference.trim().length < 2}>{busy ? 'Calculating…' : 'Calculate corridor'}<Icon name={busy ? 'clock' : 'route'} /></button></div>
</form>{error && <p className="p-inline-error" role="alert">{error}</p>}{routeInputsChanged && <div className="p-route-input-notice" role="status"><Icon name="info" size={19} /><div><strong>The displayed route uses earlier inputs</strong><p>The origin, destination or vehicle profile has changed. The map and estimates below still show the last calculated comparison; calculate again to use the new inputs.</p></div></div>}<div className="p-emergency-layout"><div><div ref={mapSection} id="corridor-comparison-map" className="p-emergency-map"><MapView route={route} onPick={pick && !busy ? (lat, lng) => { const value = `${lat.toFixed(6)},${lng.toFixed(6)}`; updateCoordinate(pick, value); finishMapPick(pick); } : undefined} />{pick && !busy && <div className="p-map-pick-hint" role="status">Select the {pick === 'origin' ? "origin" : "destination"}  on the map<button type="button" onClick={() => finishMapPick(pick)}>Cancel selection</button></div>}{route && <div className="p-route-key" aria-label="Calculated route legend"><span><i className="selected-route" />Selected route</span>{options.length > 1 && <span><i className="amber" />Other route options</span>}</div>}</div><Panel title="Sources near route points" action={<small>Approx. 700 m radius</small>}><p className="p-small-note">Sources are matched near route waypoints. Their location does not establish visual coverage or confirm road conditions.</p>{catalogFailed && checkpoints.length > 0 && <p className="p-small-note" role="status">The catalog refresh failed. These sources come from the last loaded catalog.</p>}{route ? checkpoints.length ? <div className="p-checkpoint-strip">{checkpoints.map((camera, i) => <div key={camera.id}><span className="p-checkpoint-label"><i>{i + 1}</i>{camera.name}</span><CameraThumb camera={camera} /><small>Video source · open to connect</small></div>)}</div> : <p className="p-small-note" role="status">{catalogFailed ? 'Camera source locations are unavailable. Retry the catalog connection before concluding that no sources are nearby.' : !catalogLoaded ? 'Loading camera source locations…' : 'No registered sources were found within the approximate search radius of these route points.'}</p> : <EmptyState title="Calculate a route to locate nearby sources" detail="Camera proximity does not confirm road coverage or conditions." />}</Panel></div><aside><Panel title="Route intelligence">{route ? <><div className="p-route-eta"><small>Engine estimated time</small><strong>{eta?.toFixed(1)}<span>min</span></strong><p>{(route.total_distance_m / 1000).toFixed(2)} km · {route.path_node_ids.length}  nodes</p></div><div className="p-route-assessment"><span>Topological continuity</span><b>{assessment?.score_pct ?? '—'}{assessment ? '%' : ''}</b><p>{assessment?.explanation || "No backup assessment available."}</p><small>This score measures overlap and detour; it is not an arrival probability.</small></div><div className="p-route-options" role="group" aria-label="Available route choices">{options.map((option, i) => <button type="button" key={option.route_id} aria-pressed={route.route_id === option.route_id} className={route.route_id === option.route_id ? 'selected' : ''} onClick={() => useStore.getState().setActiveRoute(option)}><span>{i === 0 ? "Primary" : `Backup ${i}`}<b>{(option.total_estimated_time_s / 60).toFixed(1)} min</b></span><small>{(option.total_distance_m / 1000).toFixed(2)}  km · view route</small></button>)}</div></> : <EmptyState title="Plan the journey" detail="Select an origin and destination within the Downtown Los Angeles network." />}</Panel><Panel title="Next check"><p className="p-detail-description">Query corridor cameras and confirmed closures before choosing a route.</p><button className="p-button" onClick={() => useProduct.getState().navigate('/risk-signals')}>Review signals <Icon name="arrow" /></button></Panel><div className="p-decision-notice"><Icon name="shield" size={22} /><p>Decision support for authorized operators. Estimates use graph speeds without live calibration. It does not dispatch units or control traffic signals.</p></div></aside></div></div>;
}

export function Cameras({ onConnect, onRetry }: { onConnect: () => void; onRetry: () => void }) {
  const district = useProduct((s) => s.district);
  const cameras = useProduct((s) => s.cameras);
  const catalogLoaded = useProduct((s) => s.cameraCatalogLoaded);
  const catalogFailed = useProduct((s) => s.cameraCatalogFailed);
  const catalogStatus = cameraCatalogStatus(cameras.length, catalogLoaded, catalogFailed);
  const query = useProduct((s) => s.query);
  const [filter, setFilter] = useState('all');
  const [zoneCoverage, setZoneCoverage] = useState<{ video_camera_count: number; calibrated_count: number; calibration_required_count: number; zone_required_count: number; route_metadata_required_count: number; cameras: { camera_id: string; zone_enabled: boolean; zone_revision: number; route_metadata_available: boolean; ready_for_road_analysis: boolean; status: string }[] } | null>(null);
  const favorites = useProduct((s) => s.favoriteCameras);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [favoriteNotice, setFavoriteNotice] = useState('');
  const [order, setOrder] = useState('recommended');
  const gallery = useRef<HTMLDivElement>(null);
  const toggleCatalogFavorite = (id: string, name: string, trigger: HTMLButtonElement) => {
    const previousButtons = Array.from(gallery.current?.querySelectorAll<HTMLButtonElement>('.p-favorite-button') || []);
    const position = previousButtons.indexOf(trigger);
    const removing = useProduct.getState().favoriteCameras.includes(id);
    useProduct.getState().toggleFavorite(id);
    setFavoriteNotice(`${name} ${removing ? 'removed from' : 'added to'} favorites.`);
    requestAnimationFrame(() => {
      if (trigger.isConnected) { trigger.focus({ preventScroll: true }); return; }
      const remaining = gallery.current?.querySelectorAll<HTMLButtonElement>('.p-favorite-button');
      const destination = remaining?.length ? remaining[Math.max(0, Math.min(position, remaining.length - 1))] : gallery.current;
      destination?.focus({ preventScroll: false });
    });
  };
  const [page, setPage] = useState(0);
  const scope = `${district}-${filter}-${query}-${favoritesOnly}-${order}`;
  const [pageScope, setPageScope] = useState(scope);
  useEffect(() => {
    const controller = new AbortController();
    fetch(apiUrl('/api/v1/mobility/video/analysis-zones'), { signal: controller.signal })
      .then(response => response.ok ? response.json() : Promise.reject(new Error('Zone coverage unavailable')))
      .then((value: typeof zoneCoverage) => setZoneCoverage(value))
      .catch(() => { if (!controller.signal.aborted) setZoneCoverage(null); });
    return () => controller.abort();
  }, [cameras.length]);
  const zoneByCamera = new Map((zoneCoverage?.cameras || []).map(zone => [zone.camera_id, zone]));
  const visible = cameras.filter((c) => (!favoritesOnly || favorites.includes(c.id)) && matchesZone(district, c.district) && `${c.name} ${c.provider} ${c.id} ${c.district} ${c.route || ''}`.toLowerCase().includes(query.toLowerCase()) && (filter === 'all' || filter === 'checked-video' && c.stream_url && hasPreviouslyVerifiedVideo(c) || filter === 'needs-calibration' && c.stream_url && zoneByCamera.get(c.id)?.ready_for_road_analysis === false)).sort((a, b) => order === 'name' ? a.name.localeCompare(b.name) : order === 'city' ? a.district.localeCompare(b.district) || a.name.localeCompare(b.name) : Number(favorites.includes(b.id)) - Number(favorites.includes(a.id)));
  const currentPage = pageScope === scope ? Math.min(page, Math.max(0, Math.ceil(visible.length / 12) - 1)) : 0;
  const pageItems = visible.slice(currentPage * 12, currentPage * 12 + 12);
  const hasCatalogFilters = district !== 'All districts' || filter !== 'all' || favoritesOnly || Boolean(query.trim());
  const resetCatalogFilters = () => {
    setFilter('all'); setFavoritesOnly(false); useProduct.getState().setDistrict('All districts'); useProduct.getState().setQuery('');
    requestAnimationFrame(() => gallery.current?.closest('.p-camera-catalog')?.querySelector<HTMLSelectElement>('.p-catalog-toolbar select')?.focus({ preventScroll: false }));
  };
  const navigatePage = (next: number) => { setPageScope(scope); setPage(next); requestAnimationFrame(() => { gallery.current?.focus({ preventScroll: true }); gallery.current?.scrollIntoView({ block: 'start', behavior: scrollBehavior(window.matchMedia('(prefers-reduced-motion: reduce)').matches) }); }); };
  const nextZoneCamera = nextCalibrationCamera(cameras, zoneCoverage?.cameras || []);
  const corridorProgress = calibrationCorridorProgress(cameras, zoneCoverage?.cameras || []);
  const pendingPlayback = calibrationPlaybackCoverage(cameras.filter(camera => camera.stream_url
    && zoneByCamera.get(camera.id)?.ready_for_road_analysis !== true));
  const startCalibrationQueue = () => {
    setFilter('needs-calibration');
    setFavoritesOnly(false);
    if (nextZoneCamera) useProduct.getState().navigate('/cameras/' + nextZoneCamera.id + '?calibrate=road&queue=1');
  };
  return <div className="p-screen p-camera-catalog"><span className="p-sr-only" role="status" aria-live="polite">{favoriteNotice}</span><PageHeading eyebrow="WINDOWS INTO THE CITY" title="Camera sources" subtitle="Find a video source, review its availability and open its evidence." action={<><button className="p-button" onClick={() => useProduct.getState().navigate('/explore')}><Icon name="map" />Explore by street</button><button className="p-button primary" onClick={onConnect}><Icon name="plus" />Connect a source</button></>} /><div className="p-camera-intro"><Icon name="shield" size={24} /><p><b>A real source. A verifiable observation.</b>  Open a camera to watch continuous video with vehicle tracking. Source availability is checked when you connect.</p><a className="p-text-button" href="https://quickmap.dot.ca.gov/" target="_blank" rel="noreferrer">Caltrans QuickMap <Icon name="arrow" size={14} /></a></div><div className="p-region-explorer" role="group" aria-label="Catalog areas"><button aria-pressed={district === "All districts"} className={district === "All districts" ? 'active' : ''} onClick={() => useProduct.getState().setDistrict("All districts")}>Entire region <b>{catalogLoaded && !catalogFailed ? cameras.length : '—'}</b></button>{regions.map(region => <button key={region.name} aria-pressed={district === region.name} className={district === region.name ? 'active' : ''} onClick={() => { useProduct.getState().setDistrict(region.name); }}> {region.name}<b>{catalogLoaded && !catalogFailed ? cameras.filter(c => matchesZone(region.name, c.district)).length : '—'}</b></button>)}</div><div className="p-regional-summary"><strong>Source availability</strong>Registered sources may show temporary notices. A registered link does not guarantee playback. Open the camera to establish a video session.</div>{zoneCoverage && zoneCoverage.calibration_required_count > 0 && <div className="p-calibration-banner" role="status"><div><span className="p-eyebrow">DIRECTIONAL ROAD ANALYSIS</span><strong>{zoneCoverage.calibrated_count} of {zoneCoverage.video_camera_count} video cameras ready for road analysis</strong><p>Only cameras with a reviewed zone, route and travel direction can contribute directional traffic estimates. {zoneCoverage.zone_required_count} camera zones need review; {zoneCoverage.route_metadata_required_count} lack route/direction metadata. {pendingPlayback.previouslyVerified} pending feeds had a successful link check and still need video and lane review; {pendingPlayback.playbackCheckRequired} require playback verification first.</p><details className="p-corridor-calibration"><summary><span>Route and direction progress</span><small>{corridorProgress.filter(group => group.pending > 0).length} corridors need review</small></summary><div className="p-corridor-progress-list">{corridorProgress.filter(group => group.pending > 0).map(group => { const camera = group.next_camera; return <div className="p-corridor-progress-row" key={group.key}><div><b>{group.route} · {group.direction}</b><small>{group.ready} of {group.total} cameras ready</small></div>{camera && <button className="p-text-button" aria-label={`Review next camera on ${group.route} ${group.direction}: ${camera.name}`} onClick={() => useProduct.getState().navigate(`/cameras/${camera.id}?calibrate=road&queue=1`)}>Review next <span>{camera.name}</span></button>}</div>; })}</div></details></div><div className="p-calibration-actions"><button className="p-button primary" disabled={!nextZoneCamera} onClick={startCalibrationQueue}>{nextZoneCamera ? 'Start calibration queue' : 'No video sources to calibrate'} <Icon name="arrow" size={15} /></button><button className="p-button" onClick={() => { setFilter('needs-calibration'); setFavoritesOnly(false); }}>Review camera list</button></div></div>}<section className="p-catalog-toolbar" aria-label="Camera catalog filters">
  <div className="p-catalog-toolbar-heading"><div><span className="p-eyebrow">FIND A SOURCE</span><h2>Choose what to review</h2></div><span className="p-catalog-match-count" role="status">{catalogFailed ? cameras.length ? `${visible.length} last loaded matches` : 'Sources unavailable' : !catalogLoaded ? 'Loading sources…' : `${visible.length} matching ${visible.length === 1 ? 'source' : 'sources'}`}</span></div>
  <div className="p-filter-bar"><label>Source filter<select value={filter} onChange={event => setFilter(event.target.value)}><option value="all">All registered sources</option><option value="checked-video">Video link responded previously</option><option value="needs-calibration" disabled={!zoneCoverage}>Needs road calibration</option></select></label><label>Sort by<select value={order} onChange={event => setOrder(event.target.value)}><option value="recommended">Favorites first</option><option value="name">Name</option><option value="city">City</option></select></label><button type="button" className={`p-button p-catalog-favorites ${favoritesOnly ? 'primary' : ''}`} aria-pressed={favoritesOnly} aria-describedby="catalog-favorites-help" title="Favorites saved in this browser" onClick={() => setFavoritesOnly(!favoritesOnly)}><Icon name="star" size={16} />My favorites<span>{favorites.length}</span></button></div>
  {hasCatalogFilters && <div className="p-catalog-active-filters" aria-label="Active camera filters" onClick={event => {
    const trigger = (event.target as HTMLElement).closest('button');
    requestAnimationFrame(() => {
      if (trigger && !trigger.isConnected && document.activeElement === document.body) gallery.current?.closest('.p-camera-catalog')?.querySelector<HTMLSelectElement>('.p-catalog-toolbar select')?.focus({ preventScroll: false });
    });
  }}>{district !== 'All districts' && <button type="button" aria-label={`Clear area filter: ${district}`} onClick={() => useProduct.getState().setDistrict('All districts')}><Icon name="pin" size={13} /><span>{district}</span><Icon name="close" size={12} /></button>}{query.trim() && <button type="button" aria-label={`Clear camera search: ${query}`} onClick={() => useProduct.getState().setQuery('')}><Icon name="search" size={13} /><span>“{query}”</span><Icon name="close" size={12} /></button>}{filter !== 'all' && <button type="button" aria-label="Clear source filter" onClick={() => setFilter('all')}><span>{filter === 'checked-video' ? 'Previous URL response' : 'Needs calibration'}</span><Icon name="close" size={12} /></button>}{favoritesOnly && <button type="button" aria-label="Show all cameras instead of favorites only" onClick={() => setFavoritesOnly(false)}><Icon name="star" size={13} /><span>Favorites only</span><Icon name="close" size={12} /></button>}<button type="button" className="p-catalog-reset" onClick={resetCatalogFilters}>Clear filters</button></div>}
  <p id="catalog-favorites-help" className={favoritesOnly ? 'p-catalog-favorite-help' : 'p-sr-only'}>Favorites are saved in this browser. The count includes saved references that may no longer appear in the loaded catalog.</p>
  <p className="p-catalog-source-guidance"><Icon name="info" size={14} />A previous URL response does not confirm current video playback. Open a source to review it.</p>
</section><div className="p-catalog-results-heading"><h2>Registered sources</h2><span role="status">{catalogStatus === 'loading' ? 'Loading catalog…' : catalogFailed ? 'Catalog refresh unavailable; listed sources may be out of date' : visible.length ? `${currentPage * 12 + 1}–${Math.min((currentPage + 1) * 12, visible.length)} of ${visible.length} matching sources` : 'No matching sources'}</span></div><div ref={gallery} className="p-camera-grid" role="region" aria-label="Camera catalog results" tabIndex={-1}>{pageItems.map((camera, i) => { const zone = zoneByCamera.get(camera.id); const autoOpenCalibration = hasPreviouslyVerifiedVideo(camera); return <article key={camera.id} className="p-camera-tile" aria-labelledby={`catalog-camera-title-${camera.id}`}>
  <CameraThumb camera={camera} showDetailsAction={false} />
  <div className="p-camera-card-body"><div className="p-camera-card-heading"><div><span className="p-eyebrow">{camera.provider} · {String(currentPage * 12 + i + 1).padStart(2, '0')}</span><h3 id={`catalog-camera-title-${camera.id}`}>{camera.name}</h3><p><Icon name="pin" size={12} />{camera.district}</p></div><button type="button" className="p-favorite-button" title="Favorite preference saved in this browser" aria-label={`${favorites.includes(camera.id) ? 'Remove from favorites' : 'Save favorite'}: ${camera.name}`} aria-pressed={favorites.includes(camera.id)} onClick={event => toggleCatalogFavorite(camera.id, camera.name, event.currentTarget)}><Icon name="star" size={17} /><span>{favorites.includes(camera.id) ? 'Saved' : 'Save'}</span></button></div>
    <p className="p-camera-status-note"><Badge tone={cameraStatus(camera).tone}>{cameraStatus(camera).label}</Badge><small>{checkedAt(camera.last_observed_at || camera.verified_at)}</small></p>
    {zoneCoverage && camera.stream_url && <p className="p-camera-zone-note"><Badge tone={zone?.ready_for_road_analysis ? 'green' : 'amber'}>{zone?.ready_for_road_analysis ? `Road analysis ready · v${zone.zone_revision}` : zone?.status === 'zone_and_metadata_required' ? 'Zone + route metadata required' : zone?.status === 'route_metadata_required' ? 'Route/direction metadata required' : 'Direction zone required'}</Badge></p>}
    {zoneCoverage && camera.stream_url && !zone?.ready_for_road_analysis && <div className="p-camera-calibration-prompt"><button className="p-text-button p-calibration-action" onClick={() => useProduct.getState().navigate(`/cameras/${camera.id}${autoOpenCalibration ? '?calibrate=road' : ''}`)}><Icon name="camera" size={14} />{autoOpenCalibration ? 'Watch video and set direction zone' : 'Check live video before calibration'}</button>{!autoOpenCalibration && <small className="p-camera-calibration-note">Calibration tools open from the live video after playback is confirmed.</small>}{zone?.status === 'zone_and_metadata_required' && <small className="p-camera-calibration-note">Route and direction metadata also need review.</small>}</div>}
    <footer><Badge tone="gray">{camera.stream_url ? hasPreviouslyVerifiedVideo(camera) ? 'Link responded previously · playback unconfirmed' : 'Video not yet verified' : 'Video not supported'}</Badge><button className="p-text-button" aria-label={`Open evidence for ${camera.name}`} onClick={() => useProduct.getState().navigate(`/cameras/${camera.id}`)}>Open evidence<Icon name="arrow" size={15} /></button></footer>
  </div>
</article>; })}</div>{visible.length > 12 && <nav className="p-catalog-pagination" aria-label="Camera catalog pages"><button className="p-button" disabled={currentPage === 0} onClick={() => navigatePage(currentPage - 1)}>Previous</button><span role="status">{currentPage * 12 + 1} - {Math.min((currentPage + 1) * 12, visible.length)} of {visible.length}</span><button className="p-button" disabled={(currentPage + 1) * 12 >= visible.length} onClick={() => navigatePage(currentPage + 1)}>Next</button></nav>}{!visible.length && catalogStatus === 'loading' && <EmptyState title="Loading cameras" detail="Connecting to the camera catalog. The source list will appear here shortly." />}{!visible.length && catalogStatus === 'error' && <EmptyState icon="camera" title="Camera catalog is unavailable" detail="The camera catalog could not be reached. Retry the connection, or learn how to review video and evidence while source availability remains uncertain." action={<><button className="p-button primary" onClick={onRetry}><Icon name="refresh" size={15} />Retry camera connection</button><button className="p-button" onClick={event => { useProduct.getState().startTour(event.currentTarget); useProduct.getState().setDemoIndex(2); }}><Icon name="play" size={15} />Learn camera evidence</button></>} />}{!visible.length && catalogStatus === 'empty' && <EmptyState title="No video sources registered" detail="Connect a public video source or retry after checking the camera service." action={<button className="p-button primary" onClick={onConnect}><Icon name="plus" />Connect a source</button>} />}{!visible.length && catalogStatus === 'ready' && <EmptyState title="No registered sources for this filter" detail="No loaded sources match the current search and filters. Clear them to browse the loaded catalog." action={<button className="p-button" onClick={resetCatalogFilters}>View the entire catalog</button>} />}</div>;

}

export function ConnectDialog({ onClose }: { onClose: () => void }) {

  const dialog = useRef<HTMLDialogElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const sourceInput = useRef<HTMLInputElement>(null);
  const latitudeInput = useRef<HTMLInputElement>(null);
  const longitudeInput = useRef<HTMLInputElement>(null);
  const validationFocusTarget = useRef<HTMLInputElement | null>(null);
  const [name, setName] = useState(''); const [source, setSource] = useState('');
  const [lat, setLat] = useState(''); const [lng, setLng] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<CameraConnectionErrors>({});
  const submitting = useRef(false);
  const policy = usePolicyChoices();
  useEffect(() => { dialog.current?.showModal(); nameInput.current?.focus(); }, []);
  useEffect(() => { const target = validationFocusTarget.current; validationFocusTarget.current = null; target?.focus(); }, [fieldErrors]);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (submitting.current) return;
    const request = { name: name.trim(), source: source.trim(), lat: lat.trim(), lng: lng.trim() };
    const validation = validateCameraConnection(request);
    setFieldErrors(validation);
    const invalidRef = validation.name ? nameInput : validation.source ? sourceInput : validation.lat ? latitudeInput : validation.lng ? longitudeInput : null;
    if (invalidRef) { validationFocusTarget.current = invalidRef.current; return; }
    const policyChoices = { form_type: 'camera_connection' as const, operator_reference: policy.operatorReference.trim(), terms_accepted: policy.termsAccepted, privacy_acknowledged: policy.privacyAcknowledged };
    if (!policyChoices.terms_accepted || !policyChoices.privacy_acknowledged || policyChoices.operator_reference.length < 2) {
      setError('Complete the operator reference and both policy choices before connecting this camera.');
      return;
    }
    submitting.current = true; setBusy(true); setError('');
    let receiptId = '';
    try {
      const receipt = await recordPolicyAcceptance(policyChoices);
      receiptId = receipt.receipt_id;
      const camera = await connectCamera({ name: request.name, source: request.source, lat: Number(request.lat), lng: Number(request.lng) });
      const catalog = await refreshCameraCatalogAfterConnect(camera, useProduct.getState().cameras, getCameras);
      const product = useProduct.getState();
      product.setCameras(catalog.cameras);
      product.setCameraCatalogStatus(catalog.refreshed, !catalog.refreshed);
      if (catalog.refreshed) product.notify(`Video source connected · policy receipt ${receiptId}`);
      else {
        const message = `Camera ${camera.id} is connected, but its catalog could not refresh. Use Retry connection before trying to connect it again.`;
        product.setError(message);
        product.notify(`${message} Policy receipt ${receiptId}.`);
      }
      onClose();
      product.navigate(`/cameras/${camera.id}`);
    }
    catch (error) {
      const detail = error instanceof Error ? error.message : 'Could not connect.';
      setError(receiptId ? `Policy choices were recorded · receipt ${receiptId}. Camera connection was not confirmed: ${detail}` : detail);
    }
    finally { submitting.current = false; setBusy(false); }
  };
  return <dialog ref={dialog} className="p-dialog p-connect-dialog" aria-labelledby="connect-camera-title" aria-describedby="connect-camera-description" onCancel={event => { if (busy) event.preventDefault(); else onClose(); }}>
    <form aria-busy={busy} onSubmit={event => void submit(event)}>
      <header><span className="p-connect-header-mark" aria-hidden="true"><Icon name="camera" size={23} /></span><span className="p-eyebrow">NEW VIDEO SOURCE</span><button type="button" className="p-icon-button" aria-label="Close connection dialog" disabled={busy} onClick={onClose}><Icon name="close" /></button><h2 id="connect-camera-title">Connect a camera</h2><p id="connect-camera-description">Add its video address and map location. The connection is saved after continuous video decoding is verified.</p></header>
      <div className="p-connect-body">
        <fieldset className="p-connect-section"><legend><span aria-hidden="true">01</span>Source details</legend><p className="p-connect-section-description">The camera name, source address and both location fields are required.</p>
          <label htmlFor="camera-connection-name">Camera name<input id="camera-connection-name" autoComplete="off" ref={nameInput} disabled={busy} required minLength={2} maxLength={120} aria-invalid={Boolean(fieldErrors.name)} aria-describedby={`camera-name-hint${fieldErrors.name ? ' camera-name-error' : ''}`} value={name} onChange={event => { setName(event.target.value); setFieldErrors(current => ({ ...current, name: undefined })); }} placeholder="Corridor access point" /><small id="camera-name-hint">Choose a name you will recognize in the camera catalog.</small>{fieldErrors.name && <small id="camera-name-error" className="p-form-field-error">{fieldErrors.name}</small>}</label>
          <label htmlFor="camera-connection-source">Video address or webcam index<input id="camera-connection-source" ref={sourceInput} disabled={busy} required maxLength={500} inputMode="url" autoComplete="off" autoCapitalize="none" spellCheck={false} aria-invalid={Boolean(fieldErrors.source)} aria-describedby={`camera-source-hint${fieldErrors.source ? ' camera-source-error' : ''}`} value={source} onChange={event => { setSource(event.target.value); setFieldErrors(current => ({ ...current, source: undefined })); }} placeholder="https://…/playlist.m3u8 or 0" /><small id="camera-source-hint">Use a continuous HTTP(S) or RTSP video stream, or a webcam index such as 0. Still-image addresses are not supported.</small>{fieldErrors.source && <small id="camera-source-error" className="p-form-field-error">{fieldErrors.source}</small>}</label>
          <div className="p-connect-source-note"><Icon name="info" size={17} /><p>Use a source you are authorized to query. Do not include passwords in the address. RTSP and webcams are read from the machine running FlowSense.</p></div>
        </fieldset>
        <fieldset className="p-connect-section"><legend><span aria-hidden="true">02</span>Map location</legend><p id="camera-location-hint" className="p-connect-section-description">Enter latitude first, then longitude, in decimal degrees. South and west coordinates use a minus sign. A map location does not confirm which road the camera can see.</p>
          <div className="p-form-two"><label htmlFor="camera-connection-latitude">Latitude<input id="camera-connection-latitude" ref={latitudeInput} disabled={busy} required type="number" inputMode="decimal" step="any" min="-90" max="90" placeholder="e.g. 34.048" aria-invalid={Boolean(fieldErrors.lat)} aria-describedby={`camera-location-hint${fieldErrors.lat ? ' camera-latitude-error' : ''}`} value={lat} onChange={event => { setLat(event.target.value); setFieldErrors(current => ({ ...current, lat: undefined })); }} />{fieldErrors.lat && <small id="camera-latitude-error" className="p-form-field-error">{fieldErrors.lat}</small>}</label><label htmlFor="camera-connection-longitude">Longitude<input id="camera-connection-longitude" ref={longitudeInput} disabled={busy} required type="number" inputMode="decimal" step="any" min="-180" max="180" placeholder="e.g. -118.259" aria-invalid={Boolean(fieldErrors.lng)} aria-describedby={`camera-location-hint${fieldErrors.lng ? ' camera-longitude-error' : ''}`} value={lng} onChange={event => { setLng(event.target.value); setFieldErrors(current => ({ ...current, lng: undefined })); }} />{fieldErrors.lng && <small id="camera-longitude-error" className="p-form-field-error">{fieldErrors.lng}</small>}</label></div>
        </fieldset>
        <PolicyAcceptanceFields formType="camera_connection" operatorReference={policy.operatorReference} onOperatorReference={policy.setOperatorReference} termsAccepted={policy.termsAccepted} onTermsAccepted={policy.setTermsAccepted} privacyAcknowledged={policy.privacyAcknowledged} onPrivacyAcknowledged={policy.setPrivacyAcknowledged} disabled={busy} />
        {error && <p className="p-inline-error" role="alert">{error}</p>}
      </div>
      <footer><span className="p-connect-submit-note">{busy ? 'Checking the video source. Keep this dialog open.' : 'Your policy choices are recorded with the submission.'}</span><button type="button" className="p-button" disabled={busy} onClick={onClose}>Cancel</button><button className="p-button primary" disabled={busy || !policy.termsAccepted || !policy.privacyAcknowledged || policy.operatorReference.trim().length < 2}>{busy ? 'Checking video…' : 'Check and connect'}<span className={busy ? 'p-request-progress' : undefined} aria-hidden="true"><Icon name={busy ? 'refresh' : 'arrow'} /></span></button></footer>
    </form>
  </dialog>;
}

export function Reports({ onRetry, retrying }: { onRetry: () => void; retrying: boolean }) {
  const cases = useProduct(s => s.cases);
  const casesLoaded = useProduct(s => s.casesLoaded);
  const casesLoadStatus = useProduct(s => s.casesLoadStatus);
  const caseExports = caseExportAvailability(casesLoadStatus, casesLoaded);
  const printedCaseStatus = caseReportStatus(casesLoadStatus, casesLoaded, cases.length);
  const mode = useProduct(s => s.mode);
  const [type, setType] = useState('Operational situation');
  const period = useProduct(s => s.period);
  const reportTypes = [
    { name: 'Operational situation', icon: 'map', description: 'Frame the saved case record for a regional discussion.' },
    { name: 'Corridor', icon: 'route', description: 'Give the saved case report a corridor-focused title.' },
    { name: 'Risk review', icon: 'alert', description: 'Label the saved record for a risk-review discussion.' },
  ];
  const caseCountLabel = casesLoaded
    ? `${cases.length} ${casesLoadStatus === 'ready' ? 'registered' : 'last loaded'} cases${casesLoadStatus === 'error' ? ' · refresh failed' : casesLoadStatus === 'refreshing' ? ' · refreshing' : ''}`
    : casesLoadStatus === 'loading' ? 'Loading cases…' : 'Cases unavailable';
  return <div className="p-screen p-reports">
    <PageHeading eyebrow="SHAREABLE EVIDENCE" title="From analysis to report" subtitle="Review the saved record, choose a format and make the next check clear." action={<><Badge tone="gray">{caseCountLabel}</Badge><a className="p-button" href="#report-export-options"><Icon name="download" size={15} />Export options</a></>} />
    <div className="p-report-layout">
      <section className="p-report-workspace" aria-label="Report preparation">
        <div className="p-report-step-heading"><span aria-hidden="true">01</span><div><h2>Choose your report title</h2><p>Each option uses the same saved cases and audit history. The title changes how you frame the report.</p></div></div>
        <div className="p-report-type-grid" role="group" aria-label="Report title">
          {reportTypes.map(option => <button key={option.name} type="button" aria-pressed={type === option.name} className={type === option.name ? 'selected' : ''} onClick={() => setType(option.name)}><span className="p-report-type-top"><span className="p-report-type-icon"><Icon name={option.icon} size={23} /></span><span className="p-report-type-selection" aria-hidden="true">{type === option.name ? <Icon name="check" size={13} /> : null}</span></span><h3>{option.name}</h3><p>{option.description}</p></button>)}
        </div>
        <div className="p-report-step-heading"><span aria-hidden="true">02</span><div><h2>Review what is included</h2><p>Check the case status and provenance before sharing the record.</p></div></div>
        <Panel title="Cases and decisions">
          {casesLoaded && <div className="p-report-provenance-summary" role="group" aria-label="Case origins in the loaded preview"><span><Icon name="camera" size={16} /><b>{cases.filter(item => item.data_origin === 'observation').length}</b> observation cases</span><span><Icon name="play" size={16} /><b>{cases.filter(item => item.data_origin === 'presentation').length}</b> scenario cases</span><small>Origins in the loaded preview · an illustrative case does not establish a current condition.</small></div>}
          <p className="p-table-scroll-hint" aria-hidden="true">Scroll table sideways to see all columns.</p>
          <div className="p-table-scroll" role="region" aria-label="Cases and decisions table; scroll horizontally for all columns" tabIndex={0}>
            {cases.length ? <table className="p-table"><caption className="p-sr-only">Loaded saved cases, responsible teams, review status and source provenance</caption><thead><tr><th scope="col">Case</th><th scope="col">Title</th><th scope="col">Team</th><th scope="col">Status</th><th scope="col">Provenance</th></tr></thead><tbody>{cases.map(item => <tr key={item.id}><td><b>{item.id}</b></td><td>{item.title}</td><td>{item.owner}</td><td><ReviewBadge value={item.status} /></td><td>{item.data_origin === 'presentation' ? 'Scenario' : 'Observation'}</td></tr>)}</tbody></table>
              : <EmptyState title={casesLoaded ? casesLoadStatus === 'ready' ? 'No cases have been opened yet' : 'No cases in the last successful load' : casesLoadStatus === 'loading' ? 'Loading saved cases' : 'Saved cases are not available yet'} detail={casesLoaded ? casesLoadStatus === 'ready' ? 'Assign a review from Hotspots or Risk signals.' : 'Retry the connection to confirm the current case list.' : casesLoadStatus === 'loading' ? 'Checking for saved cases. This report will update when the list loads.' : 'Wait for saved cases to load, or retry the connection before preparing your report.'} action={casesLoadStatus === 'error' ? <button className="p-button" disabled={retrying} onClick={onRetry}>{retrying ? 'Retrying…' : 'Retry connection'}<Icon name="arrow" /></button> : casesLoaded ? <button className="p-button" onClick={() => useProduct.getState().navigate('/risk-signals')}>Open review queue<Icon name="arrow" /></button> : undefined} />}
          </div>
        </Panel>
        {cases.length > 0 && <ReportAuditPreview cases={cases} />}
        <section className="p-report-sharing-note"><span aria-hidden="true"><Icon name="shield" size={22} /></span><div><h3>A useful report keeps its context.</h3><p>Keep the source, review decisions and remaining uncertainty together. A scenario example does not establish current conditions or a measured improvement.</p></div></section>
        <section className="p-print-report"><BrandMark size={48} /><h2>FlowSense · {type}</h2><p>Los Angeles, California · {period} · {new Date().toLocaleString('en-US')}</p><p>Mode: {mode === 'presentation' ? 'illustrative scenario' : 'observations'}. Source provenance is recorded with each saved case. Road network: OpenStreetMap.</p><p>Case data status: {printedCaseStatus}</p><p>Scenario indicators do not establish current conditions or pilot impact.</p>{cases.map(c => <article key={c.id}><h3>{c.id} · {c.title}</h3><p>{statusLabels[c.status]} · {c.owner} · provenance: {c.data_origin}</p>{c.audit.map((a, i) => <p key={i}>{a.at} · {a.action} · {a.owner} · {a.note}</p>)}</article>)}</section>
      </section>
      <aside id="report-export-options" className="p-report-export-sidebar" aria-label="Export options" tabIndex={-1}>
        <Panel title="Prepare export">
          <label className="p-report-field">Report title<select value={type} onChange={event => setType(event.target.value)}>{reportTypes.map(option => <option key={option.name}>{option.name}</option>)}</select></label>
          <dl className="p-report-context"><div><dt>Reference period</dt><dd>{period}</dd></div><div><dt>Region</dt><dd>Los Angeles, CA</dd></div><div><dt>{casesLoadStatus === 'ready' ? 'Cases' : 'Last loaded cases'}</dt><dd>{casesLoaded ? cases.length : '—'}</dd></div><div><dt>Workspace context</dt><dd>{mode === 'presentation' ? 'Illustrative scenario' : 'Available observations'}</dd></div></dl>
          <div className={`p-report-readiness ${caseExports.enabled ? 'ready' : ''}`} role="status"><Icon name={caseExports.enabled ? 'check' : casesLoadStatus === 'error' ? 'alert' : 'clock'} size={18} /><div><strong>{caseExports.enabled ? 'Case downloads available' : casesLoadStatus === 'error' ? 'Case downloads unavailable' : 'Waiting for case data'}</strong><p>{caseExports.message}</p>{casesLoadStatus === 'error' && <button type="button" className="p-text-button" disabled={retrying} onClick={onRetry}>{retrying ? 'Retrying…' : 'Retry connection'}<Icon name="refresh" size={14} /></button>}</div></div>
          <div className="p-report-downloads">
            {caseExports.enabled ? <><a className="p-button primary" href={apiUrl('/api/v1/mobility/reports/cases.csv')} download><Icon name="download" />Export cases CSV</a><a className="p-button" href={apiUrl(`/api/v1/mobility/reports/cases.pdf?title=${encodeURIComponent(type)}&period=${encodeURIComponent(period)}`)} download><Icon name="download" />Download PDF</a></> : <><button className="p-button primary" disabled title={caseExports.message}><Icon name="download" />Export cases CSV unavailable</button><button className="p-button" disabled title={caseExports.message}><Icon name="download" />Download PDF unavailable</button></>}
            <button className="p-button" onClick={() => window.print()}><Icon name="report" />Print / save PDF</button>
            <p className="p-report-format-note">CSV opens in a spreadsheet. PDF keeps a formatted case record. Browser printing also includes the case-data status shown here.</p>
          </div>
          <div className="p-report-scenario-export"><span className="p-eyebrow">SCENARIO SERIES</span><p>Illustrative analytics are exported separately from the saved case record.</p><button className="p-button" disabled={mode !== 'presentation'} onClick={() => downloadCsv('flowsense-analytics.csv', trendSeries().map(row => ({ report_type: type, period, district: useProduct.getState().district, data_origin: 'presentation', ...row })))}><Icon name="chart" />Export analytics CSV</button>{mode !== 'presentation' && <small>Available in presentation scenario mode.</small>}</div>
        </Panel>
        <Panel title="Before and after"><p className="p-detail-description">Measuring real impact requires a baseline, an implemented intervention and comparable traffic counts. The scenario shows the format; it does not establish municipal improvement.</p></Panel>
      </aside>
    </div>
  </div>;
}

export function Storyboard() {
  const state = useProduct();
  const icons = ['grid', 'search', 'camera', 'route', 'shield', 'report', 'map', 'camera', 'pin', 'walk', 'route', 'settings', 'grid'];
  const openTourStep = (step: typeof tourSteps[number]) => {
    if (step.route !== state.path) { state.navigate(step.route); return; }
    const target = document.querySelector<HTMLElement>(step.target);
    if (!target) return;
    target.scrollIntoView({ behavior: scrollBehavior(window.matchMedia('(prefers-reduced-motion: reduce)').matches), block: 'center' });
    if (!target.matches('button, input, select, a[href], textarea, [tabindex]')) target.tabIndex = -1;
    target.focus({ preventScroll: true });
  };
  return <div className="p-screen p-storyboard"><PageHeading eyebrow="EVIDENCE · CONTEXT · HUMAN REVIEW" title="From a question to a next step" subtitle="Find the right source, understand its limits and decide what to check next." action={<><button className="p-button primary" onClick={event => state.startTour(event.currentTarget)}>Start guided tour <Icon name="play" /></button><button className="p-button" onClick={() => state.navigate('/explore')}>Explore on my own</button></>} />
    <details className="fs-guide-index"><summary><span><Icon name="grid" size={18} /><strong>Find your way around</strong></span><span className="fs-guide-topic-count">{tourSteps.length} topics + glossary <Icon name="plus" size={15} /></span></summary><p>Follow the whole journey or jump to the feature you want to understand.</p><nav aria-label="Guide topics">{tourSteps.map((step, index) => <a key={step.title} href={`#guide-topic-${index + 1}`}><span aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>{step.title}<Icon name="arrow" size={13} /></a>)}<a href="#guide-glossary" onClick={() => document.getElementById('guide-glossary')?.closest('details')?.setAttribute('open', '')}><span aria-hidden="true"><Icon name="info" size={14} /></span>A few useful terms<Icon name="arrow" size={13} /></a></nav></details>
    <div className="fs-guide-flow" aria-label="Evidence journey">{tourSteps.map((step, index) => <article key={step.title} id={`guide-topic-${index + 1}`} tabIndex={-1}><div className="fs-guide-step-top"><span className="fs-guide-step-icon" aria-hidden="true"><Icon name={icons[index]} size={23} /></span><span className="p-eyebrow">{String(index + 1).padStart(2, '0')} / {tourSteps.length}</span></div><h2>{step.title}</h2><p>{step.detail}</p><div className="fs-guide-topic-actions"><button className="p-text-button" onClick={() => openTourStep(step)}>{step.action}<Icon name="arrow" size={15} /></button><button className="p-text-button fs-guide-topic-tour" aria-label={`Explain ${step.title} with highlighted controls`} onClick={event => { state.startTour(event.currentTarget); useProduct.getState().setDemoIndex(index); }}><Icon name="play" size={14} />Explain with highlights</button></div></article>)}</div>
    <GuideGlossary />
    <div className="fs-guide-notes"><section><h2>Observations and scenarios</h2><p>Public video depends on source availability. Saved evidence comes from an earlier session. Scenario indicators are illustrative and do not establish current conditions.</p><button className="p-button" onClick={() => { state.setMode('observed'); state.navigate('/cameras'); }}>Open observations</button>{state.mode === 'presentation' && <button className="p-text-button" onClick={() => state.setMode('observed')}>Return to observations</button>}</section><section><h2>Proximity is not coverage</h2><p>A nearby camera may face another road. Check its road link and calibrated viewing zone. If these are unavailable, coverage remains uncertain. Counts are evidence for review, not calibrated speed or whole-road occupancy.</p><button className="p-text-button" onClick={() => state.navigate('/watch')}>Compare on the observation desk <Icon name="arrow" /></button></section></div>
    <div className="p-story-principle"><BrandMark size={40} decorative /><div><h3>The next action is yours.</h3><p>Review the evidence, record uncertainty and share the next check. FlowSense does not dispatch teams or confirm incidents automatically.</p><button className="p-text-button" onClick={event => state.startTour(event.currentTarget)}>Take the tour again</button></div></div>
  </div>;
}

export function Settings({ onConnect }: { onConnect: () => void }) {
  const cameras = useProduct((s) => s.cameras);
  const mode = useProduct((s) => s.mode);
  const catalogLoaded = useProduct((s) => s.cameraCatalogLoaded);
  const catalogFailed = useProduct((s) => s.cameraCatalogFailed);
  const graph = useStore((s) => s.graphStatus);
  return <div className="p-screen p-settings-screen">
    <PageHeading eyebrow="SOURCES AND PREFERENCES" title="Settings" subtitle="Make the workspace comfortable, choose your context and understand your sources." />
    <ThemeSettings />
    <div className="p-settings-layout">
      <Panel title="Working mode">
        <p className="p-settings-intro">Choose the context that fits your next task. You can switch at any time.</p>
        <label className={`p-setting-option ${mode === 'presentation' ? 'selected' : ''}`}><span className="p-settings-option-icon"><Icon name="play" /></span><span className="p-settings-option-copy"><strong>Presentation scenario</strong><span>Explore the tools with illustrative examples and practice a review.</span></span><input type="radio" name="data-mode" aria-label="Use presentation scenario" checked={mode === 'presentation'} onChange={() => useProduct.getState().setMode('presentation')} /></label>
        <label className={`p-setting-option ${mode === 'observed' ? 'selected' : ''}`}><span className="p-settings-option-icon"><Icon name="camera" /></span><span className="p-settings-option-copy"><strong>Available observations</strong><span>Use connected sources and saved measurements. Missing data stays unavailable.</span></span><input type="radio" name="data-mode" aria-label="Use observations" checked={mode === 'observed'} onChange={() => useProduct.getState().setMode('observed')} /></label>
      </Panel>
      <Panel title="Road network and coverage">
        <p className="p-settings-intro">Source context for the workspace you are viewing.</p>
        <div className="p-health-rows"><span>Profile<b>{graph?.city || 'Querying…'}</b></span><span>Graph source<b>{graph ? (graph.is_synthetic ? 'Synthetic' : 'OpenStreetMap') : 'Unavailable'}</b></span><span>Nodes<b>{graph?.node_count?.toLocaleString('en-US') ?? '—'}</b></span><span>Segments<b>{graph?.edge_count?.toLocaleString('en-US') ?? '—'}</b></span><span>Public sources<b>{catalogFailed ? 'Unavailable' : catalogLoaded ? cameras.length.toLocaleString('en-US') : 'Loading…'}</b></span></div>
        <div className="p-settings-panel-action"><button className="p-button primary" onClick={onConnect}><Icon name="plus" />Connect a source</button><small>Add a supported video source to your workspace.</small></div>
      </Panel>
      <Panel title="Privacy and review">
        <div className="p-settings-privacy-note"><span className="p-settings-option-icon"><Icon name="shield" /></span><p>Review the evidence with care. Decisions remain with the operator.</p></div>
        <p className="p-detail-description">Observations are aggregated by class and frame. People and drivers are not identified. Public video may contain people or license plates; anonymization is not guaranteed.</p><p className="p-small-note">There is no automatic traffic signal control or autonomous dispatch. Cases record the operator's decisions.</p>
      </Panel>
      <Panel title="Keyboard shortcuts">
        <p className="p-settings-intro">Shortcuts stay out of text fields and modal forms.</p>
        <dl className="p-settings-shortcuts"><div><dt><kbd>/</kbd> or <kbd>Ctrl / ⌘</kbd> + <kbd>K</kbd></dt><dd>Focus workspace search</dd></div><div><dt><kbd>↑</kbd> <kbd>↓</kbd> then <kbd>Enter</kbd></dt><dd>Choose a search suggestion</dd></div><div><dt><kbd>Esc</kbd></dt><dd>Close search suggestions before returning to the page</dd></div><div><dt><kbd>←</kbd> <kbd>→</kbd></dt><dd>Move between tour steps when the guide card has focus</dd></div></dl>
      </Panel>
      <Panel title="Public sources">
        <p className="p-settings-intro">Open the original documentation to understand source coverage and attribution. Links open in a new tab.</p>
        <a className="p-source-link" href="https://cwwp2.dot.ca.gov/documentation/cctv/cctv.htm" target="_blank" rel="noreferrer"><span><strong>Caltrans CCTV</strong><small>Camera source documentation</small></span><Icon name="arrow" /></a>
        <a className="p-source-link" href="https://quickmap.dot.ca.gov/" target="_blank" rel="noreferrer"><span><strong>Caltrans QuickMap</strong><small>Public road and source context</small></span><Icon name="arrow" /></a>
        <a className="p-source-link" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer"><span><strong>OpenStreetMap</strong><small>Map data and attribution</small></span><Icon name="arrow" /></a>
      </Panel>
    </div>
  </div>;
}
