import { useStore } from '../store/useStore';

export function CongestionLegend() {
  const showCongestionLayer = useStore((s) => s.showCongestionLayer);
  if (!showCongestionLayer) return null;

  return (
    <div className="congestion-legend">
      <div className="legend-heading">
        <span>Tráfico en vivo</span><span className="legend-live"><i /> DEMO</span>
      </div>
      <div className="legend-scale">
        <span className="traffic-free" /><span className="traffic-medium" /><span className="traffic-heavy" />
      </div>
      <div className="legend-labels">
        <span>Fluido</span><span>Moderado</span><span>Intenso</span>
      </div>
    </div>
  );
}
