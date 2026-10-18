// Empty bases use the same-origin Vite proxy for HTTP and WebSocket traffic.
const apiBase = (import.meta.env?.VITE_API_URL || '').trim().replace(/\/+$/, '');

export function apiUrl(path: string, base = apiBase): string {
  if (/^https?:\/\//i.test(path) || !path) return path;
  return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

export function telemetryUrl(origin: string, base = apiBase): string {
  const url = new URL(apiUrl('/ws/telemetry', base), origin);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.href;
}
