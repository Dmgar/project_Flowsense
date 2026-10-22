import { useDeferredValue, useMemo, useRef, useState } from 'react';
import { useStore } from '../store/useStore';
import { CameraThumb } from './CameraThumb';
import { CityMap } from './CityMap';
import { cameraStatus } from './cameraStatus';
import { hasPreviouslyVerifiedVideo } from './cameraCalibration';
import { matchesZone } from './coverage';
import { findStreetMatches, searchEvidence } from './evidenceSearch';
import { openObservedCamera, useProduct } from './store';
import { Badge, EmptyState, Icon } from './ui';

export function EvidenceExplorer() {
  const mapSection = useRef<HTMLElement>(null);
  const cameras = useProduct(s => s.cameras);
  const district = useProduct(s => s.district);
  const query = useProduct(s => s.query);
  const watched = useProduct(s => s.watchCameras);
  const edges = useStore(s => s.geojsonEdges);
  const deferredQuery = useDeferredValue(query);
  const [radius, setRadius] = useState(1.5);
  const [style, setStyle] = useState<'streets' | 'terrain'>('streets');
  const [videoFilter, setVideoFilter] = useState('all');
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedScope, setSelectedScope] = useState('');
  const [limit, setLimit] = useState(12);
  const scoped = useMemo(() => cameras.filter(c => matchesZone(district, c.district) && (videoFilter === 'all' || c.stream_url) && (videoFilter !== 'checked' || hasPreviouslyVerifiedVideo(c))), [cameras, district, videoFilter]);
  const streets = useMemo(() => findStreetMatches(edges, deferredQuery), [edges, deferredQuery]);
  const result = useMemo(() => searchEvidence(scoped, edges, deferredQuery, radius, streets), [scoped, edges, deferredQuery, radius, streets]);
  const items = useMemo(() => result.hits.map(hit => hit.camera), [result]);
  const scopeKey = `${query}-${radius}-${district}-${videoFilter}`;
  const selectCamera = (id: string | null) => { setSelected(id); setSelectedScope(scopeKey); if (id && window.matchMedia('(max-width: 760px)').matches) mapSection.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }); };
  const active = selectedScope === scopeKey ? items.find(camera => camera.id === selected) : undefined;
  const focus = active ? [active.lat, active.lng] as [number, number] : undefined;
  const [limitScope, setLimitScope] = useState(scopeKey);
  const shownLimit = limitScope === scopeKey ? limit : 12;
  const nearby = result.hits.filter(hit => hit.match === 'nearby').length;
  const updateQuery = (value: string) => { setSelected(null); useProduct.getState().setQuery(value); };
  return <div className="p-screen p-evidence-explorer">
    <div className="p-explorer-hero"><div><span className="p-eyebrow">EXPLORE · COMPARE · DECIDE</span><h1>From a street to its evidence.</h1><p>Find cameras by name, freeway or city. Compare multiple locations on one observation desk.</p></div><button className="p-button primary" onClick={() => useProduct.getState().navigate('/watch')}><Icon name="grid" />Observation desk <b>{watched.length}/4</b></button></div>
    <div className="p-explorer-search"><Icon name="search" size={23} /><input aria-label="Search for a street or freeway" placeholder="Try Western Ave, I-110, Santa Monica…" value={query} onChange={e => updateQuery(e.target.value)} />{query && <button className="p-icon-button" aria-label="Clear street search" onClick={() => updateQuery('')}><Icon name="close" /></button>}</div>
    <div className="p-explorer-suggestions">{['Western Ave', 'I-110', 'Santa Monica', 'Long Beach'].map(value => <button key={value} onClick={() => { useProduct.getState().setDistrict("All districts"); updateQuery(value); }}><Icon name="search" size={13} />{value}</button>)}</div>
    <div className="p-explorer-toolbar"><label>Cameras near the street<select value={radius} onChange={e => setRadius(Number(e.target.value))}><option value={.5}>Within 500 m</option><option value={1.5}>Within 1.5 km</option><option value={3}>Within 3 km</option></select></label><label>Map<select value={style} onChange={e => setStyle(e.target.value as 'streets' | 'terrain')}><option value="streets">Streets and access points</option><option value="terrain">Regional terrain</option></select></label><label>Video<select value={videoFilter} onChange={e => setVideoFilter(e.target.value)}><option value="all">All cameras</option><option value="registered">With a public link</option><option value="checked">HLS URL returned HTTP 200 previously</option></select></label><span role="status" aria-live="polite">{query !== deferredQuery ? "Searching…" : `${items.length} cameras · ${nearby} by proximity`}</span></div>
    <div className="p-explorer-layout"><section ref={mapSection} className="p-explorer-map"><CityMap forceObserved onRoad={updateQuery} cameraItems={items} onCamera={camera => selectCamera(camera.id)} selectedCamera={active?.id} focus={focus} viewEdges={result.streets.length ? result.streets : undefined} signalItems={[]} mapStyle={style} />{active && <div className="p-map-camera-detail"><button className="p-icon-button" aria-label="Close map details" onClick={() => setSelected(null)}><Icon name="close" /></button><Badge tone={cameraStatus(active).tone}>{cameraStatus(active).label}</Badge><h3>{active.name}</h3><p>{active.district}</p><button className="p-button primary" onClick={() => openObservedCamera(active.id)}>Open evidence <Icon name="arrow" /></button></div>}</section>
    <aside className="p-explorer-results"><header><h2>{query ? `Results for “${deferredQuery}”` : "Regional cameras"}</h2><p>{!edges.length ? "Loading the road network. Camera catalog matches are shown in the meantime." : result.streets.length ? `${result.streets.length} matching segments highlighted. Proximity does not guarantee that a camera can see the street.` : "Catalog matches. The downloaded network does not contain every street in the region."}</p></header>
      {result.hits.slice(0, shownLimit).map(({ camera, match, distanceKm }) => <article key={camera.id} className={`p-explorer-result ${active?.id === camera.id ? 'selected' : ''}`}><CameraThumb camera={camera} onClick={() => selectCamera(camera.id)} /><div><small>{camera.district} · {match === 'catalog' ? "Catalog match" : `${distanceKm!.toFixed(2)} km from the street`}</small><h3>{camera.name}</h3><p>{cameraStatus(camera).label}</p><div className="p-explorer-result-actions"><button className="p-text-button" onClick={() => selectCamera(camera.id)}><Icon name="pin" size={14} />Locate</button><button className="p-text-button" aria-pressed={watched.includes(camera.id)} onClick={() => useProduct.getState().toggleWatch(camera.id)}><Icon name={watched.includes(camera.id) ? 'check' : 'plus'} size={14} />{watched.includes(camera.id) ? "On the desk" : "Compare"}</button><button className="p-text-button" onClick={() => openObservedCamera(camera.id)}>Open <Icon name="arrow" size={14} /></button></div></div></article>)}
      {items.length > shownLimit && <button className="p-button" onClick={() => { setLimitScope(scopeKey); setLimit(shownLimit + 12); }}>Show 12 more</button>}
      {!items.length && <EmptyState title="No cameras for this search" detail="Try a freeway or intersection, or increase the radius. Only registered sources are shown; a street without cameras has no confirmed visual coverage." action={<button className="p-button" onClick={() => { updateQuery(''); setVideoFilter('all'); useProduct.getState().setDistrict("All districts"); }}>Explore the entire region</button>} />}
    </aside></div>
  </div>;
}
