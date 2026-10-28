import { BrandMark, BrandWordmark } from '../components/BrandMark';
import { ThemeControl } from './ThemeControl';
import { zoneOptions } from './coverage';
import { cameraMatches } from './evidenceSearch';
import { Fragment, lazy, Suspense, useEffect, useRef, useState } from 'react';
import { DataInitializer } from '../components/DataInitializer';
import { useTelemetrySocket } from '../hooks/useTelemetrySocket';
const CameraEvidence = lazy(() => import('./CameraEvidence').then(module => ({ default: module.CameraEvidence })));
import { MonitoringHeartbeat } from './MonitoringHeartbeat';
import { GuidedTour } from './GuidedTour';
import { JourneyNext } from './JourneyNext';
import { JourneyReady } from './JourneyReady';
import { JourneyWelcome } from './JourneyWelcome';
import { WorkspaceNotice } from './WorkspaceNotice';
import { WorkspaceLoading } from './WorkspaceLoading';
import { ConnectionNotice } from './ConnectionNotice';
import { PageReturn } from './PageReturn';
import { MissingView } from './MissingView';
import { LegalPage, LegalReviewPage } from './LegalPages';
import { nextSearchOption, searchReturnUrl, searchSubmitDestination } from './searchIntent';
import { signals } from './data';
import { getCameras, getCases } from './api';
import { useProduct } from './store';
import { Cameras, ConnectDialog, CorridorAnalytics, EmergencyCorridor, Hotspots, Overview, Pedestrians, Reports, Settings, Storyboard } from './Screens';
import { Icon } from './ui';
import './product.css';
import './evidence.css';
import './theme.css';
import './brand.css';
import './journey.css';
import './navigationSearch.css';
import './workspaceNavigation.css';
import './legal.css';
import './systemContrast.css';
import './narrowHeader.css';
import './overviewPolish.css';
import './workspaceHierarchy.css';
import './touchControls.css';

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
  const mobileFilterButton = useRef<HTMLButtonElement>(null);
  const content = useRef<HTMLElement>(null);
  const [tourScreens, setTourScreens] = useState<{ path: string; view: React.ReactNode }[]>([]);
  const [connect, setConnect] = useState(false);
  const connectTrigger = useRef<HTMLElement | null>(null);
  const previousTourIndex = useRef(state.demoIndex);
  const [searchOpen, setSearchOpen] = useState(false);
  const [activeSearchOption, setActiveSearchOption] = useState(-1);
  const [mobileNav, setMobileNav] = useState(false);
  const [mobileFilters, setMobileFilters] = useState(false);
  const [retryingConnection, setRetryingConnection] = useState(false);
  const pageAnnouncement = useRef<HTMLDivElement>(null);
  const previousPath = useRef(state.path);
  const wasTouring = useRef(false);
  const [smallScreen, setSmallScreen] = useState(() => window.matchMedia('(max-width: 760px)').matches);
  const [time, setTime] = useState(new Date());
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const closePanels = () => {
      const filtersWereOpen = smallScreen && mobileFilters;
      setMobileNav(false); setMobileFilters(false); setSearchOpen(false);
      if (filtersWereOpen) requestAnimationFrame(() => mobileFilterButton.current?.focus());
    };
    window.addEventListener('popstate', closePanels);
    return () => window.removeEventListener('popstate', closePanels);
  }, [mobileFilters, smallScreen]);
  const catalogConnectionLabel = state.cameraCatalogFailed ? 'Catalog unavailable' : !state.cameraCatalogLoaded ? 'Loading catalog' : state.connected ? 'Catalog connected' : 'Catalog refresh offline';
  const catalogConnectionDescription = `${catalogConnectionLabel}. This does not confirm video playback or saved-case availability. The clock shows device local time.`;
  const zones = Array.from(new Set([...zoneOptions, ...state.cameras.map(camera => camera.district), state.district]));
  const mobileFiltersActive = state.district !== 'All districts' || state.period !== 'Last 15 min';
  const mobileFilterSummary = [
    state.district !== 'All districts' ? state.district : null,
    state.period !== 'Last 15 min' ? state.period : null,
  ].filter(Boolean).join(', ');
  useEffect(() => {
    if (smallScreen && !mobileNav) return;
    navigation.current?.querySelector<HTMLElement>('nav [aria-current="page"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
  }, [state.path, smallScreen, mobileNav]);
  useEffect(() => {
    if (!smallScreen || !mobileNav) return;
    const previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setMobileNav(false); }
      if (event.key !== 'Tab') return;
      const controls = Array.from(navigation.current?.querySelectorAll<HTMLElement>('button, a[href]') || []).filter(element => element.offsetParent !== null);
      const first = controls[0], last = controls[controls.length - 1];
      if (!first || !last) return;
      const activeIndex = controls.indexOf(document.activeElement as HTMLElement);
      if (activeIndex < 0) { event.preventDefault(); (event.shiftKey ? last : first).focus(); }
      else if (event.shiftKey && activeIndex === 0) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && activeIndex === controls.length - 1) { event.preventDefault(); first.focus(); }
    };
    navigation.current?.querySelector<HTMLElement>('button')?.focus();
    window.addEventListener('keydown', close);
    const trigger = menuButton.current;
    return () => {
      window.removeEventListener('keydown', close);
      document.body.style.overflow = previousBodyOverflow;
      if (trigger?.isConnected && trigger.offsetParent !== null) trigger.focus();
    };
  }, [mobileNav, smallScreen]);
  useEffect(() => {
    if (!smallScreen || !mobileFilters) return;
    const close = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setMobileFilters(false);
      requestAnimationFrame(() => mobileFilterButton.current?.focus());
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [mobileFilters, smallScreen]);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 760px)');
    const change = () => {
      const isSmallScreen = media.matches;
      setSmallScreen(isSmallScreen);
      if (!isSmallScreen) {
        const focusWasInNavigation = navigation.current?.contains(document.activeElement) ?? false;
        const focusWasInMobileFilters = document.getElementById('workspace-mobile-filters')?.contains(document.activeElement) ?? false;
        setMobileNav(false); setMobileFilters(false); setSearchOpen(false);
        if (focusWasInNavigation) requestAnimationFrame(() => navigation.current?.querySelector<HTMLElement>('nav [aria-current="page"]')?.focus());
        else if (focusWasInMobileFilters) requestAnimationFrame(() => document.querySelector<HTMLElement>('.p-topbar-filters select[aria-label="District"]')?.focus());
      } else {
        const focusWasInTopbarFilters = document.querySelector('.p-topbar-filters')?.contains(document.activeElement) ?? false;
        if (focusWasInTopbarFilters) requestAnimationFrame(() => mobileFilterButton.current?.focus());
      }
    };
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
      const catalog = useProduct.getState();
      if (!catalog.cameraCatalogLoaded || catalog.cameraCatalogFailed) catalog.setCameraCatalogStatus(false, false);
      catalog.setCasesLoadStatus(catalog.casesLoaded ? 'refreshing' : 'loading');
      let cameraFailure = '';
      let casesFailure = '';
      const updateConnection = () => {
        if (!active) return;
        const product = useProduct.getState();
        if (cameraFailure) {
          product.setConnected(false);
          product.setError(`Camera sources are temporarily unavailable: ${cameraFailure}`);
        } else if (casesFailure) {
          product.setConnected(true);
          product.setError(`Camera sources are available, but saved cases are temporarily unavailable: ${casesFailure}`);
        } else {
          product.setConnected(true);
          product.setError('');
        }
      };
      const cameraLoad = getCameras(controller.signal).then(cameras => {
        if (!active) return;
        useProduct.getState().setCameras(cameras);
        useProduct.getState().setCameraCatalogStatus(true, false);
        cameraFailure = '';
        updateConnection();
      }).catch(reason => {
        if (!active || controller.signal.aborted) return;
        useProduct.getState().setCameraCatalogStatus(false, true);
        cameraFailure = reason instanceof Error ? reason.message : 'The camera catalog could not be loaded.';
        updateConnection();
      });
      const casesLoad = getCases(controller.signal).then(cases => {
        if (!active) return;
        useProduct.getState().setCases(cases);
        casesFailure = '';
        updateConnection();
      }).catch(reason => {
        if (!active || controller.signal.aborted) return;
        casesFailure = reason instanceof Error ? reason.message : 'Saved cases could not be loaded.';
        const product = useProduct.getState();
        product.setCasesLoadStatus('error');
        updateConnection();
      });
      try { await Promise.all([cameraLoad, casesLoad]); }
      finally {
        if (pending === controller) pending = null;
        if (active) setRetryingConnection(false);
      }
    }
    void load();
    const timer = window.setInterval(() => { setTime(new Date()); void load(); }, 30000);
    const shortcut = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.repeat) return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || target.closest('input, textarea, select, [contenteditable="true"]'))) return;
      if (document.querySelector('dialog[open], [role="dialog"][aria-modal="true"]')) return;
      if (event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey || event.key.toLowerCase() === 'k' && (event.ctrlKey || event.metaKey) && !event.altKey) {
        event.preventDefault(); input.current?.focus();
      }
    };
    window.addEventListener('keydown', shortcut);
    window.addEventListener('online', load);
    const offline = () => { useProduct.getState().setConnected(false); useProduct.getState().setError('You are offline. Reconnect to refresh sources and cases.'); };
    window.addEventListener('offline', offline);
    return () => { active = false; pending?.abort(); window.clearInterval(timer); window.removeEventListener('keydown', shortcut); window.removeEventListener('online', load); window.removeEventListener('offline', offline); };
  }, [reload]);
  useEffect(() => {
    const hadOpenTour = previousTourIndex.current >= 0;
    previousTourIndex.current = state.demoIndex;
    if (!hadOpenTour || state.demoIndex >= 0) return;
    let attempt = 0;
    const restoreFocus = () => {
      const current = useProduct.getState();
      if ((current.demoIndex >= 0 || document.querySelector('.fs-tour-layer')) && attempt++ < 30) {
        requestAnimationFrame(restoreFocus);
        return;
      }
      const trigger = current.tourReturnFocus;
      if (trigger?.isConnected && trigger.matches('button, a[href], input, select, textarea') && trigger.getClientRects().length && !trigger.closest('[hidden], [inert]')) trigger.focus();
      else {
        const tourTrigger = document.querySelector<HTMLButtonElement>('.p-tour-trigger');
        if (tourTrigger?.isConnected && tourTrigger.getClientRects().length) tourTrigger.focus();
        else content.current?.focus();
      }
    };
    requestAnimationFrame(restoreFocus);
  }, [state.demoIndex]);
  useEffect(() => {
    const routeChanged = previousPath.current !== state.path;
    const tourWasActive = wasTouring.current;
    previousPath.current = state.path;
    wasTouring.current = state.demoIndex >= 0;
    content.current?.scrollTo({ top: 0 });
    const section = state.path.split('/')[1];
    const label = nav.find(([path]) => path.split('/')[1] === section)?.[2]
      || ({ settings: 'Settings', storyboard: 'How it works', legal: 'Legal information' } as Record<string, string>)[section]
      || (section ? 'Page not found' : 'Overview');
    document.title = `${label} | FlowSense`;
    if (state.demoIndex >= 0) {
      if (pageAnnouncement.current) pageAnnouncement.current.textContent = '';
      return;
    }
    if (pageAnnouncement.current) pageAnnouncement.current.textContent = '';
    let frame = 0;
    let attempts = 0;
    let active = true;
    const announceOrFocus = () => {
      if (!active) return;
      if (routeChanged && !tourWasActive) {
        const heading = content.current?.querySelector<HTMLElement>('[data-journey-active="true"] .p-screen h1');
        if (heading) {
          if (!heading.hasAttribute('tabindex')) heading.tabIndex = -1;
          heading.focus({ preventScroll: true });
          return;
        }
        if (attempts++ < 20) { frame = requestAnimationFrame(announceOrFocus); return; }
        content.current?.focus({ preventScroll: true });
      }
      if (pageAnnouncement.current) pageAnnouncement.current.textContent = `${label} page`;
    };
    frame = requestAnimationFrame(announceOrFocus);
    return () => { active = false; cancelAnimationFrame(frame); };
  }, [state.path, state.demoIndex]);
  const openConnect = () => {
    connectTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setConnect(true);
  };
  const closeConnect = () => {
    setConnect(false);
    requestAnimationFrame(() => {
      const trigger = connectTrigger.current;
      if (trigger?.isConnected && trigger.offsetParent !== null) trigger.focus();
      else content.current?.focus();
    });
  };
  const retryConnection = () => { if (retryingConnection) return; setRetryingConnection(true); setReload(value => value + 1); };
  const go = (path: string) => { setSearchOpen(false); state.navigate(path); setMobileNav(false); setMobileFilters(false); };
  const goFromSearch = (path: string) => {
    const origin = searchReturnUrl(window.location.pathname, state.query, window.location.search, window.location.hash);
    if (origin) window.history.replaceState(window.history.state, '', origin);
    go(path);
  };
  const exploreSearch = () => { const query = state.query; state.setDistrict("All districts"); state.setMapFocus(null); goFromSearch(`/explore?q=${encodeURIComponent(query)}`); };
  const submitSearch = () => {
    const destination = searchSubmitDestination(state.query, [
      ...nav.map(([path, , name]) => ({ path, name })),
      { name: 'Settings', path: '/settings' }, { name: 'How it works', path: '/storyboard' },
    ], {
      cameras: state.cameras.filter(camera => cameraMatches(camera, state.query)).slice(0, 3)
        .map(camera => ({ name: camera.name, path: `/cameras/${camera.id}` })),
      signals: (state.mode === 'presentation' ? signals : []).filter(signal => `${signal.location} ${signal.title}`.toLowerCase().includes(state.query.toLowerCase())).slice(0, 3)
        .map(signal => ({ name: signal.location, path: '/hotspots', signal: signal.id })),
    });
    if (!destination) return;
    if ('signal' in destination) state.selectSignal(destination.signal as string);
    if (destination.path.startsWith('/explore?')) { state.setDistrict('All districts'); state.setMapFocus(null); }
    goFromSearch(destination.path);
  };

  const parts = state.path.split('/').filter(Boolean);
  const evidenceWorkspace = ['explore', 'watch', 'cameras'].includes(parts[0]);
  let screen;
  switch (parts[0]) {
    case 'explore': screen = <EvidenceExplorer />; break;
    case 'watch': screen = <ObservationDesk />; break;
    case 'overview': case undefined: screen = <Overview />; break;
    case 'map': screen = <Overview mapOnly />; break;
    case 'cameras': screen = parts[1] ? <CameraEvidence key={parts[1]} cameraId={parts[1]} onRetry={retryConnection} /> : <Cameras onConnect={openConnect} onRetry={retryConnection} />; break;
    case 'corridors': screen = <CorridorAnalytics key={parts[1]} id={parts[1]} />; break;
    case 'hotspots': screen = <Hotspots />; break;
    case 'risk-signals': screen = <Hotspots risk />; break;
    case 'pedestrians': screen = <Pedestrians />; break;
    case 'emergency-corridor': screen = <EmergencyCorridor />; break;
    case 'reports': screen = <Reports onRetry={retryConnection} retrying={retryingConnection} />; break;
    case 'storyboard': screen = <Storyboard />; break;
    case 'settings': screen = <Settings onConnect={openConnect} />; break;
    case 'legal': screen = parts[1] === 'review' ? <LegalReviewPage /> : <LegalPage kind={parts[1] || 'privacy'} />; break;
    default: screen = <MissingView />;
  }
  // Keep screens mounted while touring so local filters and camera selection survive.
  if (state.demoIndex < 0 && (tourScreens.length !== 1 || tourScreens[0].path !== state.path)) setTourScreens([{ path: state.path, view: screen }]);
  else if (state.demoIndex >= 0 && !tourScreens.some(item => item.path === state.path)) setTourScreens([...tourScreens, { path: state.path, view: screen }]);
  const searchResults = state.query.length > 1 ? [
    ...state.cameras.filter((c) => cameraMatches(c, state.query)).slice(0, 3).map((c) => ({ name: c.name, type: 'Camera source', path: `/cameras/${c.id}`, icon: 'camera' })),
    ...(state.mode === 'presentation' ? signals : []).filter((s) => `${s.location} ${s.title}`.toLowerCase().includes(state.query.toLowerCase())).slice(0, 3).map((s) => ({ name: s.location, type: `Scenario · ${s.title}`, path: '/hotspots', icon: 'pin', signal: s.id })),
    ...[...nav, ['/settings', 'settings', 'Settings'], ['/storyboard', 'grid', 'How it works']].filter(([, , label]) => (label as string).toLowerCase().includes(state.query.toLowerCase())).map(([path, icon, name]) => ({ name, path, type: "Module", icon })),
  ] : [];
  const activateSearchOption = (index: number) => {
    if (index === 0) { exploreSearch(); return; }
    const result = searchResults[index - 1];
    if (!result) return;
    if ('signal' in result) state.selectSignal(result.signal as string);
    goFromSearch(result.path);
  };
  const handleSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Escape') { if (searchOpen && state.query.length > 1) { event.preventDefault(); event.stopPropagation(); } setSearchOpen(false); setActiveSearchOption(-1); return; }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (state.query.length < 2) return;
      event.preventDefault();
      setSearchOpen(true);
      const count = searchResults.length + 1;
      setActiveSearchOption(current => nextSearchOption(searchOpen ? current : -1, event.key === 'ArrowDown' ? 'next' : 'previous', count));
      return;
    }
    if (event.key === 'Enter' && state.query.trim().length > 1) {
      event.preventDefault();
      if (activeSearchOption >= 0 && activeSearchOption <= searchResults.length) activateSearchOption(activeSearchOption);
      else submitSearch();
    }
  };
  useEffect(() => {
    if (!searchOpen || activeSearchOption < 0) return;
    document.getElementById(`workspace-search-option-${activeSearchOption}`)?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
  }, [activeSearchOption, searchOpen]);
  return <div className="p-platform"><MonitoringHeartbeat />
    <a className="p-skip" href="#product-content">Skip to content</a><div ref={pageAnnouncement} className="p-sr-only" role="status" aria-live="polite" aria-atomic="true" /><DataInitializer />
    <aside ref={navigation} id="workspace-navigation" className={`p-navigation ${mobileNav ? 'open' : ''}`} inert={smallScreen && !mobileNav} aria-hidden={smallScreen && !mobileNav} role={smallScreen && mobileNav ? 'dialog' : undefined} aria-modal={smallScreen && mobileNav ? true : undefined} aria-label={smallScreen && mobileNav ? 'Main navigation' : undefined}><button className="p-navigation-close p-icon-button" aria-label="Close navigation" onClick={() => setMobileNav(false)}><Icon name="close" /></button><button className="p-brand" onClick={() => go('/overview')} aria-label="FlowSense home"><span className="p-brand-symbol"><BrandMark size={38} decorative /></span><span className="p-brand-lockup"><BrandWordmark width={126} /><small>MOBILITY INTELLIGENCE</small></span></button><div className="p-region"><span>OPERATING AREA</span><b><i />Greater Los Angeles, CA</b><small>United States</small></div><nav aria-label="Main navigation">{nav.map(([path, icon, label], index) => <Fragment key={path}>{(index === 0 || index === 5 || index === 9) && <span className="p-navigation-group-label" role="heading" aria-level={2}>{index === 0 ? 'Explore' : index === 5 ? 'Analyze' : 'Act and report'}</span>}<a href={path} aria-label={label} title={label} aria-current={state.path.split('/')[1] === path.split('/')[1] ? 'page' : undefined} className={state.path.split('/')[1] === path.split('/')[1] ? 'active' : ''} onClick={event => { if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return; event.preventDefault(); go(path); }}><Icon name={icon} size={19} /><span>{label}</span>{path === '/risk-signals' && state.casesLoaded && state.cases.filter((c) => !['resolved', 'dismissed'].includes(c.status)).length > 0 && <b>{state.cases.filter((c) => !['resolved', 'dismissed'].includes(c.status)).length}</b>}</a></Fragment>)}</nav><div className="p-navigation-bottom"><div className="p-navigation-secondary"><a href="/storyboard" aria-current={parts[0] === 'storyboard' ? 'page' : undefined} className={parts[0] === 'storyboard' ? 'active' : ''} onClick={event => { if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return; event.preventDefault(); go('/storyboard'); }}><BrandMark size={18} decorative /><span>How it works<small>Read the feature guide</small></span></a><a href="/settings" aria-current={parts[0] === 'settings' ? 'page' : undefined} className={parts[0] === 'settings' ? 'active' : ''} onClick={event => { if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return; event.preventDefault(); go('/settings'); }}><Icon name="settings" /><span>Settings</span></a></div><div className="p-nav-note"><span>LESS NOISE.</span><b>Better decisions.</b><small>Evidence · context · review</small></div></div></aside>
    <div className="p-workspace" inert={smallScreen && mobileNav}>
      <header className="p-topbar">
        <button className="fs-mobile-brand" aria-label="FlowSense home" title="FlowSense home" onClick={() => go('/overview')}><BrandMark size={29} decorative /><BrandWordmark width={82} /></button>
        <button ref={menuButton} className="p-menu-button p-icon-button" onClick={() => { setMobileFilters(false); setMobileNav(!mobileNav); }} aria-label={mobileNav ? "Close navigation" : "Open navigation"} aria-expanded={mobileNav} aria-controls="workspace-navigation"><Icon name="grid" /></button>
        <button type="button" className="p-topbar-tour" aria-label="Start guided tour for this page" title="Guided tour" onClick={event => { const trigger = event.currentTarget; setMobileNav(false); setMobileFilters(false); setSearchOpen(false); requestAnimationFrame(() => state.startTour(trigger)); }}><Icon name="play" size={15} /><span>Guided tour</span></button>
        <div className="p-search" role="search" onFocus={() => setSearchOpen(true)} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setSearchOpen(false); }}>
          <Icon name="search" size={19} />
          <input ref={input} autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="search" role="combobox" aria-autocomplete="list" aria-haspopup="listbox" aria-expanded={searchOpen && state.query.length > 1} aria-controls="workspace-search-suggestions" aria-activedescendant={searchOpen && activeSearchOption >= 0 && activeSearchOption <= searchResults.length ? `workspace-search-option-${activeSearchOption}` : undefined} aria-keyshortcuts="/ Control+K Meta+K" aria-label="Search for a camera, place or module" placeholder="Search for a street, freeway or camera…" value={state.query} onChange={event => { setSearchOpen(true); setActiveSearchOption(-1); state.setQuery(event.target.value); }} onKeyDown={handleSearchKeyDown} />
          {state.query && <button type="button" className="p-search-clear" aria-label="Clear search" title="Clear search" onClick={() => { state.setQuery(''); setSearchOpen(false); setActiveSearchOption(-1); input.current?.focus(); }}>Clear</button>}
          <kbd title="Focus search with / or Ctrl/Command+K" aria-label="Search keyboard shortcut: / or Ctrl/Command+K">/</kbd>
          {searchOpen && state.query.length > 1 && <div className="p-search-results"><div className="p-search-results-heading"><span>FIND YOUR NEXT VIEW</span><small>{searchResults.length} direct {searchResults.length === 1 ? 'match' : 'matches'}</small></div><div id="workspace-search-suggestions" role="listbox" aria-label="Workspace search suggestions">
            <button id="workspace-search-option-0" role="option" tabIndex={-1} aria-selected={activeSearchOption === 0} className="p-search-all" onClick={exploreSearch}><span className="p-search-result-icon" aria-hidden="true"><Icon name="map" /></span><span className="p-search-result-copy"><b>Explore “{state.query}” on the map</b><small>Find the place, then check nearby sources and coverage.</small></span><Icon name="arrow" size={14} /></button>
            {searchResults.map((result, i) => <button id={`workspace-search-option-${i + 1}`} role="option" tabIndex={-1} aria-selected={activeSearchOption === i + 1} key={`${result.path}-${i}`} onClick={() => activateSearchOption(i + 1)}><span className="p-search-result-icon" aria-hidden="true"><Icon name={result.icon} /></span><span className="p-search-result-copy"><b>{result.name}</b><small>{result.type === 'Module' ? 'Open workspace tool' : result.type}</small></span><span className="p-search-result-kind" aria-hidden="true">{'signal' in result ? 'Scenario' : result.type === 'Module' ? 'Tool' : 'Camera'}</span><Icon name="arrow" size={14} /></button>)}
          </div>{searchResults.length === 0 && <p className="p-search-empty" role="status" aria-live="polite">{state.cameraCatalogFailed ? 'Camera suggestions are unavailable. You can still explore a place using the map search above.' : 'No direct matches. Explore the place on the map or try a different name.'}</p>}<div className="p-search-keyboard-hints" aria-hidden="true"><span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>Enter</kbd> open</span><span><kbd>Esc</kbd> close</span></div></div>}
        </div>
        <div className="p-topbar-filters"><select aria-label="District" value={state.district} onChange={event => { state.setMapFocus(null); state.setDistrict(event.target.value); }}>{zones.map(value => <option key={value}>{value}</option>)}</select><select aria-label="Reference period" title="Reference period for display and report context; saved cases retain their own timestamps" value={state.period} onChange={event => state.setPeriod(event.target.value)}>{["Last 15 min", "Last hour", "Last 24 h", "Last 7 days"].map(value => <option key={value}>{value}</option>)}</select></div>
        <span className={`p-system-state ${state.connected ? '' : 'offline'}`} role="img" aria-label={catalogConnectionDescription} title={catalogConnectionDescription}><i /><span>{catalogConnectionLabel}<small>Local <time dateTime={time.toISOString()}>{time.toLocaleTimeString("en-US", { hour: '2-digit', minute: '2-digit' })}</time></small></span></span>
        <button ref={mobileFilterButton} type="button" className={`p-mobile-filter-button p-icon-button${mobileFiltersActive ? ' has-active' : ''}`} aria-label={`${mobileFilters ? "Hide" : "Show"} filters${mobileFilterSummary ? `, ${mobileFilterSummary}` : ''}`} title={`${mobileFilters ? "Hide" : "Show"} filters`} aria-expanded={mobileFilters} aria-controls="workspace-mobile-filters" onClick={() => { setMobileNav(false); setMobileFilters(!mobileFilters); }}><Icon name="layers" /></button>
        <ThemeControl />
        <button className="p-profile" aria-label="Settings" title="Settings" onClick={() => go('/settings')}><Icon name="settings" size={21} /></button>
      </header>
      <div className="p-context-bar"><span><Icon name={!evidenceWorkspace && state.mode === 'presentation' ? 'play' : 'camera'} size={14} />{evidenceWorkspace ? "Camera video · independent source timing" : state.mode === 'presentation' ? "Presentation view · illustrative indicators" : "Available observations · no invented indicators"}</span></div>
      <div id="workspace-mobile-filters" className={`p-mobile-filters ${mobileFilters ? 'open' : ''}`} role="region" aria-label="Display filters" inert={!smallScreen || !mobileFilters} aria-hidden={!smallScreen || !mobileFilters}><label>District<select aria-label="District" value={state.district} onChange={(e) => { state.setMapFocus(null); state.setDistrict(e.target.value); }}>{zones.map((value) => <option key={value}>{value}</option>)}</select></label><label>Reference period<select aria-label="Reference period" title="Reference period for display and report context; saved cases retain their own timestamps" value={state.period} onChange={(e) => state.setPeriod(e.target.value)}>{["Last 15 min", "Last hour", "Last 24 h", "Last 7 days"].map((value) => <option key={value}>{value}</option>)}</select></label>{mobileFiltersActive && <button type="button" className="p-text-button p-mobile-filter-reset" onClick={() => { state.setMapFocus(null); state.setDistrict("All districts"); state.setPeriod("Last 15 min"); requestAnimationFrame(() => mobileFilterButton.current?.focus()); }}>Reset</button>}</div><main ref={content} id="product-content" className="p-content" tabIndex={-1}>{!state.path.startsWith('/legal') && <JourneyWelcome />}{state.error && <ConnectionNotice message={state.error} retrying={retryingConnection} onRetry={retryConnection} />}<Suspense fallback={<WorkspaceLoading name={nav.find(([path]) => path === state.path)?.[2] || (state.path.startsWith("/cameras/") ? "camera evidence" : "your workspace")} />}>{tourScreens.map(({path, view}) => <div key={path} hidden={path !== state.path} inert={path !== state.path} data-journey-active={path === state.path}>{path === state.path ? screen : view}</div>)}<JourneyNext /><JourneyReady /></Suspense><PageReturn /><footer className="p-legal-footer" aria-label="Legal information"><strong>Legal</strong>{[['/legal/terms','Terms'],['/legal/privacy','Privacy'],['/legal/cookies','Cookies'],['/legal/refunds','Refunds'],['/legal/review','U.S. review']].map(([path,label]) => <a key={path} href={path} aria-current={state.path === path ? 'page' : undefined} onClick={event => { if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return; event.preventDefault(); go(path); }}>{label}</a>)}<span>U.S. operator baseline · v2026-10-24</span></footer></main>
      </div>
    {mobileNav && <button className="p-nav-backdrop" aria-hidden="true" tabIndex={-1} onClick={() => { setMobileNav(false); menuButton.current?.focus(); }} />}
    {state.toast && <WorkspaceNotice message={state.toast} onDismiss={() => state.notify('')} />}
    {state.demoIndex >= 0 && <GuidedTour />}
    {connect && <ConnectDialog onClose={closeConnect} />}
  </div>;
}
