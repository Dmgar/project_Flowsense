import { useEffect, useMemo, useRef } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import { useStore } from '../store/useStore';
import type { RouteResponse } from '../types';

function routeToLatLngs(route: RouteResponse | null): L.LatLngExpression[] | null {
  const fc = route?.geojson;
  if (!fc?.features?.length) return null;
  const geom = fc.features[0].geometry;
  if (geom.type !== 'LineString') return null;
  return geom.coordinates.map(([lon, lat]) => [lat, lon] as L.LatLngExpression);
}

function staticToLatLngs(route: RouteResponse | null): L.LatLngExpression[] | null {
  const fc = route?.static_geojson;
  if (!fc?.features?.length) return null;
  const geom = fc.features[0].geometry;
  if (geom.type !== 'LineString') return null;
  return geom.coordinates.map(([lon, lat]) => [lat, lon] as L.LatLngExpression);
}

export function RouteLayer() {
  const map = useMap();
  const activeRoute = useStore((s) => s.activeRoute);
  const dynamicRef = useRef<L.Polyline | null>(null);
  const glowRef = useRef<L.Polyline | null>(null);
  const staticRef = useRef<L.Polyline | null>(null);

  const dynamicCoords = useMemo(() => routeToLatLngs(activeRoute), [activeRoute]);
  const staticCoords = useMemo(() => staticToLatLngs(activeRoute), [activeRoute]);
  const recalculated = activeRoute?.recalculated === true;

  useEffect(() => {
    const removeLayer = (ref: { current: L.Polyline | null }) => {
      if (ref.current) {
        ref.current.remove();
        ref.current = null;
      }
    };

    removeLayer(glowRef);
    removeLayer(dynamicRef);
    if (!dynamicCoords?.length) return;

    const glow = L.polyline(dynamicCoords, {
      color: '#00e5ff',
      weight: 14,
      opacity: 0.12,
      lineCap: 'round',
    });
    glow.addTo(map);
    glowRef.current = glow;

    const poly = L.polyline(dynamicCoords, {
      color: '#00e5ff',
      weight: 6,
      opacity: 0.95,
      dashArray: '14 8',
      lineCap: 'round',
      className: recalculated ? 'animate-dash-flow-fast' : 'animate-dash-flow',
    });
    poly.addTo(map);
    dynamicRef.current = poly;

    return () => {
      if (dynamicRef.current) {
        dynamicRef.current.remove();
        dynamicRef.current = null;
      }
      if (glowRef.current) {
        glowRef.current.remove();
        glowRef.current = null;
      }
    };
  }, [map, dynamicCoords, recalculated]);

  useEffect(() => {
    if (staticRef.current) {
      staticRef.current.remove();
      staticRef.current = null;
    }
    if (!staticCoords?.length) return;

    const poly = L.polyline(staticCoords, {
      color: '#64748b',
      weight: 3,
      opacity: 0.5,
      dashArray: '6 6',
    });
    poly.addTo(map);
    staticRef.current = poly;
    return () => {
      poly.remove();
      staticRef.current = null;
    };
  }, [map, staticCoords]);

  return null;
}