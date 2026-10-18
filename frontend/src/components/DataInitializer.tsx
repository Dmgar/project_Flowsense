import { useEffect } from 'react';
import { useStore } from '../store/useStore';
import { fetchGraphStatus, fetchGraphGeoJson } from '../api/client';

export function DataInitializer() {
  const setGraphStatus = useStore((s) => s.setGraphStatus);
  const setGeojsonEdges = useStore((s) => s.setGeojsonEdges);
  const setReplayFrames = useStore((s) => s.setReplayFrames);
  const addAlert = useStore((s) => s.addAlert);
  const setIsBooted = useStore((s) => s.setIsBooted);

  useEffect(() => {
    let cancelled = false;
    let pending: AbortController | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    async function init() {
      if (cancelled || pending || useStore.getState().geojsonEdges.length) return;
      clearTimeout(retryTimer);
      const controller = new AbortController();
      pending = controller;
      const deadline = setTimeout(() => controller.abort(), 25000);
      try {
        const [status, edges] = await Promise.all([
          fetchGraphStatus(controller.signal),
          fetchGraphGeoJson(controller.signal),
        ]);
        if (cancelled) return;
        if (edges.length === 0) throw new Error("Empty graph");
        setGraphStatus(status);
        useStore.getState().setOrigin({
          label: status.city_profile === 'los_angeles' ? 'Downtown Los Angeles' : status.city_profile === 'cartagena' ? "Downtown, Cartagena" : 'Midtown Manhattan',
          latitude: status.center_latitude,
          longitude: status.center_longitude,
          category: 'destination',
        });
        setGeojsonEdges(edges);
        setReplayFrames([]);
        addAlert({
          message: `Graph loaded: ${status.edge_count} segments in ${status.city}`,
          severity: 'info',
          timestamp: new Date().toISOString(),
        });
      } catch {
        if (cancelled) return;
        setGeojsonEdges([]);
        setReplayFrames([]);
        addAlert({
          message: "Backend unavailable. The network and cameras will load when the connection is restored.",
          severity: 'warning',
          timestamp: new Date().toISOString(),
        });
        retryTimer = setTimeout(init, 10000);
      } finally {
        clearTimeout(deadline);
        pending = null;
        if (!cancelled) setIsBooted(true);
      }
    }

    init();
    window.addEventListener('online', init);
    return () => {
      cancelled = true;
      clearTimeout(retryTimer);
      pending?.abort();
      window.removeEventListener('online', init);
    };
  }, [setGraphStatus, setGeojsonEdges, setReplayFrames, addAlert, setIsBooted]);

  return null;
}
