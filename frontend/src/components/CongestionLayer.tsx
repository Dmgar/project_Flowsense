import { useEffect, useMemo, useRef } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import { useStore } from '../store/useStore';
import type { GeoJsonEdgeFeature } from '../types';

function edgeKey(p: GeoJsonEdgeFeature['properties']): string {
  return `${p.u}-${p.v}-${p.key}`;
}

function toLatLngs(e: GeoJsonEdgeFeature): L.LatLngExpression[] {
  const coords = e.geometry.type === 'LineString' ? e.geometry.coordinates : [];
  return coords.map(([lon, lat]) => [lat, lon] as L.LatLngExpression);
}

function edgeStyle(p: GeoJsonEdgeFeature['properties']): L.PathOptions {
  return {
    color: p.color,
    weight: p.highway === 'primary' || p.highway === 'secondary' ? 2.2 : 1.4,
    opacity: 0.85,
  };
}

function tooltipContent(p: GeoJsonEdgeFeature['properties']): string {
  return `<div class="text-[11px] font-mono">
    <div class="text-cyan-300 font-bold">${p?.name ?? 'Segmento'}</div>
    <div>Velocidad: <b>${p?.average_speed_kmh?.toFixed(1) ?? '--'} km/h</b></div>
    <div>Vehículos: <b>${p?.vehicle_count ?? 0}</b></div>
    <div>Longitud: <b>${p?.length?.toFixed(0) ?? '--'} m</b></div>
    <div>Congestión: <b>${((p?.congestion_factor ?? 0) * 100).toFixed(0)}%</b></div>
  </div>`;
}

const SEVERE_THRESHOLD = 0.7;

export function CongestionLayer() {
  const map = useMap();
  const geojsonEdges = useStore((s) => s.geojsonEdges);
  const pathsRef = useRef<Map<string, L.Polyline>>(new Map());
  const severeRef = useRef<Set<string>>(new Set());
  const pulseOnRef = useRef(false);

  const renderer = useMemo(() => L.canvas({ padding: 0.5, tolerance: 8 }), []);

  useEffect(() => {
    if (geojsonEdges.length === 0) return;

    severeRef.current = new Set(
      geojsonEdges
        .filter((e) => (e.properties.congestion_factor ?? 0) >= SEVERE_THRESHOLD)
        .map((e) => edgeKey(e.properties))
    );

    for (const edge of geojsonEdges) {
      const path = pathsRef.current.get(edgeKey(edge.properties));
      if (path) {
        path.setStyle(edgeStyle(edge.properties));
        path.setTooltipContent(tooltipContent(edge.properties));
      }
    }

    const knownKeys = new Set(geojsonEdges.map((e) => edgeKey(e.properties)));

    for (const [k, path] of pathsRef.current) {
      if (!knownKeys.has(k)) {
        path.remove();
        pathsRef.current.delete(k);
      }
    }

    for (const edge of geojsonEdges) {
      const k = edgeKey(edge.properties);
      if (pathsRef.current.has(k)) continue;

      const path = L.polyline(toLatLngs(edge), {
        ...edgeStyle(edge.properties),
        renderer,
      });
      path.bindTooltip(tooltipContent(edge.properties), {
        sticky: true,
        direction: 'top',
        className: 'flowsense-tooltip',
      });
      path.addTo(map);
      pathsRef.current.set(k, path);
    }
  }, [renderer, map, geojsonEdges]);

  useEffect(() => {
    const pulse = setInterval(() => {
      pulseOnRef.current = !pulseOnRef.current;
      for (const k of severeRef.current) {
        const path = pathsRef.current.get(k);
        if (!path) continue;
        path.setStyle(
          pulseOnRef.current
            ? { opacity: 1, weight: 3 }
            : { opacity: 0.55, weight: 1.4 }
        );
      }
    }, 800);
    return () => clearInterval(pulse);
  }, []);

  useEffect(() => {
    const current = pathsRef.current;
    return () => {
      current.forEach((p) => p.remove());
      current.clear();
      severeRef.current.clear();
    };
  }, []);

  return null;
}