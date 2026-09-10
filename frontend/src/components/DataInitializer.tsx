import { useEffect } from 'react';
import { useStore } from '../store/useStore';
import { fetchGraphStatus, fetchGraphGeoJson, startTrafficSimulation } from '../api/client';
import { generateMockReplay, generateMockEdges } from '../data/mock';

export function DataInitializer() {
  const setGraphStatus = useStore((s) => s.setGraphStatus);
  const setGeojsonEdges = useStore((s) => s.setGeojsonEdges);
  const setReplayFrames = useStore((s) => s.setReplayFrames);
  const addAlert = useStore((s) => s.addAlert);

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
        setGeojsonEdges(edges);
        setReplayFrames(generateMockReplay(30));
        addAlert({
          message: `Grafo cargado: ${status.edge_count} segmentos en ${status.city}`,
          severity: 'info',
          timestamp: new Date().toISOString(),
        });
        await startTrafficSimulation(3);
        if (!cancelled) useStore.getState().setIsSimulating(true);
      } catch {
        if (cancelled) return;
        useStore.getState().setConnectionStatus('offline');
        if (useStore.getState().geojsonEdges.length === 0) {
          setGeojsonEdges(generateMockEdges());
        }
        setReplayFrames(generateMockReplay(30));
        addAlert({
          message: 'Backend no disponible — activado MODO MOCK OFFLINE',
          severity: 'warning',
          timestamp: new Date().toISOString(),
        });
      }
    }

    init();
    return () => {
      cancelled = true;
    };
  }, [setGraphStatus, setGeojsonEdges, setReplayFrames, addAlert]);

  return null;
}