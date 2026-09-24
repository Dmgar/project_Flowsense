import { useEffect } from 'react';
import { MapView } from './components/MapView';
import { StatusBar } from './components/StatusBar';
import { EmergencyPlanner } from './components/EmergencyPlanner';
import { CongestionLegend } from './components/CongestionLegend';
import { DataInitializer } from './components/DataInitializer';
import { BootSplash } from './components/BootSplash';
import { useTelemetrySocket } from './hooks/useTelemetrySocket';
import { useStore } from './store/useStore';

export default function App() {
  useTelemetrySocket();
  const isBooted = useStore((s) => s.isBooted);
  const showCongestionLayer = useStore((s) => s.showCongestionLayer);
  const toggleCongestionLayer = useStore((s) => s.toggleCongestionLayer);

  useEffect(() => {
    if (!isBooted) return;
    const frame = window.requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
    return () => window.cancelAnimationFrame(frame);
  }, [isBooted]);

  return (
    <div className="app-shell">
      <BootSplash />
      <DataInitializer />
      <StatusBar />
      <main className="map-stage">
        <MapView />
        <EmergencyPlanner />
        <button
          className={`traffic-toggle ${showCongestionLayer ? 'is-active' : ''}`}
          onClick={toggleCongestionLayer}
          aria-pressed={showCongestionLayer}
        >
          <i /> Tráfico en vivo
        </button>
        <CongestionLegend />
        <div className="map-credit">New York City <span>·</span> Manhattan</div>
      </main>
    </div>
  );
}
