import { useEffect, useRef } from 'react';
import { useStore } from '../store/useStore';

export function AlertsFeed() {
  const alerts = useStore((s) => s.alerts);
  const clearAlerts = useStore((s) => s.clearAlerts);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = 0;
    }
  }, [alerts]);

  const severityColor = (severity: string) => {
    switch (severity) {
      case 'critical':
        return 'border-red-500 bg-red-500/10 text-red-400';
      case 'warning':
        return 'border-amber-500 bg-amber-500/10 text-amber-400';
      default:
        return 'border-emerald-500/40 bg-emerald-500/5 text-emerald-300';
    }
  };

  const severityDot = (severity: string) => {
    switch (severity) {
      case 'critical':
        return 'bg-red-500';
      case 'warning':
        return 'bg-amber-400';
      default:
        return 'bg-emerald-400';
    }
  };

  return (
    <section className="pointer-events-none absolute left-4 top-4 z-[500] flex w-72 flex-col">
      <div className="pointer-events-auto flex items-center justify-between px-1 pb-1">
        <h2 className="font-mono text-[10px] font-bold uppercase tracking-widest text-text-muted">
          Alertas en Vivo
        </h2>
        <button
          onClick={clearAlerts}
          className="font-mono text-[10px] text-text-muted hover:text-text-secondary"
        >
          LIMPIAR
        </button>
      </div>
      <div ref={containerRef} className="pointer-events-auto max-h-56 space-y-1.5 overflow-y-auto">
        {alerts.length === 0 && (
          <div className="rounded border border-border-subtle bg-bg-panel/80 px-3 py-2 font-mono text-[11px] text-text-muted backdrop-blur">
            Esperando alertas…
          </div>
        )}
        {alerts.map((a, i) => (
          <div
            key={`${a.timestamp}-${i}`}
            className={`animate-slide-in rounded border px-3 py-2 font-mono text-[11px] backdrop-blur ${severityColor(a.severity)}`}
          >
            <div className="flex items-center gap-2">
              <span className={`h-1.5 w-1.5 rounded-full ${severityDot(a.severity)}`} />
              <span className="line-clamp-2">{a.message}</span>
            </div>
            <div className="mt-1 text-[9px] text-text-muted">
              {new Date(a.timestamp).toLocaleTimeString('es-ES', {
                hour12: false,
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
              })}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}