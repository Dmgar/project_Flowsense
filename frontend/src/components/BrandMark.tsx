import './BrandMark.css';

/** The supplied FlowSense artwork, reused without redrawing its geometry. */
export function BrandMark({ size = 32, decorative = false }: { size?: number; decorative?: boolean }) {
  return <img className="fs-brand-mark" src="/flowsense-logo.svg" width={size} height={size} alt={decorative ? '' : 'FlowSense logo'} aria-hidden={decorative || undefined} draggable={false} />;
}
