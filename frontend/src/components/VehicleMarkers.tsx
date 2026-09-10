import { useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import { useStore } from '../store/useStore';
import type { VehiclePosition } from '../types';

function vehicleIcon(kind: 'ambulance' | 'fire', heading: number): L.DivIcon {
  const emoji = kind === 'ambulance' ? '🚑' : '🚒';
  const glow = kind === 'ambulance' ? 'rgba(0,230,118,.8)' : 'rgba(255,23,68,.8)';
  return L.divIcon({
    className: 'vehicle-marker',
    html: `<div class="vehicle-wrap" style="transform:rotate(${heading}deg);width:24px;height:24px;display:flex;align-items:center;justify-content:center;filter:drop-shadow(0 0 4px ${glow})"><span class="vehicle-emoji" style="font-size:20px;line-height:1">${emoji}</span></div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });
}

function tooltipHtml(v: VehiclePosition): string {
  return `<div class="text-[11px] font-mono">
    <div class="text-cyan-300 font-bold">${v.vehicle_id}</div>
    <div>Velocidad: <b>${v.speed_kmh.toFixed(0)} km/h</b></div>
    <div>Heading: <b>${v.heading.toFixed(0)}°</b></div>
    <div>Corredor despejado: <b>${v.corridor_cleared_ahead_m.toFixed(0)} m</b></div>
  </div>`;
}

export function VehicleMarkers() {
  const map = useMap();
  const vehicles = useStore((s) => s.vehicles);
  const setFollowUnitId = useStore((s) => s.setFollowUnitId);
  const markersRef = useRef<Map<string, L.Marker>>(new Map());

  useEffect(() => {
    const ids = Object.keys(vehicles);
    const live = new Set(ids);

    for (const id of ids) {
      const v = vehicles[id];
      const kind: 'ambulance' | 'fire' =
        v.vehicle_id.toLowerCase().includes('amb') || v.vehicle_id.includes('MEDIC')
          ? 'ambulance'
          : 'fire';

      let marker = markersRef.current.get(id);
      if (!marker) {
        marker = L.marker([v.latitude, v.longitude], {
          icon: vehicleIcon(kind, v.heading),
          zIndexOffset: 1000,
        });
        marker.bindTooltip(tooltipHtml(v), { sticky: true, direction: 'top' });
        marker.on('click', () => setFollowUnitId(v.vehicle_id));
        marker.addTo(map);
        markersRef.current.set(id, marker);
      } else {
        marker.setLatLng([v.latitude, v.longitude]);
        const el = marker.getElement();
        const wrap = el?.querySelector('.vehicle-wrap') as HTMLElement | null;
        if (wrap) wrap.style.transform = `rotate(${v.heading}deg)`;
        marker.setTooltipContent(tooltipHtml(v));
      }
    }

    for (const [id, marker] of markersRef.current) {
      if (!live.has(id)) {
        marker.remove();
        markersRef.current.delete(id);
      }
    }
  }, [vehicles, map, setFollowUnitId]);

  return null;
}