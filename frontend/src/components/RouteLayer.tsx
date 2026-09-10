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
  const staticRef = useRef<L.Polyline | null>(null);

  const dynamicCoords = useMemo(() => routeToLatLngs(activeRoute), [activeRoute]);
  const staticCoords = useMemo(() => staticToLatLngs(activeRoute), [activeRoute]);

  useEffect(() => {
    if (dynamicRef.current) {
      dynamicRef.current.remove();
      dynamicRef.current = null;
    }
    if (!dynamicCoords?.length) return;

    const poly = L.polyline(dynamicCoords, {
      color: '#00e5ff',
      weight: 6,
      opacity: 0.95,
      dashArray: '14 8',
      lineCap: 'round',
      className: 'animate-dash-flow',
    });
    poly.addTo(map);
    dynamicRef.current = poly;
    return () => {
      poly.remove();
      dynamicRef.current = null;
    };
  }, [map, dynamicCoords]);

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