import { useEffect, useRef } from 'react';
import { useStore, type ReplaySpeed } from '../store/useStore';

export function ReplayController() {
  const isReplaying = useStore((s) => s.isReplaying);
  const replayFrames = useStore((s) => s.replayFrames);
  const replaySpeed = useStore((s) => s.replaySpeed);
  const updateEdgeCongestion = useStore((s) => s.updateEdgeCongestion);
  const updateVehicle = useStore((s) => s.updateVehicle);
  const addAlert = useStore((s) => s.addAlert);
  const setActiveRoute = useStore((s) => s.setActiveRoute);
  const intervalRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const prevPlayingRef = useRef(false);
  const prevSpeedRef = useRef<ReplaySpeed>(replaySpeed);

  useEffect(() => {
    if (!isReplaying) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = undefined;
      prevPlayingRef.current = false;
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

    const step = () => {
      const store = useStore.getState();
      const next = store.currentReplayIndex + 1;
      if (next >= replayFrames.length) {
        if (intervalRef.current) clearInterval(intervalRef.current);
        intervalRef.current = undefined;
        prevPlayingRef.current = false;
        store.setIsReplaying(false);
        return;
      }
      applyFrame(replayFrames[next]);
      store.setCurrentReplayIndex(next);
    };

    const startedFresh = isReplaying && !prevPlayingRef.current;
    if (startedFresh) {
      applyFrame(replayFrames[0]);
      prevPlayingRef.current = true;
    }

    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(step, 1500 / replaySpeed);
    prevSpeedRef.current = replaySpeed;

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = undefined;
    };
  }, [
    isReplaying,
    replayFrames,
    replaySpeed,
    updateEdgeCongestion,
    updateVehicle,
    addAlert,
    setActiveRoute,
  ]);

  return null;
}