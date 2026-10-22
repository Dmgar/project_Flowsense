
const changed = new EventTarget();
let memoryStart = new Date().toISOString();
let memoryClient: string = crypto.randomUUID();
let monitored: string[] = [];
let registered: string[] = [];
const activeViewers = new Map<string, Set<string>>();
try {
  memoryStart = sessionStorage.getItem('flowsense-monitoring-start') || memoryStart;
  memoryClient = sessionStorage.getItem('flowsense-monitoring-client') || memoryClient;
  monitored = JSON.parse(sessionStorage.getItem('flowsense-monitoring-cameras') || '[]').filter((value: unknown) => typeof value === 'string').slice(-4);
  registered = JSON.parse(sessionStorage.getItem('flowsense-monitoring-registered') || '[]');
  sessionStorage.setItem('flowsense-monitoring-start', memoryStart);
  sessionStorage.setItem('flowsense-monitoring-client', memoryClient);
} catch { /* Session memory still works when browser storage is unavailable. */ }

export const monitoringStartedAt = () => memoryStart;
export const isMonitoring = (camera: string) => monitored.includes(camera);
export const transientMonitoringCameraIds = (cameras: Iterable<string>) =>
  [...new Set(cameras)].filter(camera => !monitored.includes(camera));
export function registerMonitoring(camera: string) {
  if (registered.includes(camera)) return;
  registered.push(camera);
  try { sessionStorage.setItem('flowsense-monitoring-registered', JSON.stringify(registered)); } catch { /* Keep in memory. */ }
  setMonitoring(camera, true);
}
export function setMonitoring(camera: string, active: boolean) {
  monitored = active ? [...monitored.filter(id => id !== camera), camera].slice(-4) : monitored.filter(id => id !== camera);
  try { sessionStorage.setItem('flowsense-monitoring-cameras', JSON.stringify(monitored)); } catch { /* Keep in memory. */ }
  changed.dispatchEvent(new Event('change'));
}

export function acquireCameraViewer(camera: string) {
  const token = crypto.randomUUID();
  const viewers = activeViewers.get(camera) || new Set<string>();
  viewers.add(token);
  activeViewers.set(camera, viewers);
  changed.dispatchEvent(new Event('change'));
  return () => {
    const current = activeViewers.get(camera);
    if (!current?.delete(token)) return;
    if (current.size === 0) activeViewers.delete(camera);
    changed.dispatchEvent(new Event('change'));
  };
}

export const monitoringEvents = changed;
export const monitoringClientId = () => memoryClient;
export const monitoringCameraIds = () => [...new Set([...monitored, ...activeViewers.keys()])];
