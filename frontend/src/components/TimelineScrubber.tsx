import { useStore } from '../store/useStore';

export function TimelineScrubber() {
  const isReplaying = useStore((s) => s.isReplaying);
  const replayFrames = useStore((s) => s.replayFrames);
  const currentReplayIndex = useStore((s) => s.currentReplayIndex);
  const setCurrentReplayIndex = useStore((s) => s.setCurrentReplayIndex);
  const setIsReplaying = useStore((s) => s.setIsReplaying);
  const replaySpeed = useStore((s) => s.replaySpeed);
  const setReplaySpeed = useStore((s) => s.setReplaySpeed);
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

  const speedBtn = (v: 1 | 2) =>
    `rounded px-2 py-0.5 font-mono text-[10px] transition-colors ${
      replaySpeed === v
        ? 'bg-accent-cyan/15 text-accent-cyan'
        : 'text-text-muted hover:text-text-secondary'
    }`;

  return (
    <div className="pointer-events-auto absolute bottom-20 left-1/2 z-[500] w-[min(560px,calc(100vw-1rem))] -translate-x-1/2 rounded-lg border border-accent-cyan/40 bg-bg-panel/95 p-3 shadow-xl backdrop-blur md:bottom-6">
      <div className="mb-2 flex items-center justify-between gap-2">
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
      <div className="mt-1 flex items-center justify-between font-mono text-[9px] text-text-muted">
        <span>INICIO</span>
        <div className="flex items-center gap-1">
          <button onClick={() => setReplaySpeed(1)} className={speedBtn(1)}>
            x1
          </button>
          <button onClick={() => setReplaySpeed(2)} className={speedBtn(2)}>
            x2
          </button>
          <button
            onClick={() => setIsReplaying(!isReplaying)}
            className="px-2 py-0.5 font-mono text-[10px] text-accent-cyan hover:bg-accent-cyan/10"
          >
            {isReplaying ? 'PAUSA' : 'REANUDAR'}
          </button>
        </div>
        <span>FIN</span>
      </div>
    </div>
  );
}