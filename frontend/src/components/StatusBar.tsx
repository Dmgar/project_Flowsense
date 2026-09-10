import { useStore } from '../store/useStore';
import { useCountUp } from '../hooks/useCountUp';

function StatusDot({ status }: { status: string }) {
  const color =
    status === 'connected'
      ? 'bg-emerald-400 shadow-[0_0_6px_rgba(0,230,118,.8)]'
      : status === 'reconnecting'
        ? 'bg-amber-400 shadow-[0_0_6px_rgba(255,171,0,.8)]'
        : 'bg-red-500 shadow-[0_0_6px_rgba(255,23,68,.8)]';
  return <span className={`h-2 w-2 rounded-full ${color} animate-pulse`} />;
}

export function StatusBar() {
  const connectionStatus = useStore((s) => s.connectionStatus);
  const graphStatus = useStore((s) => s.graphStatus);
  const isSimulating = useStore((s) => s.isSimulating);
  const secondsSaved = useStore((s) => s.secondsSaved);
  const secondsCount = useCountUp(secondsSaved, 400);

  const statusLabel =
    connectionStatus === 'connected'
      ? 'CONECTADO'
      : connectionStatus === 'reconnecting'
        ? 'RECONECTANDO'
        : 'OFFLINE';

  return (
    <header className="pt-safe flex h-14 items-center justify-between border-b border-border-primary bg-bg-panel px-3 md:px-4">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-accent-cyan/20 font-mono text-lg font-bold text-accent-cyan">
          FS
        </div>
        <div className="min-w-0">
          <h1 className="truncate font-mono text-xs font-bold tracking-widest text-text-primary md:text-sm">
            FLOWSENSE <span className="hidden text-accent-cyan sm:inline">//</span>{' '}
            <span className="hidden text-accent-cyan md:inline">COMMAND CENTER</span>
          </h1>
          <p className="hidden truncate font-mono text-[10px] text-text-muted sm:block">
            {graphStatus?.city ?? 'Cargando ciudad…'} · {graphStatus?.node_count ?? 0} nodos ·{' '}
            {graphStatus?.edge_count ?? 0} segmentos
          </p>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2 md:gap-6">
        <div className="hidden items-center gap-2 md:flex">
          <StatusDot status={connectionStatus} />
          <span className="font-mono text-xs text-text-secondary">{statusLabel}</span>
        </div>
        <div className="hidden items-center gap-2 lg:flex">
          <span
            className={`h-2 w-2 rounded-full ${isSimulating ? 'bg-amber-400 animate-pulse' : 'bg-slate-600'}`}
          />
          <span className="font-mono text-xs text-text-secondary">
            {isSimulating ? 'SIMULACIÓN ACTIVA' : 'MODO PASIVO'}
          </span>
        </div>
        <div className="flex items-center gap-2 rounded border border-accent-green/30 bg-accent-green/10 px-2 py-1 md:px-3">
          <span className="hidden font-mono text-[10px] text-accent-green sm:inline">
            SEGUNDOS SALVADOS
          </span>
          <span
            key={secondsSaved}
            className="inline-block animate-pop font-mono text-sm font-bold tabular-nums text-accent-green md:text-base"
          >
            {secondsCount.toLocaleString('es-ES')}
          </span>
        </div>
      </div>
    </header>
  );
}