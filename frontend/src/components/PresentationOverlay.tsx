import { useStore } from '../store/useStore';

export function PresentationOverlay() {
  const isPresentationMode = useStore((s) => s.isPresentationMode);
  const secondsSaved = useStore((s) => s.secondsSaved);
  const togglePresentationMode = useStore((s) => s.togglePresentationMode);

  if (!isPresentationMode) return null;

  return (
    <div className="pointer-events-none absolute inset-0 z-[900] flex flex-col justify-between p-4">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-mono text-xl font-bold tracking-widest text-text-primary">
            FLOWSENSE
          </h1>
          <p className="font-mono text-[11px] text-accent-cyan">
            PRIORITY ROUTING & PERCEPTION · EMERGENCY RESPONSE
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="rounded border border-emerald-500/30 bg-bg-panel/70 px-3 py-1.5 font-mono text-[11px] text-emerald-400 backdrop-blur">
            OPENCV AI COMPETITION 2026
          </div>
          <button
            onClick={togglePresentationMode}
            className="pointer-events-auto rounded border border-border-subtle bg-bg-panel/70 px-3 py-1.5 font-mono text-[11px] text-text-muted backdrop-blur hover:text-text-primary"
          >
            SALIR (ESC)
          </button>
        </div>
      </div>

      <div className="flex items-end justify-between">
        <p className="max-w-xs font-mono text-[10px] leading-relaxed text-text-muted">
          No ALPR · No facial recognition · Solo conteos agregados de vehículos.
          Datos públicos: UA-DETRAC / BDD100K.
        </p>
        <div className="text-right">
          <div className="font-mono text-[10px] text-text-muted">SEGUNDOS SALVADOS</div>
          <div className="font-mono text-4xl font-bold tabular-nums text-accent-green">
            {secondsSaved}
          </div>
        </div>
      </div>
    </div>
  );
}