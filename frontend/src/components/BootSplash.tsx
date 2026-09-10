import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store/useStore';

const BOOT_LINES = [
  '> inicializando módulo de percepción… OK',
  '> cargando grafo urbano (OSMNx)…',
  '> conectando telemetría /ws/telemetry…',
  '> calibrando corredores de emergencia…',
];

export function BootSplash() {
  const isBooted = useStore((s) => s.isBooted);
  const [hidden, setHidden] = useState(false);
  const [lines, setLines] = useState(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    let i = 0;
    const t = setInterval(() => {
      i += 1;
      setLines(i);
      if (i >= BOOT_LINES.length) clearInterval(t);
    }, 320);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!isBooted) return;
    const t = setTimeout(() => {
      if (mountedRef.current) setHidden(true);
    }, 420);
    return () => clearTimeout(t);
  }, [isBooted]);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  if (hidden) return null;

  return (
    <div
      className={`fixed inset-0 z-[1100] flex flex-col items-center justify-center gap-8 bg-bg-primary transition-opacity duration-500 ${
        isBooted ? 'pointer-events-none opacity-0' : 'opacity-100'
      }`}
    >
      <div className="relative flex h-20 w-20 items-center justify-center">
        <div className="absolute inset-0 rounded-lg border-2 border-accent-cyan/40 animate-breathe" />
        <div className="absolute inset-2 rounded border border-accent-cyan/30" />
        <span className="animate-boot-flicker font-mono text-3xl font-bold text-accent-cyan">
          FS
        </span>
      </div>
      <div className="font-mono text-xs font-bold tracking-[0.4em] text-text-primary">
        FLOWSENSE
      </div>
      <div className="w-64 space-y-1.5">
        {BOOT_LINES.slice(0, lines).map((l) => (
          <div key={l} className="animate-fade-in font-mono text-[10px] text-text-muted">
            {l}
          </div>
        ))}
        {lines < BOOT_LINES.length && (
          <div className="shimmer-bar h-2 w-full rounded-sm" />
        )}
      </div>
      <div className="font-mono text-[9px] text-text-muted">
        OPENCV AI COMPETITION 2026 — EMERGENCY RESPONSE
      </div>
    </div>
  );
}