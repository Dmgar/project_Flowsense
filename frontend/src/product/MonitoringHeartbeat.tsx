import { useEffect } from 'react';
import { apiUrl } from '../api/urls';
import { monitoringEvents, monitoringClientId, monitoringCameraIds, transientMonitoringCameraIds } from './monitoring';

export function MonitoringHeartbeat() {
  useEffect(() => {
    const memoryClient = monitoringClientId();
    let previous = new Set<string>(), inFlight = new Set<string>(), running = false, rerun = false, pageClosing = false;
    let retryTimer: number | undefined;
    let retryDelay = 1_000;
    let handler: () => void = () => {};
    const scheduleRetry = () => {
      window.clearTimeout(retryTimer);
      retryTimer = window.setTimeout(handler, retryDelay);
      retryDelay = Math.min(15_000, retryDelay * 2);
    };
    const releaseTransientLeases = () => {
      // Include the live registry: pagehide may fire before the initial POST
      // finishes and before `previous` has been populated.
      const transient = transientMonitoringCameraIds([...previous, ...inFlight, ...monitoringCameraIds()]);
      void Promise.allSettled(transient.map(id => fetch(apiUrl(`/api/v1/mobility/video/cameras/${encodeURIComponent(id)}/monitoring/${memoryClient}`), { method: 'DELETE', keepalive: true })));
      previous = new Set([...previous].filter(id => !transient.includes(id)));
    };
    const update = async () => {
      if (running) { rerun = true; return; }
      running = true;
      try {
        do {
          rerun = false;
          const current = new Set(monitoringCameraIds());
          inFlight = current;
          const releases = await Promise.allSettled([...previous].filter(id => !current.has(id)).map(id => fetch(apiUrl(`/api/v1/mobility/video/cameras/${encodeURIComponent(id)}/monitoring/${memoryClient}`), { method: 'DELETE', keepalive: true, signal: AbortSignal.timeout(10000) })));
          const renewals = await Promise.allSettled([...current].map(id => fetch(apiUrl(`/api/v1/mobility/video/cameras/${encodeURIComponent(id)}/monitoring`), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client_id: memoryClient }), signal: AbortSignal.timeout(10000) })));
          inFlight = new Set();
          previous = current;
          // A monitor POST can complete after pagehide's DELETE. Release again
          // after the in-flight request settles so a closed tab cannot leave a
          // transient camera lease alive until its server-side timeout.
          if (pageClosing) releaseTransientLeases();
          const failed = [...releases, ...renewals].some(result => result.status === 'rejected'
            || (result.status === 'fulfilled' && !result.value.ok));
          if (failed) scheduleRetry();
          else {
            retryDelay = 1_000;
            window.clearTimeout(retryTimer);
            retryTimer = undefined;
          }
          if ([...previous].join() !== monitoringCameraIds().join()) rerun = true;
        } while (rerun);
      } catch {
        scheduleRetry();
      } finally {
        running = false;
        if (rerun) { rerun = false; queueMicrotask(handler); }
      }
    };
    handler = () => void update();
    monitoringEvents.addEventListener('change', handler);
    document.addEventListener('visibilitychange', handler);
    window.addEventListener('focus', handler);
    window.addEventListener('pageshow', handler);
    window.addEventListener('online', handler);
    const handlePageHide = () => { pageClosing = true; releaseTransientLeases(); };
    const handlePageShow = () => { pageClosing = false; handler(); };
    window.addEventListener('pagehide', handlePageHide);
    window.addEventListener('pageshow', handlePageShow);
    handler();
    const timer = window.setInterval(handler, 15000);
    return () => {
      pageClosing = true;
      clearInterval(timer);
      window.clearTimeout(retryTimer);
      monitoringEvents.removeEventListener('change', handler);
      document.removeEventListener('visibilitychange', handler);
      window.removeEventListener('focus', handler);
      window.removeEventListener('pageshow', handlePageShow);
      window.removeEventListener('online', handler);
      window.removeEventListener('pagehide', handlePageHide);
      releaseTransientLeases();
    };
  }, []);
  return null;
}
