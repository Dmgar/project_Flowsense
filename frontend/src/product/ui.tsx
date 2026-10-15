import { lazy, Suspense } from 'react';
import type { ComponentProps, ReactNode } from 'react';
import { severityLabels, statusLabels } from './data';
import type { Severity } from './types';

const paths: Record<string, string> = {
  star: 'M12 3l2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9z',
  grid: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  map: 'M3 5l6-2 6 2 6-2v16l-6 2-6-2-6 2z M9 3v16 M15 5v16',
  camera: 'M3 7h13v12H3z M16 10l5-3v12l-5-3 M6 7l2-3h5l2 3',
  chart: 'M4 20V10 M10 20V4 M16 20v-8 M22 20H2',
  pin: 'M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1116 0z M12 7a3 3 0 100 6 3 3 0 000-6z',
  walk: 'M13 3a2 2 0 100 4 2 2 0 000-4z M10 8l4 1 3 5 3 1 M14 9l-2 6 4 6 M12 15l-5 6 M10 8l-3 5-4 1',
  alert: 'M12 3L2 21h20z M12 9v5 M12 17h.01',
  route: 'M5 4a3 3 0 100 6 3 3 0 000-6z M19 14a3 3 0 100 6 3 3 0 000-6z M5 10v6h8V7h6v7',
  report: 'M5 2h10l4 4v16H5z M14 2v5h5 M8 11h8 M8 15h8 M8 19h5',
  settings: 'M12 8a4 4 0 100 8 4 4 0 000-8z M12 2v3 M12 19v3 M2 12h3 M19 12h3 M5 5l2 2 M17 17l2 2 M5 19l2-2 M17 7l2-2',
  search: 'M10 3a7 7 0 100 14 7 7 0 000-14z M15 15l6 6',
  arrow: 'M4 12h16 M14 6l6 6-6 6', close: 'M6 6l12 12 M6 18L18 6',
  check: 'M4 12l5 5L20 6', plus: 'M12 4v16 M4 12h16', download: 'M12 3v12 M7 10l5 5 5-5 M4 17v4h16v-4',
  play: 'M6 3l15 9-15 9z', pause: 'M7 4v16 M17 4v16', refresh: 'M20 8V3l-4 4 M20 8a8 8 0 10.2 8',
  expand: 'M3 9V3h6 M15 3h6v6 M21 15v6h-6 M9 21H3v-6',
  shield: 'M12 2l9 4v6c0 6-9 10-9 10S3 18 3 12V6z M8 12l3 3 5-6',
  car: 'M3 12l3-7h12l3 7v7H3z M3 12h18 M6 19v2 M18 19v2 M6 15h2 M16 15h2',
  clock: 'M12 2a10 10 0 100 20 10 10 0 000-20z M12 6v6l4 2',
  leaf: 'M20 3C7 1 1 9 7 16c6 6 14-1 13-13z M5 21L17 7',
  bell: 'M18 8a6 6 0 00-12 0v7l-2 3h16l-2-3z M10 21h4',
  info: 'M12 2a10 10 0 100 20 10 10 0 000-20z M12 10v7 M12 6h.01',
};
export function Icon({ name, size = 18 }: { name: string; size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name] || paths.grid} /></svg>; }
export function Badge({ children, tone = 'green' }: { children: ReactNode; tone?: string }) { return <span className={`p-badge ${tone}`}><i />{children}</span>; }
export function SeverityBadge({ value }: { value: Severity }) { return <Badge tone={value === 'high' ? 'red' : value === 'medium' ? 'amber' : 'green'}>{severityLabels[value]}</Badge>; }
export function ReviewBadge({ value }: { value: string }) { return <Badge tone={value === 'confirmed' || value === 'resolved' ? 'green' : value === 'dismissed' ? 'gray' : 'amber'}>{statusLabels[value] || value}</Badge>; }
export function ConfidenceMeter({ value }: { value: number | null }) { return <div className="p-confidence"><b>{value === null ? '—' : Math.round(value * 100) + '%'}</b><span><i style={{ width: `${(value ?? 0) * 100}%` }} /></span></div>; }
export function Sparkline({ tone = 'green', values = [6, 9, 7, 12, 11, 16, 13, 18, 17, 21] }: { tone?: string; values?: number[] }) { const max = Math.max(...values); return <svg className={`p-spark ${tone}`} viewBox="0 0 100 32" aria-hidden="true"><path d={`M0 32 ${values.map((v, i) => `L${i * 100 / (values.length - 1)} ${30 - v / max * 27}`).join(' ')} L100 32Z`} fill="currentColor" opacity=".08" /><polyline points={values.map((v, i) => `${i * 100 / (values.length - 1)},${30 - v / max * 27}`).join(' ')} fill="none" stroke="currentColor" strokeWidth="2" /></svg>; }
export function MetricCard({ label, value, unit, delta, tone = 'green', icon = 'chart', note }: { label: string; value: ReactNode; unit?: string; delta?: string; tone?: string; icon?: string; note?: string }) { return <article className={`p-metric ${tone}`}><div className="p-metric-label"><Icon name={icon} size={16} />{label}</div><div className="p-metric-value">{value}<small>{unit}</small></div><div className="p-metric-bottom"><span>{delta || note || 'Sin serie histórica'}</span>{delta && <Sparkline tone={tone} />}</div></article>; }
export function Panel({ title, children, action, className = '' }: { title: string; children: ReactNode; action?: ReactNode; className?: string }) { return <section className={`p-panel ${className}`}><header className="p-panel-head"><h3>{title}</h3>{action}</header>{children}</section>; }
export function EmptyState({ title = 'Sin observaciones suficientes', detail = 'Conecta una fuente o usa el escenario de presentación para explorar el flujo.', action }: { title?: string; detail?: string; action?: ReactNode }) { return <div className="p-empty"><Icon name="chart" size={30} /><h3>{title}</h3><p>{detail}</p>{action}</div>; }
const LazyTrendChart = lazy(() => import('./Charts'));
export function TrendChart(props: ComponentProps<typeof LazyTrendChart>) { return <Suspense fallback={<div className="p-chart-loading">Cargando gráfico…</div>}><LazyTrendChart {...props} /></Suspense>; }
