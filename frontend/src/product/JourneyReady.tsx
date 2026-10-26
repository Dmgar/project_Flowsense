import { useEffect } from 'react';
import { useProduct } from './store';
import { useStore } from '../store/useStore';
import { destinationEvents } from './journey';

// Inside Suspense: a navigation click alone does not mark the destination ready.
export function JourneyReady() {
  const touring = useProduct(s => s.demoIndex >= 0);
  const path = useProduct(s => s.path);
  const loaded = useProduct(s => s.cameraCatalogLoaded);
  const catalogFailed = useProduct(s => s.cameraCatalogFailed);
  const cameras = useProduct(s => s.cameras);
  const casesLoaded = useProduct(s => s.casesLoaded);
  const casesLoadStatus = useProduct(s => s.casesLoadStatus);
  const roads = useStore(s => s.geojsonEdges.length > 0);
  useEffect(() => {
    if (touring) return;
    const frame = requestAnimationFrame(() => {
      const screen = document.querySelector('#product-content [data-journey-active="true"] .p-screen');
      const events = destinationEvents(path, {
        screen: !!screen && !screen.querySelector('[role="alert"]'), cameras: loaded && !catalogFailed,
        camera: cameras.some(camera => camera.id === path.split('/')[2]),
        cases: casesLoaded && casesLoadStatus === 'ready', roads,
      });
      events.forEach(event => useProduct.getState().recordJourney(event));
    });
    return () => cancelAnimationFrame(frame);
  }, [path, loaded, catalogFailed, cameras, casesLoaded, casesLoadStatus, roads, touring]);
  return null;
}
