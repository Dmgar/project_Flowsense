import { useStore } from '../store/useStore';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
  CartesianGrid,
} from 'recharts';
import { MOCK_BENCHMARK } from '../data/mock';

const CHART_DATA = MOCK_BENCHMARK.map((d) => ({
  name: d.metric,
  'Ruta Estática': d.static,
  'FlowSense': d.flowsense,
}));

export function BenchmarkPanel() {
  const showBenchmark = useStore((s) => s.showBenchmark);
  const toggleBenchmark = useStore((s) => s.toggleBenchmark);

  if (!showBenchmark) return null;

  return (
    <div className="animate-fade-in absolute bottom-24 left-1/2 z-[600] w-[min(620px,calc(100vw-1rem))] -translate-x-1/2 rounded-lg border border-border-primary bg-bg-panel/95 p-4 shadow-2xl backdrop-blur">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-mono text-xs font-bold uppercase tracking-widest text-text-secondary">
          Benchmark — Tiempo de Respuesta
        </h2>
        <button
          onClick={toggleBenchmark}
          className="font-mono text-xs text-text-muted hover:text-text-primary"
        >
          ✕
        </button>
      </div>
      <div className="h-40 md:h-56">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={CHART_DATA} layout="vertical" margin={{ left: 20, right: 20 }}>
            <CartesianGrid stroke="#1e3a5f" strokeDasharray="3 3" />
            <XAxis type="number" stroke="#64748b" tick={{ fontSize: 10, fill: '#94a3b8' }} />
            <YAxis
              type="category"
              dataKey="name"
              width={160}
              stroke="#64748b"
              tick={{ fontSize: 10, fill: '#94a3b8' }}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: '#111827',
                border: '1px solid #1e3a5f',
                borderRadius: 8,
                fontSize: 11,
                fontFamily: 'monospace',
              }}
              labelStyle={{ color: '#e2e8f0' }}
            />
            <Legend wrapperStyle={{ fontSize: 11, fontFamily: 'monospace' }} />
            <Bar dataKey="Ruta Estática" fill="#64748b" radius={[0, 3, 3, 0]} />
            <Bar dataKey="FlowSense" fill="#00e676" radius={[0, 3, 3, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2">
        <div className="rounded bg-bg-tertiary p-2 text-center">
          <div className="font-mono text-lg font-bold tabular-nums text-accent-green">-27%</div>
          <div className="font-mono text-[9px] text-text-muted">TIEMPO PROMEDIO</div>
        </div>
        <div className="rounded bg-bg-tertiary p-2 text-center">
          <div className="font-mono text-lg font-bold tabular-nums text-accent-cyan">67s</div>
          <div className="font-mono text-[9px] text-text-muted">SEGUNDOS SALVADOS</div>
        </div>
        <div className="rounded bg-bg-tertiary p-2 text-center">
          <div className="font-mono text-lg font-bold tabular-nums text-emerald-400">96%</div>
          <div className="font-mono text-[9px] text-text-muted">TASA DE ÉXITO</div>
        </div>
      </div>
    </div>
  );
}