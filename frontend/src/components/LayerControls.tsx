import { useStore } from '../store/useStore';
import { stopTrafficSimulation, startTrafficSimulation } from '../api/client';

export function LayerControls() {
  const showCongestionLayer = useStore((s) => s.showCongestionLayer);
  const toggleCongestionLayer = useStore((s) => s.toggleCongestionLayer);
  const vehicles = useStore((s) => s.vehicles);
  const setFollowUnitId = useStore((s) => s.setFollowUnitId);

  const isSimulating = useStore((s) => s.isSimulating);
  const setIsSimulating = useStore((s) => s.setIsSimulating);
  const toggleBenchmark = useStore((s) => s.toggleBenchmark);
  const togglePresentationMode = useStore((s) => s.togglePresentationMode);
  const isPresentationMode = useStore((s) => s.isPresentationMode);
  const isReplaying = useStore((s) => s.isReplaying);
  const setIsReplaying = useStore((s) => s.setIsReplaying);
  const replayFrames = useStore((s) => s.replayFrames);
  const setCurrentReplayIndex = useStore((s) => s.setCurrentReplayIndex);
  const setConnectionStatus = useStore((s) => s.setConnectionStatus);

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
      return;
    }
    if (replayFrames.length === 0) {
      setConnectionStatus('offline');
    }
    setCurrentReplayIndex(0);
    setIsReplaying(true);
  };

  const btn =
    'rounded border px-3 py-1.5 font-mono text-[11px] font-bold transition-colors';

  return (
    <div className="absolute bottom-6 right-4 z-[500] hidden flex-col items-end gap-2 md:flex">
      <div className="flex flex-col items-end gap-2 rounded border border-border-primary bg-bg-panel/90 p-3 backdrop-blur">
        <div className="mb-1 w-full font-mono text-[10px] uppercase tracking-widest text-text-muted">
          Controles
        </div>
        <button
          onClick={toggleCongestionLayer}
          className={`${btn} ${
            showCongestionLayer
              ? 'border-emerald-500 bg-emerald-500/10 text-emerald-400'
              : 'border-border-subtle text-text-muted'
          }`}
        >
          {showCongestionLayer ? '◉ CONGESTIÓN ON' : '○ CONGESTIÓN OFF'}
        </button>
        <button
          onClick={toggleSim}
          className={`${btn} ${
            isSimulating
              ? 'border-amber-500 bg-amber-500/10 text-amber-400'
              : 'border-border-subtle bg-bg-tertiary text-text-secondary'
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
      </div>

      <div className="flex flex-col gap-2 rounded border border-border-primary bg-bg-panel/90 p-3 backdrop-blur">
        <div className="mb-1 w-full font-mono text-[10px] uppercase tracking-widest text-text-muted">
          Vista
        </div>
        {Object.keys(vehicles).map((id) => (
          <button
            key={id}
            onClick={() => setFollowUnitId(id)}
            className={`${btn} border-border-subtle text-text-secondary`}
          >
            ◎ SEGUIR {id}
          </button>
        ))}
        <button
          onClick={() => setFollowUnitId(null)}
          className={`${btn} border-border-subtle text-text-muted`}
        >
          ✕ SOLTAR UNIDAD
        </button>
      </div>

      <div className="flex gap-2">
        <button
          onClick={toggleBenchmark}
          className={`${btn} border-border-subtle bg-bg-tertiary text-text-secondary`}
        >
          ▦ BENCHMARK
        </button>
        {!isPresentationMode && (
          <button
            onClick={togglePresentationMode}
            className={`${btn} border-accent-green/50 bg-accent-green/10 text-accent-green`}
          >
            ⛶ PRESENTACIÓN
          </button>
        )}
      </div>
    </div>
  );
}