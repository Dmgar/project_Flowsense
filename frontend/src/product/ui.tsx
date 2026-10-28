import { Component, createRef, lazy, Suspense } from 'react';
import type { ComponentProps, ErrorInfo, ReactNode } from 'react';
import { severityLabels, statusLabels } from './data';
import type { Severity } from './types';
import './uiFeedback.css';
import './metricReadability.css';

const paths: Record<string, string> = {
  moon: 'M20.8 13A9 9 0 0111 3.2 9 9 0 1020.8 13z',
  sun: 'M12 8a4 4 0 100 8 4 4 0 000-8z M12 2v3 M12 19v3 M2 12h3 M19 12h3 M5 5l2 2 M17 17l2 2 M5 19l2-2 M17 7l2-2',
  layers: 'M3 6h18 M3 12h18 M3 18h18 M7 3v6 M17 9v6 M10 15v6',
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
  settings: 'M19.14 12.94c.04-.3.06-.61.06-.94s-.02-.64-.07-.94l2.03-1.58a.5.5 0 00.12-.64l-1.92-3.32a.5.5 0 00-.61-.22l-2.39.96a7.3 7.3 0 00-1.63-.94L14.37 2.8a.49.49 0 00-.49-.42h-3.84a.49.49 0 00-.49.42l-.36 2.52c-.59.23-1.13.55-1.63.94l-2.39-.96a.5.5 0 00-.61.22L2.64 8.84a.5.5 0 00.12.64l2.03 1.58c-.05.3-.07.62-.07.94s.02.64.07.94l-2.03 1.58a.5.5 0 00-.12.64l1.92 3.32c.12.21.37.3.61.22l2.39-.96c.5.39 1.04.71 1.63.94l.36 2.52c.04.24.24.42.49.42h3.84c.25 0 .45-.18.49-.42l.36-2.52c.59-.23 1.13-.55 1.63-.94l2.39.96c.24.09.49-.01.61-.22l1.92-3.32a.5.5 0 00-.12-.64l-2.03-1.58z M12 15.5a3.5 3.5 0 110-7 3.5 3.5 0 010 7z',
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
export function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const path = paths[name];
  if (!path) {
    if (import.meta.env.DEV) console.error(`Unknown FlowSense icon: "${name}"`);
    return null;
  }

  return <svg className="p-icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d={path} /></svg>;
}
export function Badge({ children, tone = 'green' }: { children: ReactNode; tone?: string }) { return <span className={`p-badge ${tone}`}><i />{children}</span>; }
export function SeverityBadge({ value }: { value: Severity }) { return <Badge tone={value === 'high' ? 'red' : value === 'medium' ? 'amber' : 'green'}>{severityLabels[value]}</Badge>; }
export function ReviewBadge({ value }: { value: string }) { return <Badge tone={value === 'confirmed' || value === 'resolved' ? 'green' : value === 'dismissed' ? 'gray' : 'amber'}>{statusLabels[value] || value}</Badge>; }
export function ConfidenceMeter({ value }: { value: number | null }) {
  const available = value !== null && Number.isFinite(value);
  const score = available ? Math.round(Math.min(1, Math.max(0, value)) * 100) : null;
  return <div className={`p-confidence${score === null ? ' is-unavailable' : ''}`} role="img" aria-label={score === null ? 'Evidence score unavailable' : `Evidence score ${score} out of 100; not a calibrated probability`}><b aria-hidden="true">{score === null ? 'No score' : <>{score}<small> / 100</small></>}</b><span aria-hidden="true"><i style={{ width: `${score ?? 0}%` }} /></span></div>;
}
export function Sparkline({ tone = 'green', values = [6, 9, 7, 12, 11, 16, 13, 18, 17, 21] }: { tone?: string; values?: number[] }) { const max = Math.max(...values); return <svg className={`p-spark ${tone}`} viewBox="0 0 100 32" aria-hidden="true"><path d={`M0 32 ${values.map((v, i) => `L${i * 100 / (values.length - 1)} ${30 - v / max * 27}`).join(' ')} L100 32Z`} fill="currentColor" opacity=".08" /><polyline points={values.map((v, i) => `${i * 100 / (values.length - 1)},${30 - v / max * 27}`).join(' ')} fill="none" stroke="currentColor" strokeWidth="2" /></svg>; }
export function MetricCard({ label, value, unit, delta, tone = 'green', icon = 'chart', note }: { label: string; value: ReactNode; unit?: string; delta?: string; tone?: string; icon?: string; note?: string }) {
  const unavailable = value === '—' || value === null || value === undefined;
  return <article className={`p-metric ${tone}${unavailable ? ' is-unavailable' : ''}`}>
    <div className="p-metric-label"><Icon name={icon} size={16} />{label}</div>
    <div className="p-metric-value">{unavailable ? <><span aria-hidden="true">—</span><span className="p-sr-only">Unavailable</span></> : value}<small aria-hidden={unavailable || undefined}>{unit}</small></div>
    <div className="p-metric-bottom"><span>{delta || note || 'No historical series'}</span></div>
  </article>;
}
export function Panel({ title, children, action, className = '' }: { title: string; children: ReactNode; action?: ReactNode; className?: string }) { return <section className={`p-panel ${className}`}><header className="p-panel-head"><h3>{title}</h3>{action}</header>{children}</section>; }
export function EmptyState({ title = "Insufficient observations", detail = "Connect a source or use the presentation scenario to explore the workflow.", action, icon = 'chart', headingAs: Heading = 'h3' }: { title?: string; detail?: string; action?: ReactNode; icon?: string; headingAs?: 'h1' | 'h2' | 'h3' }) { return <div className="p-empty"><span className="p-empty-illustration" aria-hidden="true"><span><Icon name={icon} size={25} /></span><i /></span><div className="p-empty-copy"><Heading>{title}</Heading><p>{detail}</p></div>{action && <div className="p-empty-action">{action}</div>}</div>; }
const LazyTrendChart = lazy(() => import('./Charts'));

class ChartErrorBoundary extends Component<{ children: ReactNode; height: number }, { failed: boolean }> {
  state = { failed: false };
  private frame = createRef<HTMLDivElement>();

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[FlowSense] Chart render error:', error, info);
  }

  render() {
    return <div ref={this.frame} className="p-chart-frame" tabIndex={-1} role="group" aria-label="Chart view">{this.state.failed
      ? <div className="p-chart-error p-chart-recovery" style={{ minHeight: this.props.height }}><Icon name="chart" size={24} /><div role="status"><strong>This chart could not be displayed</strong><p>Retry this view, or continue using the other workspace tools. A display error does not mean that the measured value is zero.</p></div><button type="button" className="p-button" onClick={() => this.setState({ failed: false }, () => this.frame.current?.focus({ preventScroll: true }))}><Icon name="refresh" size={15} />Retry chart</button></div>
      : this.props.children}</div>;
  }
}

export function TrendChart(props: ComponentProps<typeof LazyTrendChart>) {
  const height = props.height ?? 170;
  return <ChartErrorBoundary height={height}><Suspense fallback={<div className="p-chart-loading" role="status" aria-label="Loading chart" style={{ height }}><span className="p-chart-loading-mark" aria-hidden="true" /><span>Loading chart…</span></div>}><LazyTrendChart {...props} /></Suspense></ChartErrorBoundary>;
}
