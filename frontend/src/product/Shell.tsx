import { zoneOptions } from './coverage';
import { cameraMatches } from './evidenceSearch';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { DataInitializer } from '../components/DataInitializer';
import { useTelemetrySocket } from '../hooks/useTelemetrySocket';
import { CameraEvidence } from './CameraEvidence';
import { demoSteps, signals } from './data';
import { getCameras, getCases } from './api';
import { useProduct } from './store';
import { Cameras, ConnectDialog, CorridorAnalytics, EmergencyCorridor, Hotspots, Overview, Pedestrians, Reports, Settings, Storyboard } from './Screens';
import { EmptyState, Icon, Badge } from './ui';
import './product.css';
import './evidence.css';

const EvidenceExplorer = lazy(() => import('./EvidenceExplorer').then(module => ({ default: module.EvidenceExplorer })));
const ObservationDesk = lazy(() => import('./ObservationDesk').then(module => ({ default: module.ObservationDesk })));

const nav = [
  ['/overview', 'grid', 'Vista general'], ['/explore', 'search', 'Explorar calles'], ['/watch', 'camera', 'Mesa de observación'], ['/map', 'map', 'Mapa urbano'], ['/cameras', 'camera', 'Cámaras'],
  ['/corridors/harbor', 'chart', 'Corredores'], ['/hotspots', 'pin', 'Puntos críticos'],
  ['/pedestrians', 'walk', 'Flujo peatonal'], ['/risk-signals', 'alert', 'Señales de riesgo'],
  ['/emergency-corridor', 'route', 'Emergencias'], ['/reports', 'report', 'Reportes'],
];

export default function ProductShell() {
  useTelemetrySocket();
  const state = useProduct();
  const input = useRef<HTMLInputElement>(null);
  const content = useRef<HTMLElement>(null);
  const [connect, setConnect] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [mobileFilters, setMobileFilters] = useState(false);
  const [smallScreen, setSmallScreen] = useState(() => window.matchMedia('(max-width: 760px)').matches);
  const [time, setTime] = useState(new Date());
  useEffect(() => {
    const media = window.matchMedia('(max-width: 760px)');
    const change = () => setSmallScreen(media.matches);
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, []);
  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const [cameras, cases] = await Promise.all([getCameras(), getCases()]);
        if (!active) return;
        useProduct.getState().setCameras(cameras); useProduct.getState().setCases(cases);
        useProduct.getState().setConnected(true); useProduct.getState().setError('');
      } catch { if (active) { useProduct.getState().setConnected(false); useProduct.getState().setError('No hay conexión con FlowSense. Las fuentes y los casos se cargarán al reconectar.'); } }
    }
    void load();
    const timer = window.setInterval(() => { setTime(new Date()); void load(); }, 30000);
    const shortcut = (event: KeyboardEvent) => { if ((event.key === '/' || (event.key.toLowerCase() === 'k' && (event.ctrlKey || event.metaKey))) && !(event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement)) { event.preventDefault(); input.current?.focus(); } };
    window.addEventListener('keydown', shortcut);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener('keydown', shortcut); };
  }, []);
  useEffect(() => { const timer = window.setTimeout(() => useProduct.getState().notify(''), 5000); return () => window.clearTimeout(timer); }, [state.toast]);
  useEffect(() => { content.current?.scrollTo({ top: 0 }); }, [state.path]);
  const go = (path: string) => { setSearchOpen(false); state.navigate(path); setMobileNav(false); setMobileFilters(false); };
  const exploreSearch = () => { const query = state.query; state.setDistrict('Todos los distritos'); state.setMapFocus(null); go(`/explore?q=${encodeURIComponent(query)}`); };
  const step = state.demoIndex >= 0 ? demoSteps[state.demoIndex] : null;
  const parts = state.path.split('/').filter(Boolean);
  const evidenceWorkspace = parts[0] === 'explore' || parts[0] === 'watch';
  let screen;
  switch (parts[0]) {
    case 'explore': screen = <EvidenceExplorer />; break;
    case 'watch': screen = <ObservationDesk />; break;
    case 'overview': case undefined: screen = <Overview />; break;
    case 'map': screen = <Overview mapOnly />; break;
    case 'cameras': screen = parts[1] ? <CameraEvidence key={parts[1]} cameraId={parts[1]} /> : <Cameras onConnect={() => setConnect(true)} />; break;
    case 'corridors': screen = <CorridorAnalytics key={parts[1]} id={parts[1]} />; break;
    case 'hotspots': screen = <Hotspots />; break;
    case 'risk-signals': screen = <Hotspots risk />; break;
    case 'pedestrians': screen = <Pedestrians />; break;
    case 'emergency-corridor': screen = <EmergencyCorridor />; break;
    case 'reports': screen = <Reports />; break;
    case 'storyboard': screen = <Storyboard />; break;
    case 'settings': screen = <Settings onConnect={() => setConnect(true)} />; break;
    default: screen = <EmptyState title="Esta vista no existe" detail="Vuelve a la vista general para continuar." action={<button className="p-button" onClick={() => go('/overview')}>Volver</button>} />;
  }
  const searchResults = state.query.length > 1 ? [
    ...state.cameras.filter((c) => cameraMatches(c, state.query)).slice(0, 3).map((c) => ({ name: c.name, type: 'Cámara pública', path: `/cameras/${c.id}`, icon: 'camera' })),
    ...(state.mode === 'presentation' ? signals : []).filter((s) => `${s.location} ${s.title}`.toLowerCase().includes(state.query.toLowerCase())).slice(0, 3).map((s) => ({ name: s.location, type: s.title, path: '/hotspots', icon: 'pin', signal: s.id })),
    ...nav.filter(([, , label]) => label.toLowerCase().includes(state.query.toLowerCase())).map(([path, icon, name]) => ({ name, path, type: 'Módulo', icon })),
  ] : [];
  return <div className="p-platform">
    <a className="p-skip" href="#product-content">Saltar al contenido</a><DataInitializer />
    <aside className={`p-navigation ${mobileNav ? 'open' : ''}`} inert={smallScreen && !mobileNav} aria-hidden={smallScreen && !mobileNav}><button className="p-brand" onClick={() => go('/overview')} aria-label="FlowSense inicio"><span className="p-brand-symbol"><Icon name="leaf" size={29} /></span><span>Flow<span>Sense</span><small>MOBILITY INTELLIGENCE</small></span></button><div className="p-region"><span>ÁMBITO DE OPERACIÓN</span><b><i />Gran Los Angeles, CA</b><small>Estados Unidos</small></div><nav aria-label="Navegación principal">{nav.map(([path, icon, label]) => <button key={path} aria-label={label} title={label} aria-current={state.path.split('/')[1] === path.split('/')[1] ? 'page' : undefined} className={state.path.split('/')[1] === path.split('/')[1] ? 'active' : ''} onClick={() => go(path)}><Icon name={icon} size={19} /><span>{label}</span>{path === '/risk-signals' && state.cases.filter((c) => !['resolved', 'dismissed'].includes(c.status)).length > 0 && <b>{state.cases.filter((c) => !['resolved', 'dismissed'].includes(c.status)).length}</b>}</button>)}</nav><div className="p-navigation-bottom"><button className={parts[0] === 'storyboard' ? 'active' : ''} onClick={() => go('/storyboard')}><Icon name="leaf" />Cómo funciona</button><button className={parts[0] === 'settings' ? 'active' : ''} onClick={() => go('/settings')}><Icon name="settings" />Configuración</button><div className="p-nav-note"><span>MENOS RUIDO.</span><b>Mejores decisiones.</b><small>Evidencia · contexto · revisión</small></div></div></aside>
    <div className="p-workspace"><header className="p-topbar"><button className="p-menu-button p-icon-button" onClick={() => setMobileNav(!mobileNav)} aria-label="Abrir navegación"><Icon name="grid" /></button><div className="p-search" role="search" onFocus={() => setSearchOpen(true)} onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) setSearchOpen(false); }}><Icon name="search" size={19} /><input ref={input} aria-label="Buscar cámara, lugar o módulo" placeholder="Buscar calle, autopista o cámara…" value={state.query} onChange={(event) => { setSearchOpen(true); state.setQuery(event.target.value); }} onKeyDown={(e) => { if (e.key === 'Escape') { state.setQuery(''); setSearchOpen(false); } if (e.key === 'Enter' && state.query.trim().length > 1) exploreSearch(); }} /><kbd>/</kbd>{searchOpen && state.query.length > 1 && <div className="p-search-results"><button className="p-search-all" onClick={exploreSearch}><Icon name="map" /><span><b>Explorar “{state.query}” en el mapa</b><small>Todas las cámaras coincidentes y próximas a la calle</small></span><Icon name="arrow" size={14} /></button>{searchResults.length ? searchResults.map((r, i) => <button key={`${r.path}-${i}`} onClick={() => { if ('signal' in r) state.selectSignal(r.signal as string); go(r.path); }}><Icon name={r.icon} /><span><b>{r.name}</b><small>{r.type}</small></span><Icon name="arrow" size={14} /></button>) : <p>Sin coincidencias. Prueba otra búsqueda.</p>}</div>}</div><div className="p-topbar-filters"><select aria-label="Distrito" value={state.district} onChange={(e) => { state.setMapFocus(null); state.setDistrict(e.target.value); }}>{zoneOptions.map((d) => <option key={d}>{d}</option>)}</select><select aria-label="Período" value={state.period} onChange={(e) => state.setPeriod(e.target.value)}>{['Últimos 15 min', 'Última hora', 'Últimas 24 h', 'Últimos 7 días'].map((p) => <option key={p}>{p}</option>)}</select></div><span className={`p-system-state ${state.connected ? '' : 'offline'}`}><i /><span>{state.connected ? 'Servicio conectado' : 'Sin conexión'}<small>{time.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}</small></span></span><button className="p-mobile-filter-button p-icon-button" aria-label="Mostrar filtros" aria-expanded={mobileFilters} onClick={() => setMobileFilters(!mobileFilters)}><Icon name="settings" /></button><button className="p-profile" aria-label="Configuración del operador" onClick={() => go('/settings')}>OM</button></header>
      <div className="p-context-bar"><span><Icon name={!evidenceWorkspace && state.mode === 'presentation' ? 'play' : 'camera'} size={14} />{evidenceWorkspace ? 'Evidencia pública · consultas independientes por cámara' : state.mode === 'presentation' ? 'Vista de presentación · indicadores ilustrativos' : 'Observaciones disponibles · sin indicadores inventados'}</span><button onClick={() => evidenceWorkspace ? go('/storyboard') : state.setMode(state.mode === 'presentation' ? 'observed' : 'presentation')}>{evidenceWorkspace ? 'Cómo contrastar evidencia' : state.mode === 'presentation' ? 'Ver observaciones' : 'Ver escenario'}<Icon name="arrow" size={13} /></button><button className="p-tour-trigger" onClick={() => { state.setMode('presentation'); state.setDemoIndex(0); go('/overview'); }}><Icon name="play" size={12} />Recorrido guiado</button></div>
      <div className={`p-mobile-filters ${mobileFilters ? 'open' : ''}`}><label>Distrito<select value={state.district} onChange={(e) => { state.setMapFocus(null); state.setDistrict(e.target.value); }}>{zoneOptions.map((value) => <option key={value}>{value}</option>)}</select></label><label>Período<select value={state.period} onChange={(e) => state.setPeriod(e.target.value)}>{['Últimos 15 min', 'Última hora', 'Últimas 24 h', 'Últimos 7 días'].map((value) => <option key={value}>{value}</option>)}</select></label></div><main ref={content} id="product-content" className="p-content" tabIndex={-1}>{state.error && <div className="p-connection-error" role="status"><Icon name="alert" />{state.error}</div>}<Suspense fallback={<div className="p-screen" role="status"><EmptyState title="Preparando el espacio de trabajo" detail="Cargando herramientas de exploración y evidencia." /></div>}>{screen}</Suspense></main>
    </div>
    {mobileNav && <button className="p-nav-backdrop" aria-label="Cerrar navegación" onClick={() => setMobileNav(false)} />}
    {state.toast && <div className="p-toast" role="status"><Icon name="check" />{state.toast}<button aria-label="Cerrar aviso" onClick={() => state.notify('')}><Icon name="close" size={14} /></button></div>}
    {step && <div className="p-tour"><div><Badge tone="green">{state.demoIndex + 1} / {demoSteps.length}</Badge><button aria-label="Cerrar recorrido" onClick={() => state.setDemoIndex(-1)}><Icon name="close" size={15} /></button></div><h3>{step.title}</h3><p>{step.detail}</p><footer><button className="p-text-button" disabled={state.demoIndex === 0} onClick={() => { const index = state.demoIndex - 1; state.setDemoIndex(index); go(demoSteps[index].route); }}>Anterior</button><button className="p-button primary" onClick={() => { if (state.demoIndex === demoSteps.length - 1) { state.setDemoIndex(-1); state.notify('Recorrido completado. Puedes seguir explorando cada módulo.'); } else { const index = state.demoIndex + 1; state.setDemoIndex(index); go(demoSteps[index].route); } }}>{state.demoIndex === demoSteps.length - 1 ? 'Terminar' : 'Siguiente'}<Icon name="arrow" size={15} /></button></footer></div>}
    {connect && <ConnectDialog onClose={() => setConnect(false)} />}
  </div>;
}
