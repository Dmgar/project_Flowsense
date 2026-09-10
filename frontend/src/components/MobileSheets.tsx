import { useStore, type MobilePanel } from '../store/useStore';
import { startTrafficSimulation, stopTrafficSimulation } from '../api/client';
import { DispatchForm, ActiveRoutePanel, ActiveUnitsPanel } from './Sidebar';

export function MobileSheets() {
  const mobilePanel = useStore((s) => s.mobilePanel);
  const setMobilePanel = useStore((s) => s.setMobilePanel);

  const open = mobilePanel !== 'none';

  return (
    <div className="md:hidden">
      <div
        onClick={() => setMobilePanel('none')}
        className={`fixed inset-0 z-[700] bg-black/60 transition-opacity duration-300 ${
          open ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      />
      <div
        className={`pb-safe fixed inset-x-0 bottom-0 z-[800] transition-transform duration-300 ease-out ${
          open ? 'translate-y-0' : 'translate-y-full'
        }`}
      >
        <div className="max-h-[78dvh] overflow-y-auto rounded-t-2xl border border-b-0 border-border-primary bg-bg-panel pb-6 shadow-2xl">
          <div className="sticky top-0 z-10 flex items-center justify-between bg-bg-panel/95 px-4 py-2 backdrop-blur">
            <span className="font-mono text-[10px] font-bold uppercase tracking-widest text-accent-cyan">
              {sheetTitle(mobilePanel)}
            </span>
            <button
              onClick={() => setMobilePanel('none')}
              className="flex h-7 w-7 items-center justify-center rounded border border-border-subtle font-mono text-xs text-text-muted hover:text-text-primary"
            >
              ✕
            </button>
          </div>
          <div className="space-y-4 px-4 pt-3">
            {mobilePanel === 'dispatch' && (
              <>
                <DispatchForm />
                <ActiveRoutePanel />
              </>
            )}
            {mobilePanel === 'follow' && <ActiveUnitsPanel />}
            {mobilePanel === 'layers' && <MobileLayers close={() => setMobilePanel('none')} />}
            {mobilePanel === 'none' && (
              <div className="py-8 text-center font-mono text-[11px] text-text-muted">
                Toca un control de la barra inferior.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function sheetTitle(p: MobilePanel): string {
  switch (p) {
    case 'dispatch':
      return 'Despacho de Emergencia';
    case 'layers':
      return 'Capas y Controles';
    case 'follow':
      return 'Seguir Unidad';
    default:
      return 'FlowSense Mobile';
  }
}

function MobileLayers({ close }: { close: () => void }) {
  const showCongestionLayer = useStore((s) => s.showCongestionLayer);
  const toggleCongestionLayer = useStore((s) => s.toggleCongestionLayer);
  const isSimulating = useStore((s) => s.isSimulating);
  const setIsSimulating = useStore((s) => s.setIsSimulating);
  const isReplaying = useStore((s) => s.isReplaying);
  const setIsReplaying = useStore((s) => s.setIsReplaying);
  const replayFrames = useStore((s) => s.replayFrames);
  const setCurrentReplayIndex = useStore((s) => s.setCurrentReplayIndex);
  const toggleBenchmark = useStore((s) => s.toggleBenchmark);
  const togglePresentationMode = useStore((s) => s.togglePresentationMode);

  const toggleSim = async () => {
    if (isSimulating) {
      await stopTrafficSimulation();
      setIsSimulating(false);
    } else {
      await startTrafficSimulation(3);
      setIsSimulating(true);
    }
  };

  const handleReplay = () => {
    if (isReplaying) {
      setIsReplaying(false);
    } else {
      if (replayFrames.length === 0) {
        useStore.getState().setConnectionStatus('offline');
      }
      setCurrentReplayIndex(0);
      setIsReplaying(true);
    }
    close();
  };

  const btn = 'w-full rounded border px-3 py-2.5 font-mono text-[11px] font-bold transition-colors';
  const off = 'border-border-subtle bg-bg-tertiary text-text-secondary';

  return (
    <div className="space-y-2 pb-2">
      <button
        onClick={() => {
          toggleCongestionLayer();
        }}
        className={`${btn} ${
          showCongestionLayer
            ? 'border-emerald-500 bg-emerald-500/10 text-emerald-400'
            : off
        }`}
      >
        {showCongestionLayer ? '◉ CONGESTIÓN ON' : '○ CONGESTIÓN OFF'}
      </button>
      <button
        onClick={toggleSim}
        className={`${btn} ${
          isSimulating ? 'border-amber-500 bg-amber-500/10 text-amber-400' : off
        }`}
      >
        {isSimulating ? '■ TRAFICO ON' : '▶ TRAFICO OFF'}
      </button>
      <button
        onClick={handleReplay}
        className={`${btn} ${
          isReplaying
            ? 'border-cyan-400 bg-cyan-400/10 text-cyan-300'
            : 'border-accent-cyan/50 bg-accent-cyan/10 text-accent-cyan'
        }`}
      >
        {isReplaying ? '■ STOP REPLAY' : '▶ REPLAY DEMO'}
      </button>
      <button
        onClick={() => {
          toggleBenchmark();
          close();
        }}
        className={`${btn} ${off}`}
      >
        ▦ BENCHMARK
      </button>
      <button
        onClick={() => {
          togglePresentationMode();
          close();
        }}
        className={`${btn} border-accent-green/50 bg-accent-green/10 text-accent-green`}
      >
        ⛶ PRESENTACIÓN
      </button>
    </div>
  );
}