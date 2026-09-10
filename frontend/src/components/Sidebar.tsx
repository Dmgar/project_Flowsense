import { useState } from 'react';
import { useStore } from '../store/useStore';
import { computeRoute, startTrafficSimulation, stopTrafficSimulation } from '../api/client';
import type { RouteResponse } from '../types';

const ORIGINS = [
  { label: 'Colombus Circle', lat: 40.7681, lon: -73.9819 },
  { label: 'Times Square', lat: 40.7580, lon: -73.9855 },
  { label: 'Madison Square', lat: 40.7419, lon: -73.9878 },
  { label: 'Union Square', lat: 40.7359, lon: -73.9911 },
];

const DESTINATIONS = [
  { label: 'Bellevue Hospital', lat: 40.7394, lon: -73.9746 },
  { label: 'NYU Langone', lat: 40.7424, lon: -73.9743 },
  { label: 'Weill Cornell', lat: 40.7643, lon: -73.9555 },
  { label: 'Central Park South', lat: 40.7670, lon: -73.9751 },
];

function formatEta(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m} min ${s.toString().padStart(2, '0')} s`;
}

interface RouteCardProps {
  route: RouteResponse;
  label: string;
  tone: 'static' | 'dynamic';
}

function RouteCard({ route, label, tone }: RouteCardProps) {
  const accent = tone === 'dynamic' ? 'text-accent-cyan border-accent-cyan/40' : 'text-text-muted border-border-subtle';
  return (
    <div className={`rounded border bg-bg-tertiary/60 p-3 ${accent}`}>
      <div className="mb-2 flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-wider text-text-muted">{label}</span>
        <span className="font-mono text-[10px] text-text-muted">{route.route_id}</span>
      </div>
      <div className="flex justify-between gap-2">
        <div>
          <div className="font-mono text-[10px] text-text-muted">ETA</div>
          <div className="font-mono text-lg font-bold tabular-nums text-text-primary">
            {formatEta(route.total_estimated_time_s)}
          </div>
        </div>
        <div>
          <div className="font-mono text-[10px] text-text-muted">DISTANCIA</div>
          <div className="font-mono text-lg font-bold tabular-nums text-text-primary">
            {(route.total_distance_m / 1000).toFixed(1)} km
          </div>
        </div>
      </div>
    </div>
  );
}

export function Sidebar() {
  const [originIdx, setOriginIdx] = useState(1);
  const [destIdx, setDestIdx] = useState(0);
  const [vehicleType, setVehicleType] = useState<'ambulance' | 'fire_truck'>('ambulance');
  const [isLoading, setIsLoading] = useState(false);

  const activeRoute = useStore((s) => s.activeRoute);
  const setActiveRoute = useStore((s) => s.setActiveRoute);
  const isSimulating = useStore((s) => s.isSimulating);
  const setIsSimulating = useStore((s) => s.setIsSimulating);
  const addAlert = useStore((s) => s.addAlert);
  const secondsSaved = useStore((s) => s.secondsSaved);
  const vehicles = useStore((s) => s.vehicles);

  const origin = ORIGINS[originIdx];
  const dest = DESTINATIONS[destIdx];

  const handleDispatch = async (simulate: boolean) => {
    setIsLoading(true);
    try {
      const dynamicRoute = await computeRoute(
        {
          origin: { latitude: origin.lat, longitude: origin.lon },
          destination: { latitude: dest.lat, longitude: dest.lon },
          vehicle_type: vehicleType,
          priority: 'high',
        },
        simulate
      );

      setActiveRoute(dynamicRoute);
      const savedThisRoute = Math.max(
        0,
        dynamicRoute.baseline_eta_seconds - dynamicRoute.total_estimated_time_s
      );
      if (savedThisRoute > 0) {
        useStore.getState().addSecondsSaved(Math.round(savedThisRoute));
      }
      if (dynamicRoute.savings_pct > 0) {
        addAlert({
          message: `FlowSense rehusó tráfico: ${dynamicRoute.savings_pct}% más rápido que ruta estática`,
          severity: 'info',
          timestamp: new Date().toISOString(),
        });
      }
    } catch (err) {
      addAlert({
        message: `Error de despacho: ${err instanceof Error ? err.message : 'desconocido'}`,
        severity: 'warning',
        timestamp: new Date().toISOString(),
      });
    } finally {
      setIsLoading(false);
    }
  };

  const toggleSimulation = async () => {
    if (isSimulating) {
      await stopTrafficSimulation();
    } else {
      await startTrafficSimulation(3);
    }
    setIsSimulating(!isSimulating);
  };

  return (
    <aside className="flex w-80 flex-col gap-4 overflow-y-auto border-l border-border-primary bg-bg-panel p-4">
      <section className="rounded border border-border-subtle bg-bg-tertiary/40 p-4">
        <h2 className="mb-3 font-mono text-xs font-bold uppercase tracking-widest text-text-secondary">
          Despacho de Emergencia
        </h2>

        <label className="mb-1 block font-mono text-[10px] text-text-muted">ORIGEN</label>
        <select
          value={originIdx}
          onChange={(e) => setOriginIdx(Number(e.target.value))}
          className="mb-3 w-full rounded border border-border-subtle bg-bg-tertiary px-2 py-1.5 font-mono text-xs text-text-primary outline-none focus:border-accent-cyan"
        >
          {ORIGINS.map((o, i) => (
            <option key={o.label} value={i}>
              {o.label}
            </option>
          ))}
        </select>

        <label className="mb-1 block font-mono text-[10px] text-text-muted">DESTINO</label>
        <select
          value={destIdx}
          onChange={(e) => setDestIdx(Number(e.target.value))}
          className="mb-3 w-full rounded border border-border-subtle bg-bg-tertiary px-2 py-1.5 font-mono text-xs text-text-primary outline-none focus:border-accent-cyan"
        >
          {DESTINATIONS.map((d, i) => (
            <option key={d.label} value={i}>
              {d.label}
            </option>
          ))}
        </select>

        <label className="mb-1 block font-mono text-[10px] text-text-muted">VEHÍCULO</label>
        <div className="mb-4 grid grid-cols-2 gap-2">
          {(['ambulance', 'fire_truck'] as const).map((vt) => (
            <button
              key={vt}
              onClick={() => setVehicleType(vt)}
              className={`rounded border px-2 py-1.5 font-mono text-xs transition-colors ${
                vehicleType === vt
                  ? 'border-accent-cyan bg-accent-cyan/15 text-accent-cyan'
                  : 'border-border-subtle text-text-secondary hover:border-text-muted'
              }`}
            >
              {vt === 'ambulance' ? '🚑 Ambulancia' : '🚒 Bomberos'}
            </button>
          ))}
        </div>

        <button
          onClick={() => handleDispatch(true)}
          disabled={isLoading}
          className="w-full rounded border border-accent-cyan bg-accent-cyan/20 px-3 py-2 font-mono text-xs font-bold text-accent-cyan transition-colors hover:bg-accent-cyan/30 disabled:opacity-40"
        >
          {isLoading ? 'CALCULANDO…' : 'SIMULAR DESPACHO'}
        </button>

        <button
          onClick={() => handleDispatch(true)}
          disabled={isLoading}
          className="mt-2 w-full rounded border border-accent-green bg-accent-green/10 px-3 py-2 font-mono text-xs font-bold text-accent-green transition-colors hover:bg-accent-green/20 disabled:opacity-40"
        >
          DESPACHO + TELEMETRÍA
        </button>

        <button
          onClick={toggleSimulation}
          className={`mt-2 w-full rounded border px-3 py-1.5 font-mono text-xs transition-colors ${
            isSimulating
              ? 'border-red-500 bg-red-500/10 text-red-400 hover:bg-red-500/20'
              : 'border-amber-500 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20'
          }`}
        >
          {isSimulating ? '■ DETENER TRÁFICO SIMULADO' : '▶ INICIAR TRÁFICO SIMULADO'}
        </button>
      </section>

      {activeRoute && (
        <section className="animate-fade-in rounded border border-border-subtle bg-bg-tertiary/40 p-4">
          <h2 className="mb-3 font-mono text-xs font-bold uppercase tracking-widest text-text-secondary">
            Corredor de Emergencia
          </h2>
          <div className="space-y-3">
            <RouteCard route={activeRoute} label="FlowSense Dinámico" tone="dynamic" />
            {activeRoute.baseline_eta_seconds > 0 && (
              <RouteCard
                route={{
                  ...activeRoute,
                  total_estimated_time_s: activeRoute.baseline_eta_seconds,
                  total_distance_m: activeRoute.baseline_distance_m,
                }}
                label="Ruta Estática (baseline)"
                tone="static"
              />
            )}
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2 border-t border-border-subtle pt-3">
            <div className="rounded bg-bg-tertiary p-2 text-center">
              <div className="font-mono text-sm font-bold tabular-nums text-accent-green">
                {activeRoute.savings_pct.toFixed(1)}%
              </div>
              <div className="font-mono text-[10px] text-text-muted">AHORRO DE TIEMPO</div>
            </div>
            <div className="rounded bg-bg-tertiary p-2 text-center">
              <div className="font-mono text-sm font-bold tabular-nums text-accent-cyan">
                {Object.keys(vehicles).length}
              </div>
              <div className="font-mono text-[10px] text-text-muted">UNIDADES</div>
            </div>
          </div>
          <div className="mt-3 rounded bg-bg-tertiary p-2 text-center">
            <div className="font-mono text-2xl font-bold tabular-nums text-accent-green">
              {secondsSaved.toLocaleString('es-ES')}
            </div>
            <div className="font-mono text-[10px] text-text-muted">SEGUNDOS SALVADOS ACUMULADOS</div>
          </div>
        </section>
      )}

      <section className="rounded border border-border-subtle p-4">
        <h2 className="mb-2 font-mono text-xs font-bold uppercase tracking-widest text-text-secondary">
          Unidades Activas
        </h2>
        <div className="space-y-2">
          {Object.values(vehicles).length === 0 && (
            <p className="font-mono text-[11px] text-text-muted">Sin unidades activas.</p>
          )}
          {Object.values(vehicles).map((v) => (
            <div
              key={v.vehicle_id}
              className="flex items-center justify-between rounded bg-bg-tertiary/60 px-2 py-1.5"
            >
              <div>
                <div className="font-mono text-xs text-text-primary">{v.vehicle_id}</div>
                <div className="font-mono text-[10px] text-text-muted">
                  {v.speed_kmh.toFixed(0)} km/h · {v.heading.toFixed(0)}°
                </div>
              </div>
              <span
                className={`h-2 w-2 rounded-full ${v.speed_kmh > 0 ? 'bg-emerald-400 animate-pulse' : 'bg-slate-600'}`}
              />
            </div>
          ))}
        </div>
      </section>
    </aside>
  );
}