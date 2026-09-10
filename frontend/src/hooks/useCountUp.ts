import { useEffect, useRef, useState } from 'react';

export function useCountUp(value: number, duration = 500): number {
  const [display, setDisplay] = useState(value);
  const animId = useRef(0);
  const fromRef = useRef(value);

  useEffect(() => {
    const to = value;
    const from = fromRef.current;
    if (from === to) return;

    cancelAnimationFrame(animId.current);
    const start = performance.now();

    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(Math.round(from + (to - from) * eased));
      if (t < 1) {
        animId.current = requestAnimationFrame(step);
      } else {
        fromRef.current = to;
      }
    };

    animId.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(animId.current);
  }, [value, duration]);

  return display;
}