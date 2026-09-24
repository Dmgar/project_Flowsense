import { useEffect, useRef } from 'react';
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import { useStore } from '../store/useStore';
import { MANHATTAN_CENTER } from '../data/mock';
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

  return (
    <div className="absolute inset-0">
      <MapContainer
        center={[MANHATTAN_CENTER[1], MANHATTAN_CENTER[0]]}
        zoom={13}
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
        <FlyToSelectedUnit />
        <MapController />
        <DestinationPicker />
        <ShowPlaces />
        {!isPresentationMode && <ZoomControls />}
      </MapContainer>
    </div>
  );
}
