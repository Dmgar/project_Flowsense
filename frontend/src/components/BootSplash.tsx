import { BrandMark } from './BrandMark';
import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store/useStore';

export function BootSplash() {
  const isBooted = useStore((s) => s.isBooted);
  const [hidden, setHidden] = useState(false);
  const mountedRef = useRef(true);

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
      className={`fixed inset-0 z-[1100] flex flex-col items-center justify-center gap-4 fs-brand-loading transition-opacity duration-500 ${
        isBooted ? 'pointer-events-none opacity-0' : 'opacity-100'
      }`}
    >
      <BrandMark size={64} />
      <div className="font-sans text-lg font-bold tracking-tight text-inherit">FlowSense</div>
      <div className="h-1 w-28 overflow-hidden rounded-full bg-[#dce5df]"><div className="h-full w-2/3 animate-pulse rounded-full bg-[#46956d]" /></div>
      <div className="font-sans text-xs fs-brand-muted">Preparing the map and road network…</div>
    </div>
  );
}
