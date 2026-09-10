import { useStore } from '../store/useStore';

export function TimelineScrubber() {
  const isReplaying = useStore((s) => s.isReplaying);
  const replayFrames = useStore((s) => s.replayFrames);
  const currentReplayIndex = useStore((s) => s.currentReplayIndex);
  const setCurrentReplayIndex = useStore((s) => s.setCurrentReplayIndex);
  const setIsReplaying = useStore((s) => s.setIsReplaying);
  const updateEdgeCongestion = useStore((s) => s.updateEdgeCongestion);
  const updateVehicle = useStore((s) => s.updateVehicle);
  const setActiveRoute = useStore((s) => s.setActiveRoute);

  if (!isReplaying || replayFrames.length === 0) return null;

  const seek = (idx: number) => {
    const frame = replayFrames[idx];
    if (!frame) return;
    for (const e of frame.edges) {
      updateEdgeCongestion(e.u, e.v, e.key, e.congestion_factor, e.vehicle_count);
    }
    for (const v of frame.vehicles) {
      updateVehicle(v);
    }
    if (frame.route) setActiveRoute(frame.route);
    setCurrentReplayIndex(idx);
  };

  const time = replayFrames[currentReplayIndex]?.timestamp;
  const timeLabel = time
    ? new Date(time).toLocaleTimeString('es-ES', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
    : '--';

  return (
    <div className="pointer-events-auto absolute bottom-6 left-1/2 z-[500] w-[560px] max-w-[70vw] -translate-x-1/2 rounded-lg border border-accent-cyan/40 bg-bg-panel/95 p-3 shadow-xl backdrop-blur">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-widest text-accent-cyan">
          ▶ Replay — Modo Demo
        </span>
        <span className="font-mono text-[10px] tabular-nums text-text-muted">
          {timeLabel} · frame {currentReplayIndex + 1}/{replayFrames.length}
        </span>
      </div>
      <input
        type="range"
        min={0}
        max={replayFrames.length - 1}
        value={currentReplayIndex}
        onChange={(e) => seek(Number(e.target.value))}
        className="w-full accent-cyan-400"
      />
      <div className="mt-1 flex justify-between font-mono text-[9px] text-text-muted">
        <span>INICIO</span>
        <button
          onClick={() => setIsReplaying(!isReplaying)}
          className="px-2 py-0.5 font-mono text-[10px] text-accent-cyan hover:bg-accent-cyan/10"
        >
          {isReplaying ? 'PAUSA' : 'REANUDAR'}
        </button>
        <span>FIN</span>
      </div>
    </div>
  );
}