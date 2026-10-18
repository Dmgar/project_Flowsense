import { BrandMark } from '../components/BrandMark';
import { ThemeControl } from './ThemeControl';
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
import './theme.css';
import './brand.css';

const EvidenceExplorer = lazy(() => import('./EvidenceExplorer').then(module => ({ default: module.EvidenceExplorer })));
const ObservationDesk = lazy(() => import('./ObservationDesk').then(module => ({ default: module.ObservationDesk })));

const nav = [
  ['/overview', 'grid', "Overview"], ['/explore', 'search', "Explore streets"], ['/watch', 'camera', "Observation desk"], ['/map', 'map', "City map"], ['/cameras', 'camera', "Cameras"],
  ['/corridors/harbor', 'chart', "Corridors"], ['/hotspots', 'pin', "Hotspots"],
  ['/pedestrians', 'walk', "Pedestrian flow"], ['/risk-signals', 'alert', "Risk signals"],
  ['/emergency-corridor', 'route', "Emergencies"], ['/reports', 'report', "Reports"],
];

export default function ProductShell() {
  useTelemetrySocket();
  const state = useProduct();
  const input = useRef<HTMLInputElement>(null);
  const navigation = useRef<HTMLElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const content = useRef<HTMLElement>(null);
  const [connect, setConnect] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [mobileFilters, setMobileFilters] = useState(false);
  const [smallScreen, setSmallScreen] = useState(() => window.matchMedia('(max-width: 760px)').matches);
  const [time, setTime] = useState(new Date());
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const closePanels = () => { setMobileNav(false); setMobileFilters(false); setSearchOpen(false); };
    window.addEventListener('popstate', closePanels);
    return () => window.removeEventListener('popstate', closePanels);
  }, []);
  useEffect(() => {
    const results = document.querySelector('.p-search-results');
    if (!searchOpen || !results) return;
    const move = (event: KeyboardEvent) => {
      if (!['ArrowDown', 'ArrowUp', 'Escape'].includes(event.key)) return;
      const controls = [input.current, ...results.querySelectorAll<HTMLButtonElement>('button')].filter((element): element is HTMLInputElement | HTMLButtonElement => element !== null);
      const index = controls.indexOf(document.activeElement as HTMLInputElement | HTMLButtonElement);
      if (index < 0) return;
      event.preventDefault();
      if (event.key === 'Escape') { input.current?.focus(); setSearchOpen(false); return; }
      controls[(index + (event.key === 'ArrowDown' ? 1 : -1) + controls.length) % controls.length]?.focus();
    };
    window.addEventListener('keydown', move);
    return () => window.removeEventListener('keydown', move);
  }, [searchOpen, state.query, state.cameras]);
  const zones = Array.from(new Set([...zoneOptions, ...state.cameras.map(camera => camera.district), state.district]));
  useEffect(() => {
    if (!smallScreen || !mobileNav) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setMobileNav(false); }
      if (event.key !== 'Tab') return;
      const controls = Array.from(navigation.current?.querySelectorAll<HTMLElement>('button, a[href]') || []).filter(element => element.offsetParent !== null);
      const first = controls[0], last = controls[controls.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    navigation.current?.querySelector<HTMLElement>('button')?.focus();
    window.addEventListener('keydown', close);
    const trigger = menuButton.current;
    return () => { window.removeEventListener('keydown', close); trigger?.focus(); };
  }, [mobileNav, smallScreen]);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 760px)');
    const change = () => setSmallScreen(media.matches);
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, []);
  useEffect(() => {
    let active = true;
    let pending: AbortController | null = null;
    async function load() {
      if (pending) return;
      const controller = new AbortController();
      pending = controller;
      try {
        const [cameras, cases] = await Promise.all([getCameras(controller.signal), getCases(controller.signal)]);
        if (!active) return;
        useProduct.getState().setCameras(cameras); useProduct.getState().setCases(cases);
        useProduct.getState().setConnected(true); useProduct.getState().setError('');
      } catch { if (active) { useProduct.getState().setConnected(false); useProduct.getState().setError("No connection to FlowSense. Sources and cases will load when the connection is restored."); } }
      finally { if (pending === controller) pending = null; }
    }
    void load();
    const timer = window.setInterval(() => { setTime(new Date()); void load(); }, 30000);
    const shortcut = (event: KeyboardEvent) => { if ((event.key === '/' || (event.key.toLowerCase() === 'k' && (event.ctrlKey || event.metaKey))) && !(event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement)) { event.preventDefault(); input.current?.focus(); } };
    window.addEventListener('keydown', shortcut);
    window.addEventListener('online', load);
    const offline = () => { useProduct.getState().setConnected(false); useProduct.getState().setError('You are offline. Reconnect to refresh sources and cases.'); };
    window.addEventListener('offline', offline);
    return () => { active = false; pending?.abort(); window.clearInterval(timer); window.removeEventListener('keydown', shortcut); window.removeEventListener('online', load); window.removeEventListener('offline', offline); };
  }, [reload]);
  useEffect(() => { const timer = window.setTimeout(() => useProduct.getState().notify(''), 5000); return () => window.clearTimeout(timer); }, [state.toast]);
  useEffect(() => {
    content.current?.scrollTo({ top: 0 });
    const section = state.path.split('/')[1];
    const label = nav.find(([path]) => path.split('/')[1] === section)?.[2]
      || ({ settings: 'Settings', storyboard: 'How it works' } as Record<string, string>)[section]
      || (section ? 'Page not found' : 'Overview');
    document.title = `${label} | FlowSense`;
  }, [state.path]);
  const go = (path: string) => { setSearchOpen(false); state.navigate(path); setMobileNav(false); setMobileFilters(false); };
  const exploreSearch = () => { const query = state.query; state.setDistrict("All districts"); state.setMapFocus(null); go(`/explore?q=${encodeURIComponent(query)}`); };
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
    default: screen = <EmptyState title="This view does not exist" detail="Return to the overview to continue." action={<button className="p-button" onClick={() => go('/overview')}>Back</button>} />;
  }
  const searchResults = state.query.length > 1 ? [
    ...state.cameras.filter((c) => cameraMatches(c, state.query)).slice(0, 3).map((c) => ({ name: c.name, type: "Public camera", path: `/cameras/${c.id}`, icon: 'camera' })),
    ...(state.mode === 'presentation' ? signals : []).filter((s) => `${s.location} ${s.title}`.toLowerCase().includes(state.query.toLowerCase())).slice(0, 3).map((s) => ({ name: s.location, type: s.title, path: '/hotspots', icon: 'pin', signal: s.id })),
    ...nav.filter(([, , label]) => label.toLowerCase().includes(state.query.toLowerCase())).map(([path, icon, name]) => ({ name, path, type: "Module", icon })),
  ] : [];
  return <div className="p-platform">
    <a className="p-skip" href="#product-content">Skip to content</a><DataInitializer />
    <aside ref={navigation} id="workspace-navigation" className={`p-navigation ${mobileNav ? 'open' : ''}`} inert={smallScreen && !mobileNav} aria-hidden={smallScreen && !mobileNav}><button className="p-navigation-close p-icon-button" aria-label="Close navigation" onClick={() => setMobileNav(false)}><Icon name="close" /></button><button className="p-brand" onClick={() => go('/overview')} aria-label="FlowSense home"><span className="p-brand-symbol"><BrandMark size={38} decorative /></span><span>Flow<span>Sense</span><small>MOBILITY INTELLIGENCE</small></span></button><div className="p-region"><span>OPERATING AREA</span><b><i />Greater Los Angeles, CA</b><small>United States</small></div><nav aria-label="Main navigation">{nav.map(([path, icon, label]) => <button key={path} aria-label={label} title={label} aria-current={state.path.split('/')[1] === path.split('/')[1] ? 'page' : undefined} className={state.path.split('/')[1] === path.split('/')[1] ? 'active' : ''} onClick={() => go(path)}><Icon name={icon} size={19} /><span>{label}</span>{path === '/risk-signals' && state.cases.filter((c) => !['resolved', 'dismissed'].includes(c.status)).length > 0 && <b>{state.cases.filter((c) => !['resolved', 'dismissed'].includes(c.status)).length}</b>}</button>)}</nav><div className="p-navigation-bottom"><button className={parts[0] === 'storyboard' ? 'active' : ''} onClick={() => go('/storyboard')}><BrandMark size={18} decorative />How it works</button><button className={parts[0] === 'settings' ? 'active' : ''} onClick={() => go('/settings')}><Icon name="settings" />Settings</button><div className="p-nav-note"><span>LESS NOISE.</span><b>Better decisions.</b><small>Evidence · context · review</small></div></div></aside>
    <div className="p-workspace" inert={smallScreen && mobileNav}><header className="p-topbar"><button className="fs-mobile-brand" aria-label="FlowSense home" title="FlowSense home" onClick={() => go('/overview')}><BrandMark size={29} decorative /><span>FlowSense</span></button><button ref={menuButton} className="p-menu-button p-icon-button" onClick={() => setMobileNav(!mobileNav)} aria-label={mobileNav ? "Close navigation" : "Open navigation"} aria-expanded={mobileNav} aria-controls="workspace-navigation"><Icon name="grid" /></button><div className="p-search" role="search" onFocus={() => setSearchOpen(true)} onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) setSearchOpen(false); }}><Icon name="search" size={19} /><input ref={input} aria-label="Search for a camera, place or module" placeholder="Search for a street, freeway or camera…" value={state.query} onChange={(event) => { setSearchOpen(true); state.setQuery(event.target.value); }} onKeyDown={(e) => { if (e.key === 'Escape') { state.setQuery(''); setSearchOpen(false); } if (e.key === 'Enter' && state.query.trim().length > 1) exploreSearch(); }} /><kbd>/</kbd>{searchOpen && state.query.length > 1 && <div className="p-search-results"><button className="p-search-all" onClick={exploreSearch}><Icon name="map" /><span><b>Explore “{state.query}” on the map</b><small>All matching cameras and cameras near the street</small></span><Icon name="arrow" size={14} /></button>{searchResults.length ? searchResults.map((r, i) => <button key={`${r.path}-${i}`} onClick={() => { if ('signal' in r) state.selectSignal(r.signal as string); go(r.path); }}><Icon name={r.icon} /><span><b>{r.name}</b><small>{r.type}</small></span><Icon name="arrow" size={14} /></button>) : <p>No matches. Try another search.</p>}</div>}</div><div className="p-topbar-filters"><select aria-label="District" value={state.district} onChange={(e) => { state.setMapFocus(null); state.setDistrict(e.target.value); }}>{zones.map((d) => <option key={d}>{d}</option>)}</select><select aria-label="Period" value={state.period} onChange={(e) => state.setPeriod(e.target.value)}>{["Last 15 min", "Last hour", "Last 24 h", "Last 7 days"].map((p) => <option key={p}>{p}</option>)}</select></div><span className={`p-system-state ${state.connected ? '' : 'offline'}`}><i /><span>{state.connected ? "Service connected" : "Offline"}<small>{time.toLocaleTimeString("en-US", { hour: '2-digit', minute: '2-digit' })}</small></span></span><button className="p-mobile-filter-button p-icon-button" aria-label={mobileFilters ? "Hide filters" : "Show filters"} aria-expanded={mobileFilters} onClick={() => setMobileFilters(!mobileFilters)}><Icon name="layers" /></button><ThemeControl /><button className="p-profile" aria-label="Operator settings" onClick={() => go('/settings')}>OM</button></header>
      <div className="p-context-bar"><span><Icon name={!evidenceWorkspace && state.mode === 'presentation' ? 'play' : 'camera'} size={14} />{evidenceWorkspace ? "Public evidence · independent queries per camera" : state.mode === 'presentation' ? "Presentation view · illustrative indicators" : "Available observations · no invented indicators"}</span><button onClick={() => evidenceWorkspace ? go('/storyboard') : state.setMode(state.mode === 'presentation' ? 'observed' : 'presentation')}>{evidenceWorkspace ? "How to compare evidence" : state.mode === 'presentation' ? "View observations" : "View scenario"}<Icon name="arrow" size={13} /></button><button className="p-tour-trigger" onClick={() => { state.setMode('presentation'); state.setDemoIndex(0); go('/overview'); }}><Icon name="play" size={12} />Guided tour</button></div>
      <div className={`p-mobile-filters ${mobileFilters ? 'open' : ''}`}><label>District<select aria-label="District" value={state.district} onChange={(e) => { state.setMapFocus(null); state.setDistrict(e.target.value); }}>{zones.map((value) => <option key={value}>{value}</option>)}</select></label><label>Period<select aria-label="Period" value={state.period} onChange={(e) => state.setPeriod(e.target.value)}>{["Last 15 min", "Last hour", "Last 24 h", "Last 7 days"].map((value) => <option key={value}>{value}</option>)}</select></label></div><main ref={content} id="product-content" className="p-content" tabIndex={-1}>{state.error && <div className="p-connection-error" role="status"><Icon name="alert" /><span>{state.error}</span><button className="p-button" onClick={() => setReload(value => value + 1)}>Retry connection</button></div>}<Suspense fallback={<div className="p-screen" role="status"><EmptyState title="Preparing your workspace" detail="Loading exploration and evidence tools." /></div>}>{screen}</Suspense></main>
    </div>
    {mobileNav && <button className="p-nav-backdrop" aria-label="Close navigation" onClick={() => setMobileNav(false)} />}
    {state.toast && <div className="p-toast" role="status"><Icon name="check" />{state.toast}<button aria-label="Close notice" onClick={() => state.notify('')}><Icon name="close" size={14} /></button></div>}
    {step && <div className="p-tour"><div><Badge tone="green">{state.demoIndex + 1} / {demoSteps.length}</Badge><button aria-label="Close tour" onClick={() => state.setDemoIndex(-1)}><Icon name="close" size={15} /></button></div><h3>{step.title}</h3><p>{step.detail}</p><footer><button className="p-text-button" disabled={state.demoIndex === 0} onClick={() => { const index = state.demoIndex - 1; state.setDemoIndex(index); go(demoSteps[index].route); }}>Previous</button><button className="p-button primary" onClick={() => { if (state.demoIndex === demoSteps.length - 1) { state.setDemoIndex(-1); state.notify("Tour completed. You can keep exploring each module."); } else { const index = state.demoIndex + 1; state.setDemoIndex(index); go(demoSteps[index].route); } }}>{state.demoIndex === demoSteps.length - 1 ? "Finish" : "Next"}<Icon name="arrow" size={15} /></button></footer></div>}
    {connect && <ConnectDialog onClose={() => setConnect(false)} />}
  </div>;
}
