import { useEffect, useMemo, useRef } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import { useStore } from '../store/useStore';
import type { RouteResponse } from '../types';

function routeToLatLngs(route: RouteResponse | null): L.LatLngExpression[] | null {
  const geometry = route?.geojson?.features?.[0]?.geometry;
  if (!geometry || geometry.type !== 'LineString') return null;
  return geometry.coordinates.map(([lon, lat]) => [lat, lon] as L.LatLngExpression);
}

export function RouteLayer() {
  const map = useMap();
  const activeRoute = useStore((s) => s.activeRoute);
  const routeOptions = useStore((s) => s.routeOptions);
  const lastFitRouteId = useRef<string | null>(null);
  const activeCoords = useMemo(() => routeToLatLngs(activeRoute), [activeRoute]);

  useEffect(() => {
    const routeGroup = L.layerGroup().addTo(map);

    for (const route of routeOptions) {
      if (route.route_id === activeRoute?.route_id) continue;
      const coords = routeToLatLngs(route);
      if (!coords?.length) continue;
      L.polyline(coords, {
        color: '#82958a',
        weight: 5,
        opacity: 0.72,
        lineCap: 'round',
        lineJoin: 'round',
      }).addTo(routeGroup);
    }

    if (activeCoords?.length) {
      L.polyline(activeCoords, {
        color: '#ffffff',
        weight: 11,
        opacity: 0.92,
        lineCap: 'round',
        lineJoin: 'round',
      }).addTo(routeGroup);
      L.polyline(activeCoords, {
        color: '#228450',
        weight: 7,
        opacity: 1,
        lineCap: 'round',
        lineJoin: 'round',
      }).addTo(routeGroup);

      if (activeRoute && lastFitRouteId.current !== activeRoute.route_id) {
        const mobile = window.matchMedia('(max-width: 640px)').matches;
        map.fitBounds(L.latLngBounds(activeCoords), {
          paddingTopLeft: mobile ? [12, 475] : [420, 48],
          paddingBottomRight: mobile ? [12, 72] : [35, 35],
          maxZoom: 16,
          animate: true,
        });
        lastFitRouteId.current = activeRoute.route_id;
      }
    }

    return () => {
      routeGroup.remove();
    };
  }, [activeCoords, activeRoute, map, routeOptions]);

  return null;
}
