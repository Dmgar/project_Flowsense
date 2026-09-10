import { useStore } from '../store/useStore';

export function CongestionLegend() {
  const showCongestionLayer = useStore((s) => s.showCongestionLayer);
  if (!showCongestionLayer) return null;

  return (
    <div className="pointer-events-none absolute bottom-20 left-3 z-[500] rounded border border-border-primary bg-bg-panel/90 p-3 backdrop-blur md:bottom-5 md:left-4">
      <div className="mb-2 font-mono text-[10px] uppercase tracking-widest text-text-secondary">
        Congestión
      </div>
      <div className="flex h-2.5 w-48 overflow-hidden rounded-full">
        <div className="flex-1 bg-[#00e676]" />
        <div className="flex-1 bg-[#76ff03]" />
        <div className="flex-1 bg-[#ffea00]" />
        <div className="flex-1 bg-[#ffab00]" />
        <div className="flex-1 bg-[#ff6d00]" />
        <div className="flex-1 bg-[#ff1744]" />
      </div>
      <div className="mt-1 flex justify-between font-mono text-[9px] text-text-muted">
        <span>LIBRE</span>
        <span>MODERADO</span>
        <span>CRÍTICO</span>
      </div>
    </div>
  );
}