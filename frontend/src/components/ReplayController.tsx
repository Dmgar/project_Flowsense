import { useEffect, useRef } from 'react';
import { useStore } from '../store/useStore';

export function ReplayController() {
  const isReplaying = useStore((s) => s.isReplaying);
  const replayFrames = useStore((s) => s.replayFrames);
  const updateEdgeCongestion = useStore((s) => s.updateEdgeCongestion);
  const updateVehicle = useStore((s) => s.updateVehicle);
  const addAlert = useStore((s) => s.addAlert);
  const setActiveRoute = useStore((s) => s.setActiveRoute);
  const intervalRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  useEffect(() => {
    if (!isReplaying) {
      clearInterval(intervalRef.current);
      return;
    }
    if (replayFrames.length === 0) return;

    const applyFrame = (frame: (typeof replayFrames)[number]) => {
      for (const e of frame.edges) {
        updateEdgeCongestion(e.u, e.v, e.key, e.congestion_factor, e.vehicle_count);
      }
      for (const v of frame.vehicles) {
        updateVehicle(v);
      }
      for (const a of frame.alerts) {
        addAlert(a);
      }
      if (frame.route) setActiveRoute(frame.route);
    };

    applyFrame(replayFrames[0]);

    intervalRef.current = setInterval(() => {
      const store = useStore.getState();
      const next = store.currentReplayIndex + 1;
      if (next >= replayFrames.length) {
        clearInterval(intervalRef.current);
        store.setIsReplaying(false);
        return;
      }
      applyFrame(replayFrames[next]);
      store.setCurrentReplayIndex(next);
    }, 1500);

    return () => clearInterval(intervalRef.current);
  }, [isReplaying, replayFrames, updateEdgeCongestion, updateVehicle, addAlert, setActiveRoute]);

  return null;
}