import { useEffect, useRef } from 'react';
import { CircleMarker, MapContainer, Marker, Popup, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import { useStore } from '../store/useStore';
import { CongestionLayer } from './CongestionLayer';
import { RouteLayer } from './RouteLayer';
import { VehicleMarkers } from './VehicleMarkers';
import 'leaflet/dist/leaflet.css';

const pinIcon = L.divIcon({
  className: 'place-pin-shell',
  html: '<span class="place-pin"><span></span></span>',
  iconSize: [28, 36],
  iconAnchor: [14, 32],
});

function DestinationPicker() {
  const setDestination = useStore((s) => s.setDestination);
  const setActiveRoute = useStore((s) => s.setActiveRoute);
  const setRouteOptions = useStore((s) => s.setRouteOptions);
  useMapEvents({
    click(event) {
      setDestination({
        label: 'Punto seleccionado en el mapa',
        latitude: event.latlng.lat,
        longitude: event.latlng.lng,
        category: 'destination',
      });
      setActiveRoute(null);
      setRouteOptions([]);
    },
  });
  return null;
}

function ShowPlaces() {
  const origin = useStore((s) => s.origin);
  const destination = useStore((s) => s.destination);
  return <>
    <Marker position={[origin.latitude, origin.longitude]} icon={L.divIcon({ className: 'origin-marker-shell', html: '<span class="origin-marker">＋</span>', iconSize: [34, 34], iconAnchor: [17, 17] })} />
    {destination && <Marker position={[destination.latitude, destination.longitude]} icon={pinIcon} />}
  </>;
}

function IncidentMarkers() {
  const incidents = useStore((s) => s.incidentPoints);
  const floods = useStore((s) => s.floodReports);
  return <>{incidents.map((incident) => <CircleMarker
    key={incident.incident_id}
    center={[incident.latitude, incident.longitude]}
    radius={incident.status === 'validated' ? 10 : 8}
    pathOptions={{
      color: incident.status === 'validated' ? '#b84b3e' : '#d89a32',
      fillColor: incident.status === 'validated' ? '#df685b' : '#f0bd5c',
      fillOpacity: 0.82, weight: 2,
    }}
  ><Popup><strong>{incident.label}</strong><br />{incident.status === 'validated' ? 'Validado · vías afectadas' : 'Pendiente de verificación'}<br />Score de evidencia: {Math.round(incident.confidence * 100)}%</Popup></CircleMarker>)}
  {floods.filter((f) => ['pending_review', 'confirmed'].includes(f.status)).map((f) => <CircleMarker key={f.report_id}
    center={[f.latitude, f.longitude]} radius={f.status === 'confirmed' ? 12 : 8}
    pathOptions={{ color: '#087d99', fillColor: f.status === 'confirmed' ? '#18b8d2' : '#8ddce8', fillOpacity: 0.85, weight: 2 }}>
    <Popup><strong>{f.demo ? 'SIMULACIÓN · ' : ''}Agua reportada: {f.depth_cm} cm</strong><br />{f.status === 'confirmed' ? 'Confirmada · rutas excluyen el tramo' : 'Pendiente · aún no afecta rutas'}<br />Vence: {new Date(f.expires_at).toLocaleTimeString('es-CO')}</Popup>
  </CircleMarker>)}</>;
}

function ZoomControls() {
  const map = useMap();
  useEffect(() => {
    const control = L.control.zoom({ position: 'topright' }).addTo(map);
    return () => {
      control.remove();
    };
  }, [map]);
  return null;
}

function FlyToSelectedUnit() {
  const map = useMap();
  const followUnitId = useStore((s) => s.followUnitId);
  const vehicles = useStore((s) => s.vehicles);
  const lastFollowRef = useRef<string | null>(null);

  useEffect(() => {
    if (!followUnitId || followUnitId === lastFollowRef.current) return;
    const v = vehicles[followUnitId];
    if (!v) return;
    lastFollowRef.current = followUnitId;
    map.flyTo([v.latitude, v.longitude], 16, { duration: 1.2 });
  }, [followUnitId, map, vehicles]);

  return null;
}

function MapController() {
  const map = useMap();
  const origin = useStore((s) => s.origin);
  const followUnitId = useStore((s) => s.followUnitId);
  const vehicles = useStore((s) => s.vehicles);
  const prevPosRef = useRef<{ lat: number; lon: number } | null>(null);
  const originRef = useRef<{ lat: number; lon: number } | null>(null);

  useEffect(() => {
    const prev = originRef.current;
    if (prev && (Math.abs(prev.lat - origin.latitude) > 1e-5 || Math.abs(prev.lon - origin.longitude) > 1e-5)) {
      map.flyTo([origin.latitude, origin.longitude], 15, { duration: 0.8 });
    }
    originRef.current = { lat: origin.latitude, lon: origin.longitude };
  }, [origin, map]);

  useEffect(() => {
    if (!followUnitId) return;
    const v = vehicles[followUnitId];
    if (!v) return;
    const prev = prevPosRef.current;
    if (prev && (Math.abs(prev.lat - v.latitude) > 1e-5 || Math.abs(prev.lon - v.longitude) > 1e-5)) {
      map.panTo([v.latitude, v.longitude], { animate: true });
    }
    prevPosRef.current = { lat: v.latitude, lon: v.longitude };
  }, [followUnitId, vehicles, map]);

  return null;
}

export function MapView() {
  const showCongestionLayer = useStore((s) => s.showCongestionLayer);
  const isPresentationMode = useStore((s) => s.isPresentationMode);
  const graphStatus = useStore((s) => s.graphStatus);
  const cityProfile = graphStatus?.city_profile ?? 'cartagena';
  const mapCenter: [number, number] = graphStatus
    ? [graphStatus.center_longitude, graphStatus.center_latitude]
    : cityProfile === 'cartagena' ? [-75.4794, 10.3910] : [-73.9857, 40.7484];

  return (
    <div className="absolute inset-0">
      <MapContainer key={cityProfile} center={[mapCenter[1], mapCenter[0]]}
        zoom={graphStatus?.default_zoom ?? 12}
        className="h-full w-full"
        zoomControl={false}
        attributionControl={!isPresentationMode}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          maxZoom={19}
        />
        {showCongestionLayer && <CongestionLayer />}
        <RouteLayer />
        <VehicleMarkers />
        <IncidentMarkers />
        <FlyToSelectedUnit />
        <MapController />
        <DestinationPicker />
        <ShowPlaces />
        {!isPresentationMode && <ZoomControls />}
      </MapContainer>
    </div>
  );
}
