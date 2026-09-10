import { useEffect, useRef } from 'react';
import { MapContainer, TileLayer, useMap } from 'react-leaflet';
import { useStore } from '../store/useStore';
import { MANHATTAN_CENTER } from '../data/mock';
import { CongestionLayer } from './CongestionLayer';
import { RouteLayer } from './RouteLayer';
import { VehicleMarkers } from './VehicleMarkers';
import 'leaflet/dist/leaflet.css';

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
  const followUnitId = useStore((s) => s.followUnitId);
  const vehicles = useStore((s) => s.vehicles);
  const prevPosRef = useRef<{ lat: number; lon: number } | null>(null);

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

  return (
    <div className="absolute inset-0">
      <MapContainer
        center={MANHATTAN_CENTER}
        zoom={13}
        className="h-full w-full"
        zoomControl={!isPresentationMode}
        attributionControl={!isPresentationMode}
      >
        <TileLayer
          attribution='&copy; OpenStreetMap contributors &copy; CARTO'
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          subdomains="abcd"
          maxZoom={19}
        />
        {showCongestionLayer && <CongestionLayer />}
        <RouteLayer />
        <VehicleMarkers />
        <FlyToSelectedUnit />
        <MapController />
      </MapContainer>
    </div>
  );
}