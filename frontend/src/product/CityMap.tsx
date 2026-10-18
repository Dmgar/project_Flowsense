import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Circle, CircleMarker, MapContainer, Marker, Popup, ScaleControl, TileLayer, ZoomControl, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useStore } from '../store/useStore';
import { openObservedCamera, useProduct } from './store';
import { signals } from './data';
import type { GeoJsonEdgeFeature, RouteResponse } from '../types';
import type { Camera, Signal } from './types';
import { Icon } from './ui';
import { matchesZone, regions } from './coverage';

function MapTools({ bounds, expanded, highlight, onExpand, forceObserved }: { forceObserved?: boolean; bounds?: L.LatLngBounds; expanded: boolean; highlight?: GeoJsonEdgeFeature; onExpand: () => void }) {

  const map = useMap();
  const status = useStore((s) => s.graphStatus);
  const [open, setOpen] = useState(false);
  const layers = useProduct(s => s.layers);
  const controls = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const storedMode = useProduct(state => state.mode);
  const observed = forceObserved || storedMode === 'observed';
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => { if (!controls.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', dismiss); document.removeEventListener('keydown', escape); };
  }, [open]);
  useEffect(() => {
    const element = controls.current;
    if (!element) return;
    L.DomEvent.disableClickPropagation(element);
    L.DomEvent.disableScrollPropagation(element);
    return () => { L.DomEvent.off(element); };
  }, []);
  return <div ref={controls} className="p-map-controls"><div className="p-map-actions"><button title="Fit to coverage" aria-label="View full coverage" onClick={() => { map.stop(); if (bounds?.isValid()) map.fitBounds(bounds, { padding: [35, 50], maxZoom: 15, animate: false }); else map.setView([status?.center_latitude ?? 34.048, status?.center_longitude ?? -118.259], 14); }}><Icon name="pin" size={18} /></button><button title={expanded ? "Exit expanded view" : "Expand map"} aria-label={expanded ? "Close expanded map" : "Expand map"} onClick={onExpand}><Icon name={expanded ? 'close' : 'expand'} size={18} /></button><button aria-label={open ? "Close map layers" : "Map layers"} aria-controls={menuId} aria-expanded={open} onClick={() => setOpen(v => !v)}><Icon name="layers" /></button>{highlight && <button title="Zoom to selected segment" aria-label="View selected segment" onClick={() => { if (highlight.geometry.type === 'LineString') map.fitBounds(L.latLngBounds(highlight.geometry.coordinates.map(([x, y]) => [y, x] as [number, number])), { padding: [40, 55], maxZoom: 17 }); }}><Icon name="search" /></button>}</div>{open && <div id={menuId} className="p-map-layer-menu"><strong>Visible layers</strong>{[['congestion', "Road network"], ['cameras', "Public cameras"], ['incidents', "Review signals"], ['pedestrians', "Pedestrian demand"], ['clusterCameras', "Cluster nearby cameras"]].map(([key, label]) => <label key={key}><input type="checkbox" disabled={observed && key === 'pedestrians'} checked={key === 'clusterCameras' ? layers[key] !== false : layers[key] && !(observed && key === 'pedestrians')} onChange={() => useProduct.getState().toggleLayer(key)} />{label}</label>)}<small>{observed ? "Pedestrian demand requires calibrated observations. Use presentation mode to explore that layer." : "Scenario traffic colors are illustrative."}</small></div>}</div>;

}

function CorridorOverlay({ edges }: { edges?: GeoJsonEdgeFeature[] }) {

  const map = useMap();
  useEffect(() => {
    if (!edges?.length) return;
    const group = L.layerGroup().addTo(map);
    for (const edge of edges) {
      if (edge.geometry.type !== 'LineString') continue;
      const coords = edge.geometry.coordinates.map(([x, y]) => [y, x] as [number, number]);
      L.polyline(coords, { color: '#fff', weight: 8, opacity: .9, interactive: false }).addTo(group);
      L.polyline(coords, { color: '#477a53', weight: 4, opacity: .95, interactive: false }).addTo(group);
    }
    return () => { group.remove(); };
  }, [edges, map]);
  return null;

}

function SelectedSegment({ edge }: { edge?: GeoJsonEdgeFeature }) {

  const map = useMap();
  useEffect(() => {
    if (edge?.geometry.type !== 'LineString') return;
    const coordinates = edge.geometry.coordinates.map(([x, y]) => [y, x] as [number, number]);
    const group = L.layerGroup().addTo(map);
    L.polyline(coordinates, { color: '#fff', weight: 11, opacity: .95 }).addTo(group);
    L.polyline(coordinates, { color: '#3c714c', weight: 6, opacity: 1 }).addTo(group);
    return () => { group.remove(); };
  }, [edge, map]);
  return null;

}

function cameraIcon(online: boolean) { return L.divIcon({ className: 'p-camera-pin', html: `<span class="${online ? 'online' : ''}"><svg viewBox="0 0 24 24"><path d="M3 6h13v12H3z M16 10l5-3v10l-5-3"/></svg></span>`, iconSize: [30, 30], iconAnchor: [15, 15] }); }

function Roads({ interactive = true, forceObserved = false, onRoad }: { interactive?: boolean; forceObserved?: boolean; onRoad?: (name: string) => void }) {

  const map = useMap();
  const edges = useStore((s) => s.geojsonEdges);
  const layers = useProduct((s) => s.layers);
  const storedMode = useProduct((s) => s.mode);
  const mode = forceObserved ? 'observed' : storedMode;
  const [zoom, setZoom] = useState(map.getZoom());
  const [viewport, setViewport] = useState(() => map.getBounds());
  useMapEvents({ zoomend: () => setZoom(map.getZoom()), moveend: () => setViewport(map.getBounds()) });
  const roads = useMemo(() => {
    const seen = new Set<string>();
    return edges.flatMap(edge => {
      if (edge.geometry.type !== 'LineString') return [];
      const key = [edge.properties.u, edge.properties.v].sort().join('-');
      if (seen.has(key)) return [];
      seen.add(key);
      const coordinates = edge.geometry.coordinates.map(([x, y]) => [y, x] as [number, number]);
      return [{ properties: edge.properties, coordinates, bounds: L.latLngBounds(coordinates) }];
    });
  }, [edges]);
  useEffect(() => {
    const group = L.layerGroup().addTo(map);
    const renderer = L.canvas({ padding: .5, tolerance: 7 });
    if (layers.congestion || layers.freight) {
      const visibleBounds = viewport.pad(.3);
      for (const edge of roads) {
        if (!visibleBounds.intersects(edge.bounds)) continue;
        const p = edge.properties;
        const major = (zoom < 13 ? ['motorway', 'trunk'] : ['motorway', 'trunk', 'primary', 'secondary']).some((v) => p.highway.includes(v));
        if (!major) continue;
        const score = mode === 'presentation' ? ((p.u + p.v) % 17) / 17 : p.congestion_factor;
        const line = L.polyline(edge.coordinates, {
          renderer, color: mode === 'observed' ? '#8e9e82' : layers.freight && mode === 'presentation' ? '#94799f' : score > .70 ? '#cf7b69' : score > .4 ? '#d8b363' : '#7fac85',
          weight: zoom < 13 ? 2 : 3, opacity: mode === 'presentation' ? .65 : .3, interactive,
        });
        const content = () => {
          const box = document.createElement('div');
          const label = document.createElement('strong'); label.textContent = p.name || "Road segment"; box.append(label);
          const detail = document.createElement('div'); detail.textContent = mode === 'presentation' ? `Scenario: ${Math.round(score * 100)}% congestion` : "Road network available · no congestion measurements"; box.append(detail);
          return box;
        };
        if (interactive) {
          line.bindTooltip(content, { sticky: true, className: 'p-map-tooltip' });
          const name = (p.name || '').toLowerCase();
          if (onRoad && p.name) line.on('click', () => onRoad(p.name!));
          else if (name.includes('hollywood') || name.includes('santa monica') || name.includes('harbor freeway')) {
            line.on('click', () => useProduct.getState().navigate(`/corridors/${name.includes('hollywood') ? 'hollywood' : name.includes('santa monica') ? 'santa-monica' : 'harbor'}`));
          } else line.bindPopup(content);
        }
        line.addTo(group);
      }
    }
    return () => { group.remove(); };
  }, [roads, viewport, layers.congestion, layers.freight, mode, map, interactive, zoom, onRoad]);
  return null;

}

function MapEffects({ focus, route, bounds, highlight, compact, expanded, onPick }: { focus?: [number, number]; route?: RouteResponse | null; bounds?: L.LatLngBounds; highlight?: GeoJsonEdgeFeature; compact: boolean; expanded: boolean; onPick?: (lat: number, lng: number) => void }) {

  const map = useMap();
  const group = useRef<L.LayerGroup | null>(null);
  const options = useStore((s) => s.routeOptions);
  const focusLat = focus?.[0];
  const focusLng = focus?.[1];
  useMapEvents({ click: (event) => onPick?.(event.latlng.lat, event.latlng.lng) });
  useEffect(() => {
    const observer = new ResizeObserver(() => map.invalidateSize({ pan: false }));
    observer.observe(map.getContainer());
    return () => observer.disconnect();
  }, [map]);
  useEffect(() => {
    map.stop();
    map.invalidateSize({ pan: false });
    // One owner for the camera prevents flyTo and fitBounds from fighting during mount.
    if (route) return;
    if (focusLat !== undefined && focusLng !== undefined) map.setView([focusLat, focusLng], compact ? 15 : 14, { animate: false });
    else if (bounds?.isValid()) map.fitBounds(bounds, { padding: compact ? [20, 20] : [35, 50], maxZoom: 15, animate: false });
  }, [focusLat, focusLng, bounds, highlight, route, compact, expanded, map]);
  useEffect(() => {
    group.current?.remove();
    const next = L.layerGroup().addTo(map); group.current = next;
    if (route) {
      const all = [...options.filter((r) => r.route_id !== route.route_id), route];
      for (const r of all) {
        const geometry = r.geojson.features[0]?.geometry;
        if (geometry?.type !== 'LineString') continue;
        const coords = geometry.coordinates.map(([x, y]) => [y, x] as [number, number]);
        const active = r.route_id === route.route_id;
        L.polyline(coords, { color: 'white', weight: active ? 10 : 7, opacity: .85, interactive: !onPick }).addTo(next);
        L.polyline(coords, { color: active ? '#387a4d' : '#bf9c50', weight: active ? 6 : 4, dashArray: active ? undefined : '10 8', interactive: !onPick, className: active ? 'p-route-flow' : '' }).addTo(next);
        if (active && coords.length) map.fitBounds(L.latLngBounds(coords), { padding: [35, 35], maxZoom: 15 });
      }
    }
    return () => { next.remove(); };
  }, [route, options, map, onPick]);
  return null;

}

function CameraMarkers({ onPick, items, onCamera, selectedCamera, forceObserved }: { forceObserved?: boolean; onPick?: (lat: number, lng: number) => void; items?: Camera[]; onCamera?: (camera: Camera) => void; selectedCamera?: string }) {

  const map = useMap();
  const cameras = useProduct((s) => s.cameras);
  const district = useProduct((s) => s.district);
  const cluster = useProduct(s => s.layers.clusterCameras !== false);
  const [zoom, setZoom] = useState(map.getZoom());
  useMapEvents({ zoomend: () => setZoom(map.getZoom()) });
  const groups = useMemo(() => {
    const visible = items || cameras.filter(c => matchesZone(district, c.district));
    const result: typeof cameras[] = [];
    for (const camera of visible) {
      const point = map.project([camera.lat, camera.lng], zoom);
      const group = cluster && zoom < 16 && !onPick ? result.find(g => point.distanceTo(map.project([g[0].lat, g[0].lng], zoom)) < 44) : undefined;
      if (group) group.push(camera); else result.push([camera]);
    }
    return result;
  }, [cameras, district, zoom, map, onPick, cluster, items]);
  return <>{groups.map(group => {
    const camera = group[0];
    const lat = group.reduce((sum, c) => sum + c.lat, 0) / group.length;
    const lng = group.reduce((sum, c) => sum + c.lng, 0) / group.length;
    const multiple = group.length > 1;
    const icon = multiple ? L.divIcon({ className: 'p-camera-cluster', html: `<span>${group.length}</span>`, iconSize: [38, 38], iconAnchor: [19, 19] }) : cameraIcon(camera.status === 'online');
    return <Marker key={group.map(c => c.id).join('-')} position={[lat, lng]} icon={icon} opacity={!multiple && selectedCamera && camera.id !== selectedCamera ? .65 : 1} title={multiple ? `${group.length} cameras · zoom in to explore` : camera.name} eventHandlers={{ click: () => {
      if (onPick) onPick(lat, lng);
      else if (multiple) map.fitBounds(L.latLngBounds(group.map(c => [c.lat, c.lng] as [number, number])), { padding: [60, 60], maxZoom: 17 });
      else if (onCamera) onCamera(camera);
      else if (forceObserved) openObservedCamera(camera.id);
      else useProduct.getState().navigate(`/cameras/${camera.id}`);
    } }}>{onCamera && !multiple && <Popup><strong>{camera.name}</strong><p>{camera.district}</p><button className="p-button" onClick={() => forceObserved ? openObservedCamera(camera.id) : useProduct.getState().navigate(`/cameras/${camera.id}`)}>Open evidence</button></Popup>}</Marker>;
  })}</>;

}

export function CityMap({ focus, selected, compact = false, pedestrians = false, route, highlight, viewEdges, signalItems, onSignal, onPick, cameraItems, onCamera, selectedCamera, mapStyle = 'streets', forceObserved = false, onRoad }: { onRoad?: (name: string) => void; forceObserved?: boolean; cameraItems?: Camera[]; onCamera?: (camera: Camera) => void; selectedCamera?: string; mapStyle?: 'streets' | 'terrain'; focus?: [number, number]; selected?: string; compact?: boolean; pedestrians?: boolean; route?: RouteResponse | null; highlight?: GeoJsonEdgeFeature; viewEdges?: GeoJsonEdgeFeature[]; signalItems?: Signal[]; onSignal?: (s: Signal) => void; onPick?: (lat: number, lng: number) => void }) {

  const layers = useProduct((s) => s.layers);
  const storedMode = useProduct((s) => s.mode);
  const mode = forceObserved ? 'observed' : storedMode;
  const district = useProduct((s) => s.district);
  const roadEdges = useStore((s) => s.geojsonEdges);
  const cameras = useProduct(s => s.cameras);
  const [expanded, setExpanded] = useState(false);
  const [terrainFailed, setTerrainFailed] = useState(false);
  const effectiveStyle = mapStyle === 'terrain' && !terrainFailed ? 'terrain' : 'streets';
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!expanded) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setExpanded(false);
      if (event.key === 'Tab') {
        const controls = root.current?.querySelectorAll<HTMLElement>('button, a[href], input, [tabindex="0"]');
        if (!controls?.length) return;
        const first = controls[0], last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    root.current?.querySelector<HTMLElement>("[aria-label=\"Close expanded map\"]")?.focus();
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [expanded]);
  const cameraPointsKey = JSON.stringify((cameraItems || cameras).map(c => ({ lat: c.lat, lng: c.lng, district: c.district })));
  const cameraPoints = useMemo(() => JSON.parse(cameraPointsKey) as { lat: number; lng: number; district: string }[], [cameraPointsKey]);
  const hasFocus = Boolean(focus);
  const customCameras = cameraItems !== undefined;
  const bounds = useMemo(() => {
    if (customCameras && !hasFocus && !route && !viewEdges) return cameraPoints.length ? L.latLngBounds(cameraPoints.map(c => [c.lat, c.lng] as [number, number])) : undefined;
    if (!viewEdges && !hasFocus && !route && district !== "All districts") {
      const local = cameraPoints.filter(c => matchesZone(district, c.district));
      const region = regions.find(r => r.name === district);
      const points = local.map(c => [c.lat, c.lng] as [number, number]);
      if (region) points.push([region.lat - .025, region.lng - .03], [region.lat + .025, region.lng + .03]);
      if (points.length) return L.latLngBounds(points);
    }
    const edges = viewEdges || (!hasFocus && !route ? roadEdges : []);
    const points = edges.flatMap(edge => edge.geometry.type === 'LineString' ? edge.geometry.coordinates.map(([x, y]) => [y, x] as [number, number]) : []);
    if (!viewEdges && !hasFocus && !route) points.push(...cameraPoints.map(c => [c.lat, c.lng] as [number, number]));
    return points.length ? L.latLngBounds(points) : undefined;
  }, [viewEdges, roadEdges, cameraPoints, district, hasFocus, route, customCameras]);
  const graphStatus = useStore((s) => s.graphStatus);
  const focusLat = focus?.[0];
  const focusLng = focus?.[1];
  const center = useMemo((): [number, number] => [focusLat ?? graphStatus?.center_latitude ?? 34.048, focusLng ?? graphStatus?.center_longitude ?? -118.259], [focusLat, focusLng, graphStatus]);
  const visible = (signalItems || signals).filter((s) => matchesZone(district, s.district));
  return <div ref={root} className={`p-city-map ${compact ? 'compact' : ''} ${expanded ? 'expanded' : ''}`} role={expanded ? 'dialog' : undefined} aria-modal={expanded || undefined} aria-label={expanded ? "Expanded map of Los Angeles" : "Mobility map"}>
    <MapContainer center={center} zoom={compact ? 14 : graphStatus?.default_zoom ?? 13} scrollWheelZoom={!compact} zoomControl={false} className="p-leaflet" attributionControl>
      <TileLayer key={effectiveStyle} eventHandlers={{ tileerror: () => { if (effectiveStyle === 'terrain') setTerrainFailed(true); } }} url={effectiveStyle === 'terrain' ? 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png' : 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'} attribution={effectiveStyle === 'terrain' ? '&copy; OpenStreetMap · SRTM | &copy; OpenTopoMap (CC-BY-SA)' : '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'} maxZoom={effectiveStyle === 'terrain' ? 17 : 19} />
      <Roads interactive={!onPick} forceObserved={forceObserved} onRoad={onRoad} /><MapEffects focus={focus} route={route} bounds={bounds} highlight={highlight} compact={compact} expanded={expanded} onPick={onPick} />
      <CorridorOverlay edges={viewEdges} />
      <SelectedSegment edge={highlight} />
      {!compact && <><ZoomControl position="topright" /><ScaleControl position="bottomleft" imperial={false} /><MapTools forceObserved={forceObserved} bounds={bounds} expanded={expanded} highlight={highlight} onExpand={() => setExpanded(v => !v)} /></>}
      {(layers.cameras || compact) && <CameraMarkers forceObserved={forceObserved} onPick={onPick} items={cameraItems} onCamera={onCamera} selectedCamera={selectedCamera} />}
      {(mode === 'presentation' || signalItems !== undefined) && (layers.incidents || compact) && visible.map((signal) => <CircleMarker key={signal.id} center={[signal.lat, signal.lng]} radius={selected === signal.id ? 13 : 7} pathOptions={{ color: signal.severity === 'high' ? '#bf6e5b' : '#b79449', fillColor: signal.severity === 'high' ? '#d48d7b' : '#d8bd7b', fillOpacity: .80, weight: selected === signal.id ? 4 : 2 }} eventHandlers={{ click: () => { if (onPick) { onPick(signal.lat, signal.lng); return; } useProduct.getState().selectSignal(signal.id); if (onSignal) onSignal(signal); else useProduct.getState().navigate('/risk-signals'); } }}><Popup>{signal.title}<br />{signal.location} · {signal.data_origin === 'observation' ? "manual review" : "illustrative scenario"}</Popup></CircleMarker>)}
      {mode === 'presentation' && (pedestrians || layers.pedestrians) && visible.filter((_, index) => index % 2 === 0).map((signal) => <Circle key={`heat-${signal.id}`} center={[signal.lat, signal.lng]} radius={190 + signal.impact} pathOptions={{ color: '#bb9d47', fillColor: signal.severity === 'high' ? '#d19354' : '#a4b77d', fillOpacity: .23, weight: 1, interactive: false }} />)}
    </MapContainer>
    {mapStyle === 'terrain' && terrainFailed && <div className="p-map-source-notice" role="status">Terrain unavailable · showing the street map</div>}
    <div className="p-map-atlas"><span className="p-compass">N<svg viewBox="0 0 20 25"><path d="M10 1L2 23l8-7 8 7z" fill="currentColor" /></svg></span><span>Greater Los Angeles<br /><b>California · US</b></span></div>
    {!compact && <div className="p-map-legend">{viewEdges && <span><i style={{ background: '#477a53', height: 5 }} />Analyzed corridor</span>}{mode === 'presentation' ? <><span><i style={{ background: '#7fac85' }} />Free-flowing</span><span><i style={{ background: '#d8b363' }} />Moderate</span><span><i style={{ background: '#cf7b69' }} />High</span></> : <span><i style={{ background: '#7fac85' }} />Road network · no traffic counts</span>}<small>{mode === 'presentation' ? "Illustrative colors" : "No congestion measurements"}</small></div>}
    {!compact && <div className="p-map-coverage">{district === "All districts" ? "Metropolitan coverage" : district} · {(cameraItems || cameras.filter(c => matchesZone(district, c.district))).length}  cameras <span>Zoom in to separate the cameras</span></div>}
  </div>;

}
