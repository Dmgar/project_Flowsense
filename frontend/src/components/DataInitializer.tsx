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

    async function init() {
      try {
        const [status, edges] = await Promise.all([
          fetchGraphStatus(),
          fetchGraphGeoJson(),
        ]);
        if (cancelled) return;
        if (edges.length === 0) throw new Error('Grafo vacío');
        setGraphStatus(status);
        useStore.getState().setOrigin({
          label: status.city_profile === 'los_angeles' ? 'Downtown Los Angeles' : status.city_profile === 'cartagena' ? 'Centro, Cartagena' : 'Midtown Manhattan',
          latitude: status.center_latitude,
          longitude: status.center_longitude,
          category: 'destination',
        });
        setGeojsonEdges(edges);
        setReplayFrames([]);
        addAlert({
          message: `Grafo cargado: ${status.edge_count} segmentos en ${status.city}`,
          severity: 'info',
          timestamp: new Date().toISOString(),
        });
      } catch {
        if (cancelled) return;
        useStore.getState().setConnectionStatus('offline');
        setGeojsonEdges([]);
        setReplayFrames([]);
        addAlert({
          message: 'Backend no disponible. La red y las cámaras se cargarán al reconectar.',
          severity: 'warning',
          timestamp: new Date().toISOString(),
        });
      } finally {
        if (!cancelled) setIsBooted(true);
      }
    }

    init();
    return () => {
      cancelled = true;
    };
  }, [setGraphStatus, setGeojsonEdges, setReplayFrames, addAlert, setIsBooted]);

  return null;
}
