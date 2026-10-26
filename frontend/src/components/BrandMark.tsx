import './BrandMark.css';

/** The supplied FlowSense artwork, reused without redrawing its geometry. */
export function BrandMark({ size = 32, decorative = false }: { size?: number; decorative?: boolean }) {
  return <span className="fs-brand-mark" style={{ width: size, height: size }} role={decorative ? undefined : 'img'} aria-label={decorative ? undefined : 'FlowSense symbol'} aria-hidden={decorative || undefined}>
    <img className="fs-brand-light" src="/brand/isotipo-petrol.png" alt="" draggable={false} />
    <img className="fs-brand-dark" src="/brand/isotipo-white.png" alt="" draggable={false} />
    <img className="fs-brand-print" src="/brand/isotipo-black.png" alt="" draggable={false} />
  </span>;
}

export function BrandWordmark({ width = 128 }: { width?: number }) {
  return <span className="fs-brand-wordmark" style={{ width }} role="img" aria-label="FlowSense">
    <img className="fs-brand-light" src="/brand/logotipo-petrol.png" alt="" draggable={false} />
    <img className="fs-brand-dark" src="/brand/logotipo-white.png" alt="" draggable={false} />
    <img className="fs-brand-print" src="/brand/logotipo-black.png" alt="" draggable={false} />
  </span>;
}
