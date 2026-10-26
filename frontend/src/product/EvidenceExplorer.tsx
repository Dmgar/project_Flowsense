import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store/useStore';
import { CameraThumb } from './CameraThumb';
import { CityMap } from './CityMap';
import { cameraStatus } from './cameraStatus';
import { hasPreviouslyVerifiedVideo } from './cameraCalibration';
import { matchesZone } from './coverage';
import { evidenceResultsStatus, findStreetMatches, searchEvidence } from './evidenceSearch';
import { observationDeskSelection } from './deskSelection';
import { openObservedCamera, useProduct } from './store';
import { Badge, EmptyState, Icon } from './ui';
import './explorerJourney.css';

export function EvidenceExplorer() {
  const resultsHeading = useRef<HTMLHeadingElement>(null);
  const [focusResultsRequested, setFocusResultsRequested] = useState(false);
  const mapSection = useRef<HTMLElement>(null);
  const locateTrigger = useRef<HTMLButtonElement | null>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const cameras = useProduct(s => s.cameras);
  const catalogLoaded = useProduct(s => s.cameraCatalogLoaded);
  const catalogFailed = useProduct(s => s.cameraCatalogFailed);
  const booted = useStore(s => s.isBooted);
  const district = useProduct(s => s.district);
  const query = useProduct(s => s.query);
  const radius = useProduct(s => s.explorerRadiusKm);
  const style = useProduct(s => s.explorerMapStyle);
  const videoFilter = useProduct(s => s.explorerVideoFilter);
  const watched = useProduct(s => s.watchCameras);
  const desk = useMemo(() => observationDeskSelection(watched, cameras), [watched, cameras]);
  const edges = useStore(s => s.geojsonEdges);
  const deferredQuery = useDeferredValue(query);
  useEffect(() => {
    if (!focusResultsRequested || query !== deferredQuery) return;
    const frame = requestAnimationFrame(() => {
      setFocusResultsRequested(false);
      resultsHeading.current?.focus({ preventScroll: false });
    });
    return () => cancelAnimationFrame(frame);
  }, [focusResultsRequested, query, deferredQuery]);
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedScope, setSelectedScope] = useState('');
  const [limit, setLimit] = useState(12);
  const scoped = useMemo(() => cameras.filter(c => matchesZone(district, c.district) && (videoFilter === 'all' || c.stream_url) && (videoFilter !== 'checked' || hasPreviouslyVerifiedVideo(c))), [cameras, district, videoFilter]);
  const streets = useMemo(() => findStreetMatches(edges, deferredQuery), [edges, deferredQuery]);
  const result = useMemo(() => searchEvidence(scoped, edges, deferredQuery, radius, streets), [scoped, edges, deferredQuery, radius, streets]);
  const items = useMemo(() => result.hits.map(hit => hit.camera), [result]);
  const scopeKey = `${query}-${radius}-${district}-${videoFilter}`;
  const selectCamera = (id: string | null, trigger?: HTMLButtonElement) => {
    locateTrigger.current = trigger || null;
    setSelected(id); setSelectedScope(scopeKey);
    if (id && window.matchMedia('(max-width: 760px)').matches) mapSection.current?.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
    if (trigger && id) requestAnimationFrame(() => document.getElementById('explorer-map-source-title')?.focus({ preventScroll: true }));
  };
  const closeMapDetails = () => {
    setSelected(null);
    requestAnimationFrame(() => {
      const trigger = locateTrigger.current;
      if (trigger?.isConnected && trigger.getClientRects().length) trigger.focus();
      else mapSection.current?.focus({ preventScroll: true });
    });
  };
  const active = selectedScope === scopeKey ? items.find(camera => camera.id === selected) : undefined;
  const focus = active ? [active.lat, active.lng] as [number, number] : undefined;
  const [limitScope, setLimitScope] = useState(scopeKey);
  const shownLimit = limitScope === scopeKey ? limit : 12;
  const nearby = result.hits.filter(hit => hit.match === 'nearby').length;
  const resultStatus = evidenceResultsStatus({ searching: query !== deferredQuery, catalogLoaded, catalogFailed, cameraCount: items.length, nearbyCount: nearby });
  const noRegisteredSources = catalogLoaded && !catalogFailed && cameras.length === 0;
  const deskFull = watched.length >= 4;
  const hasExplorerFilters = radius !== 1.5 || style !== 'streets' || videoFilter !== 'all' || district !== 'All districts';
  const resetExplorerFilters = () => { const state = useProduct.getState(); setSelected(null); state.setExplorerRadiusKm(1.5); state.setExplorerMapStyle('streets'); state.setExplorerVideoFilter('all'); state.setDistrict('All districts'); };
  const updateQuery = (value: string) => { setSelected(null); useProduct.getState().setQuery(value); };
  const showMoreSources = () => {
    const nextCamera = items[shownLimit];
    setLimitScope(scopeKey); setLimit(shownLimit + 12);
    requestAnimationFrame(() => {
      if (!nextCamera) return;
      const heading = document.getElementById(`explorer-camera-title-${nextCamera.id}`);
      heading?.focus({ preventScroll: true });
      heading?.scrollIntoView({ block: 'nearest', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
    });
  };
  return <div className="p-screen p-evidence-explorer">
    <div className="p-explorer-hero"><div><span className="p-eyebrow">EXPLORE · COMPARE · DECIDE</span><h1>From a street to its evidence.</h1><p>Find cameras by name, freeway or city. Compare multiple locations on one observation desk.</p></div><button className="p-button primary" aria-label={`Open observation desk, ${watched.length} saved camera selections${deskFull ? '. Remove a camera before adding another.' : ''}`} onClick={() => useProduct.getState().navigate('/watch')}><Icon name="grid" />Observation desk <b>{watched.length}/4</b></button></div>
    {deskFull && <p id="p-desk-capacity-note" className="p-small-note" role="status">The observation desk is full. Remove a camera from the desk before comparing another.</p>}
    {catalogLoaded && !catalogFailed && desk.invalidIds.size > 0 && <div className="p-small-note p-desk-recovery" role="status"><span>{desk.recoveryMessages.join('; ')}. Remove {desk.invalidIds.size === 1 ? 'this camera' : 'these cameras'} from the desk to keep the selection current.</span>{[...desk.invalidIds].map(id => <button className="p-text-button" key={id} onClick={() => useProduct.getState().toggleWatch(id)}>Remove {id}</button>)}</div>}
    <label className="p-explorer-query-label" htmlFor="street-camera-query">Start with a street, place or camera</label>
    <div className="p-explorer-search"><Icon name="search" size={23} /><input ref={searchInput} autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="search" id="street-camera-query" aria-describedby="explorer-results-status" aria-label="Search streets, places or cameras" placeholder="Try Western Ave, I-110, Santa Monica…" value={query} onChange={e => { setFocusResultsRequested(false); updateQuery(e.target.value); }} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); setFocusResultsRequested(true); } }} />{query && <button className="p-icon-button" aria-label="Clear street search" onClick={() => { updateQuery(''); requestAnimationFrame(() => searchInput.current?.focus({ preventScroll: true })); }}><Icon name="close" /></button>}</div>
    <div className="p-explorer-suggestions" role="group" aria-label="Example searches">{['Western Ave', 'I-110', 'Santa Monica', 'Long Beach'].map(value => <button key={value} onClick={() => { useProduct.getState().setDistrict("All districts"); updateQuery(value); }}><Icon name="search" size={13} />{value}</button>)}</div>
    <section className="p-explorer-refinement" aria-label="Search context"><div className="p-explorer-refinement-heading"><span><Icon name="layers" size={16} />Search context</span>{hasExplorerFilters && <button className="p-text-button" type="button" onClick={resetExplorerFilters}>Reset filters<Icon name="refresh" size={13} /></button>}</div><div className="p-explorer-toolbar"><label>Distance from the street<select value={radius} onChange={e => useProduct.getState().setExplorerRadiusKm(Number(e.target.value))}><option value={.5}>Within 500 m</option><option value={1.5}>Within 1.5 km</option><option value={3}>Within 3 km</option></select></label><label>Map style<select value={style} onChange={e => useProduct.getState().setExplorerMapStyle(e.target.value as 'streets' | 'terrain')}><option value="streets">Streets and access points</option><option value="terrain">Regional terrain</option></select></label><label>Source filter<select aria-describedby="explorer-link-check-note" value={videoFilter} onChange={e => useProduct.getState().setExplorerVideoFilter(e.target.value as 'all' | 'registered' | 'checked')}><option value="all">All cameras</option><option value="registered">With a registered video link</option><option value="checked">Video link responded previously</option></select><small id="explorer-link-check-note" className="p-explorer-filter-help">A previous link response does not confirm video playback now.</small></label></div><div className="p-explorer-search-summary"><span id="explorer-results-status" role="status" aria-live="polite" className={query !== deferredQuery ? 'p-explorer-search-updating' : undefined}>{query !== deferredQuery && <span className="p-request-progress" aria-hidden="true"><Icon name="refresh" size={14} /></span>}{resultStatus}</span>{district !== 'All districts' && <button type="button" aria-label={`Clear area filter: ${district}`} onClick={() => useProduct.getState().setDistrict('All districts')}><Icon name="pin" size={12} />{district}<Icon name="close" size={12} /></button>}</div></section>
    <div className="p-explorer-layout"><section ref={mapSection} className="p-explorer-map" tabIndex={-1} aria-label="Camera source locations"><CityMap forceObserved onRoad={updateQuery} cameraItems={items} onCamera={camera => selectCamera(camera.id)} selectedCamera={active?.id} focus={focus} viewEdges={result.streets.length ? result.streets : undefined} signalItems={[]} mapStyle={style} />{active && <div className="p-map-camera-detail" role="region" aria-labelledby="explorer-map-source-title" onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeMapDetails(); } }}><button type="button" className="p-icon-button" aria-label="Close map details" aria-keyshortcuts="Escape" onClick={closeMapDetails}><Icon name="close" /></button><Badge tone={cameraStatus(active).tone}>{cameraStatus(active).label}</Badge><h3 id="explorer-map-source-title" tabIndex={-1}>{active.name}</h3><p>{active.district}</p><button className="p-button primary" onClick={() => openObservedCamera(active.id)}>{active.stream_url ? 'Open video and evidence' : 'Open source details'}<Icon name="arrow" /></button></div>}</section>
    <aside className="p-explorer-results" aria-busy={query !== deferredQuery}><header><h2 ref={resultsHeading} tabIndex={-1}>{deferredQuery.trim() ? `Results for “${deferredQuery}”` : "Regional cameras"}</h2><p>{!edges.length ? booted ? "Road context is unavailable. Catalog matches remain available; road data retries automatically." : "Loading the road network. Camera catalog matches are shown in the meantime." : result.streets.length ? `${result.streets.length} matching segments highlighted. Proximity does not guarantee that a camera can see the street.` : "Catalog matches. The downloaded network does not contain every street in the region."}</p></header>
      {result.hits.slice(0, shownLimit).map(({ camera, match, distanceKm }) => {
        const onDesk = watched.includes(camera.id);
        const noVideo = !camera.stream_url && !onDesk;
        const unavailableId = `camera-compare-unavailable-${camera.id.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
        return <article key={camera.id} aria-labelledby={`explorer-camera-title-${camera.id}`} className={`p-explorer-result ${active?.id === camera.id ? 'selected' : ''}`}><CameraThumb camera={camera} showDetailsAction={false} /><div><small>{camera.district} · {match === 'catalog' ? "Catalog match" : `${distanceKm!.toFixed(2)} km from the street`}</small><h3 id={`explorer-camera-title-${camera.id}`} tabIndex={-1}>{camera.name}</h3><p><Badge tone={cameraStatus(camera).tone}>{cameraStatus(camera).label}</Badge></p><div className="p-explorer-result-actions"><button className="p-text-button" aria-label={`Locate ${camera.name} on the map`} onClick={event => selectCamera(camera.id, event.currentTarget)}><Icon name="pin" size={14} />Locate</button><button className="p-text-button p-explorer-desk-toggle" aria-label={`${onDesk ? 'Remove' : 'Add'} ${camera.name} ${onDesk ? 'from' : 'to'} the observation desk`} aria-pressed={onDesk} aria-describedby={noVideo ? unavailableId : deskFull && !onDesk ? 'p-desk-capacity-note' : undefined} disabled={noVideo || deskFull && !onDesk} onClick={() => useProduct.getState().toggleWatch(camera.id)}><Icon name={onDesk ? 'check' : 'plus'} size={14} />{onDesk ? 'On desk' : 'Add to desk'}</button>{noVideo && <span id={unavailableId} className="p-comparison-note">Video unavailable</span>}<button className="p-button primary p-explorer-open-video" aria-label={`${camera.stream_url ? 'Open video and evidence' : 'Open source details'} for ${camera.name}`} onClick={() => openObservedCamera(camera.id)}>{camera.stream_url ? 'Open video and evidence' : 'Open source details'}<Icon name="arrow" size={14} /></button></div></div></article>;
      })}
      {items.length > 0 && <p className="p-explorer-result-range" role="status" aria-live="polite" aria-atomic="true">Showing {Math.min(shownLimit, items.length)} of {items.length} {catalogFailed ? 'last loaded ' : ''}sources</p>}
      {items.length > shownLimit && <button className="p-button p-explorer-load-more" disabled={query !== deferredQuery} onClick={showMoreSources}>Show {Math.min(12, items.length - shownLimit)} more sources<Icon name="plus" size={15} /></button>}
      {!items.length && <EmptyState icon={catalogFailed ? 'alert' : 'search'} title={catalogFailed ? "Camera catalog unavailable" : !catalogLoaded ? "Loading camera sources" : noRegisteredSources ? "No camera sources registered" : "No cameras for this search"} detail={catalogFailed ? "Your search is kept. Use Retry connection above, or reconnect to refresh sources." : !catalogLoaded ? "Fetching registered sources. You can enter your street while you wait." : noRegisteredSources ? "There are no registered sources to match against. Open the public camera catalog to connect an authorized source." : "Try a freeway or intersection, or increase the radius. Only registered sources are shown; a street without cameras has no confirmed visual coverage."} action={<button className="p-button" onClick={() => { if (noRegisteredSources) useProduct.getState().navigate('/cameras'); else { updateQuery(''); useProduct.getState().setExplorerVideoFilter('all'); useProduct.getState().setDistrict("All districts"); } }}>{noRegisteredSources ? 'Open camera catalog' : 'Explore the entire region'}</button>} />}
    </aside></div>
  </div>;
}
