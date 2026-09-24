import { useEffect, useMemo, useRef, useState } from 'react';
import { computeAlternativeRoutes, computeRoute } from '../api/client';
import { useStore, type MapPlace } from '../store/useStore';
import type { RouteResponse, RouteStep, VehicleType } from '../types';

const PLACES: MapPlace[] = [
  { label: 'NYU Langone Health', latitude: 40.7424, longitude: -73.9743, category: 'hospital' },
  { label: 'Bellevue Hospital', latitude: 40.7394, longitude: -73.9746, category: 'hospital' },
  { label: 'Weill Cornell Medical Center', latitude: 40.7643, longitude: -73.9555, category: 'hospital' },
  { label: 'Lenox Hill Hospital', latitude: 40.7738, longitude: -73.9601, category: 'hospital' },
  { label: 'FDNY Engine 54 / Ladder 4', latitude: 40.7638, longitude: -73.9856, category: 'fire_station' },
  { label: 'FDNY Engine 21', latitude: 40.7487, longitude: -73.9722, category: 'fire_station' },
  { label: 'FDNY Engine 65', latitude: 40.7108, longitude: -73.9957, category: 'fire_station' },
];

function distanceKm(a: MapPlace, b: MapPlace) {
  const rad = (n: number) => (n * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLon = rad(b.longitude - a.longitude);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function formatDuration(seconds: number) {
  const minutes = Math.max(1, Math.round(seconds / 60));
  return `${minutes} min`;
}

function bearing(from: RouteStep, to: RouteStep) {
  const radians = (value: number) => (value * Math.PI) / 180;
  const lat1 = radians(from.latitude);
  const lat2 = radians(to.latitude);
  const deltaLon = radians(to.longitude - from.longitude);
  const y = Math.sin(deltaLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLon);
  return (Math.atan2(y, x) * 180) / Math.PI;
}

function streetName(name: string | null) {
  return name?.split(/[;,]/)[0].trim() || 'la vía';
}

function buildDirections(route: RouteResponse) {
  const waypoints = route.waypoints;
  if (waypoints.length < 2) return [];

  const groups: { name: string; distance: number; startIndex: number }[] = [];
  for (let i = 0; i < waypoints.length - 1; i += 1) {
    const name = streetName(waypoints[i].street_name);
    const previous = groups[groups.length - 1];
    if (previous?.name === name) previous.distance += waypoints[i].length_m;
    else groups.push({ name, distance: waypoints[i].length_m, startIndex: i });
  }

  return groups.map((group, index) => {
    const distance = group.distance >= 1000
      ? `${(group.distance / 1000).toFixed(1)} km`
      : `${Math.round(group.distance / 10) * 10} m`;
    if (index === 0) return `Continúa por ${group.name} durante ${distance}`;

    const turnIndex = group.startIndex;
    const incoming = bearing(waypoints[turnIndex - 1], waypoints[turnIndex]);
    const outgoing = bearing(waypoints[turnIndex], waypoints[Math.min(turnIndex + 1, waypoints.length - 1)]);
    const delta = ((outgoing - incoming + 540) % 360) - 180;
    const action = Math.abs(delta) < 28 ? 'Continúa' : delta > 0 ? 'Gira a la derecha' : 'Gira a la izquierda';
    return `${action} hacia ${group.name} · ${distance}`;
  });
}

export function EmergencyPlanner() {
  const [vehicleType, setVehicleType] = useState<VehicleType>('ambulance');
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [isLocating, setIsLocating] = useState(false);
  const [isRouting, setIsRouting] = useState(false);
  const [isNavigating, setIsNavigating] = useState(false);
  const [locationMessage, setLocationMessage] = useState('');
  const [routeMessage, setRouteMessage] = useState('');
  const navigationWatchRef = useRef<number | null>(null);
  const lastRerouteOriginRef = useRef<MapPlace | null>(null);
  const rerouteInFlightRef = useRef(false);
  const navigationDestinationRef = useRef<MapPlace | null>(null);
  const origin = useStore((s) => s.origin);
  const setOrigin = useStore((s) => s.setOrigin);
  const destination = useStore((s) => s.destination);
  const setDestination = useStore((s) => s.setDestination);
  const activeRoute = useStore((s) => s.activeRoute);
  const setActiveRoute = useStore((s) => s.setActiveRoute);
  const routeOptions = useStore((s) => s.routeOptions);
  const setRouteOptions = useStore((s) => s.setRouteOptions);
  const graphStatus = useStore((s) => s.graphStatus);

  const stopNavigation = () => {
    if (navigationWatchRef.current !== null) {
      navigator.geolocation.clearWatch(navigationWatchRef.current);
      navigationWatchRef.current = null;
    }
    lastRerouteOriginRef.current = null;
    navigationDestinationRef.current = null;
    setIsNavigating(false);
  };

  useEffect(() => () => {
    if (navigationWatchRef.current !== null) navigator.geolocation.clearWatch(navigationWatchRef.current);
  }, []);

  useEffect(() => {
    if (isNavigating && destination !== navigationDestinationRef.current) stopNavigation();
  }, [destination, isNavigating]);
  const online = useStore((s) => s.connectionStatus === 'connected');

  const filteredPlaces = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    return PLACES.filter((place) => {
      const matchesType = vehicleType === 'ambulance' ? place.category === 'hospital' : place.category === 'fire_station';
      return matchesType && (!term || place.label.toLocaleLowerCase().includes(term));
    }).slice(0, 4);
  }, [query, vehicleType]);

  const choosePlace = (place: MapPlace) => {
    stopNavigation();
    setDestination(place);
    setQuery(place.label);
    setSearchOpen(false);
    setRouteMessage('');
    setActiveRoute(null);
    setRouteOptions([]);
  };

  const locateMe = () => {
    if (!navigator.geolocation) {
      setLocationMessage('Este dispositivo no permite compartir la ubicación.');
      return;
    }
    setIsLocating(true);
    setLocationMessage('');
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const current = { label: 'Mi ubicación', latitude: coords.latitude, longitude: coords.longitude, category: 'destination' as const };
        setOrigin(current);
        setActiveRoute(null);
        setRouteOptions([]);
        setIsLocating(false);
        setLocationMessage('Ubicación actualizada');
      },
      () => {
        setIsLocating(false);
        setLocationMessage('No se pudo obtener la ubicación. Puedes elegir el punto en el mapa.');
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 15000 },
    );
  };

  const startNavigation = () => {
    if (!destination || !activeRoute) return;
    if (!navigator.geolocation) {
      setLocationMessage('Este dispositivo no permite navegación GPS. Puedes seguir las indicaciones de la ruta.');
      return;
    }

    navigationDestinationRef.current = destination;
    lastRerouteOriginRef.current = null;
    rerouteInFlightRef.current = false;
    setIsNavigating(true);
    setLocationMessage('Esperando la ubicación GPS…');
    navigationWatchRef.current = navigator.geolocation.watchPosition(async ({ coords }) => {
      const current: MapPlace = {
        label: 'Mi ubicación',
        latitude: coords.latitude,
        longitude: coords.longitude,
        category: 'destination',
      };
      const latestOrigin = useStore.getState().origin;
      if (distanceKm(latestOrigin, current) >= 0.015) setOrigin(current);
      setLocationMessage('Navegación GPS activa · actualizando mientras avanzas');

      const previous = lastRerouteOriginRef.current;
      if (rerouteInFlightRef.current || (previous && distanceKm(previous, current) < 0.15)) return;
      rerouteInFlightRef.current = true;
      lastRerouteOriginRef.current = current;
      try {
        const route = await computeRoute({
          origin: { latitude: current.latitude, longitude: current.longitude },
          destination: { latitude: destination.latitude, longitude: destination.longitude },
          vehicle_type: vehicleType,
          priority: 'high',
        });
        if (useStore.getState().destination !== destination) return;
        setActiveRoute(route);
        setRouteOptions([route]);
        setRouteMessage('Ruta actualizada desde tu posición GPS.');
      } catch {
        setLocationMessage('No se pudo actualizar la ruta. Comprueba la conexión con FlowSense.');
      } finally {
        rerouteInFlightRef.current = false;
      }
    }, (error) => {
      stopNavigation();
      setLocationMessage(error.code === error.PERMISSION_DENIED
        ? 'Activa el permiso de ubicación para iniciar la navegación GPS.'
        : 'No se pudo leer el GPS. Puedes continuar con las indicaciones guardadas.');
    }, { enableHighAccuracy: true, maximumAge: 3000, timeout: 15000 });
  };

  const planRoute = async () => {
    if (!destination) return;
    setIsRouting(true);
    setRouteMessage('');
    try {
      const result = await computeAlternativeRoutes({
        origin: { latitude: origin.latitude, longitude: origin.longitude },
        destination: { latitude: destination.latitude, longitude: destination.longitude },
        vehicle_type: vehicleType,
        priority: 'high',
      }, 3);
      const routes = [result.primary, ...result.alternatives];
      setRouteOptions(routes);
      setActiveRoute(result.primary);
      setRouteMessage(graphStatus?.is_synthetic
        ? 'Ruta calculada sobre la cuadrícula de respaldo.'
        : 'Ruta calculada siguiendo calles de OpenStreetMap.');
    } catch (error) {
      setRouteOptions([]);
      setActiveRoute(null);
      const detail = error instanceof Error ? error.message.toLowerCase() : '';
      setRouteMessage(detail.includes('synthetic') || detail.includes('street data is unavailable')
        ? 'Los datos reales de calles no están disponibles en este momento.'
        : detail.includes('street network')
          ? 'El origen o el destino queda fuera de la cobertura vial disponible de Manhattan.'
          : 'No se pudo calcular por calles. Comprueba que el backend FlowSense esté conectado.');
    } finally {
      setIsRouting(false);
    }
  };

  const placesLabel = vehicleType === 'ambulance' ? 'Hospitales cercanos' : 'Estaciones de bomberos';
  const vehicleName = vehicleType === 'ambulance' ? 'Ambulancia' : 'Bomberos';

  return (
    <section className="planner-card" aria-label="Planear ruta de emergencia">
      <div className="planner-heading">
        <div className="planner-brand"><span className="brand-mark">F</span><span>FlowSense</span></div>
        <span className={`service-status ${online ? 'is-online' : ''}`}><i />{online ? 'En línea' : 'Modo demo'}</span>
      </div>
      <p className="planner-eyebrow">NAVEGACIÓN DE EMERGENCIA</p>
      <h1>¿A dónde vamos?</h1>
      <p className="planner-subtitle">Busca un lugar o toca cualquier punto del mapa.</p>

      <div className="vehicle-switch" role="group" aria-label="Tipo de unidad">
        <button className={vehicleType === 'ambulance' ? 'selected' : ''} onClick={() => { stopNavigation(); setVehicleType('ambulance'); setQuery(''); setDestination(null); setActiveRoute(null); setRouteOptions([]); }} aria-pressed={vehicleType === 'ambulance'}>
          <span>🚑</span> Ambulancia
        </button>
        <button className={vehicleType === 'fire_truck' ? 'selected' : ''} onClick={() => { stopNavigation(); setVehicleType('fire_truck'); setQuery(''); setDestination(null); setActiveRoute(null); setRouteOptions([]); }} aria-pressed={vehicleType === 'fire_truck'}>
          <span>🚒</span> Bomberos
        </button>
      </div>

      <div className="place-search-wrap">
        <label className="place-search">
          <span className="search-icon" aria-hidden="true">⌕</span>
          <input value={query} onChange={(event) => { setQuery(event.target.value); setSearchOpen(true); }} onFocus={() => setSearchOpen(true)} onKeyDown={(event) => { if (event.key === 'Escape') setSearchOpen(false); if (event.key === 'Enter' && filteredPlaces[0]) choosePlace(filteredPlaces[0]); }} placeholder="Buscar destino en Manhattan" aria-label="Buscar destino" />
          {query && <button className="clear-search" aria-label="Limpiar búsqueda" onClick={() => { setQuery(''); setDestination(null); setActiveRoute(null); setRouteOptions([]); }}>×</button>}
        </label>
        {searchOpen && (
          <div className="search-results">
            <p>{placesLabel}</p>
            {filteredPlaces.length ? filteredPlaces.map((place) => (
              <button key={place.label} onMouseDown={(event) => event.preventDefault()} onClick={() => choosePlace(place)}>
                <span className="place-result-icon">{vehicleType === 'ambulance' ? '✚' : '♨'}</span>
                <span>{place.label}<small>{distanceKm(origin, place).toFixed(1)} km aprox.</small></span>
                <b>›</b>
              </button>
            )) : <span className="no-results">No hay coincidencias. Elige un punto en el mapa.</span>}
          </div>
        )}
      </div>

      <button className="origin-row" onClick={locateMe} disabled={isLocating}>
        <span className="origin-dot">●</span>
        <span><small>PUNTO DE SALIDA</small><strong>{origin.label}</strong></span>
        <span className="origin-action">{isLocating ? 'Buscando…' : 'Usar mi ubicación'}</span>
      </button>
      {locationMessage && <p className="inline-message">{locationMessage}</p>}

      {destination ? (
        <div className="destination-selected"><span className="destination-pin">●</span><span><small>DESTINO</small><strong>{destination.label}</strong></span><button aria-label="Quitar destino" onClick={() => { setDestination(null); setActiveRoute(null); setRouteOptions([]); setQuery(''); }}>×</button></div>
      ) : (
        <div className="map-hint"><span>↙</span> Toca el mapa para elegir el destino</div>
      )}

      <button className="route-button" onClick={planRoute} disabled={!destination || isRouting}>
        {isRouting ? 'Buscando rutas por calles…' : `Buscar rutas por calles · ${vehicleName}`}
        <span>→</span>
      </button>
      {activeRoute && destination && (
        <div className="route-summary">
          <div className="route-summary-top"><span><i /> RUTA SELECCIONADA</span><strong>{formatDuration(activeRoute.total_estimated_time_s)}</strong></div>
          <p>{(activeRoute.total_distance_m / 1000).toFixed(1)} km <span>·</span> {destination.label}</p>
          {routeMessage && <small>{routeMessage}</small>}
          <button className={`navigation-button ${isNavigating ? 'navigating' : ''}`} onClick={isNavigating ? stopNavigation : startNavigation}>
            {isNavigating ? '■ Detener navegación' : '▶ Iniciar navegación GPS'}
          </button>
          <div className="route-options" aria-label="Rutas disponibles">
            {routeOptions.map((route, index) => (
              <button key={route.route_id} className={route.route_id === activeRoute.route_id ? 'selected' : ''} onClick={() => setActiveRoute(route)}>
                <strong>{formatDuration(route.total_estimated_time_s)}</strong>
                <span>{(route.total_distance_m / 1000).toFixed(1)} km</span>
                <small>{index === 0 ? 'Recomendada' : `Alternativa ${index}`}</small>
              </button>
            ))}
          </div>
          <ol className="route-directions">
            {buildDirections(activeRoute).map((instruction, index) => <li key={`${activeRoute.route_id}-${index}`}>{instruction}</li>)}
          </ol>
        </div>
      )}
      {routeMessage && !activeRoute && <p className="route-error" role="status">{routeMessage}</p>}
      <div className="planner-footnote">Mapa © OpenStreetMap · Sin inicio de sesión</div>
    </section>
  );
}
