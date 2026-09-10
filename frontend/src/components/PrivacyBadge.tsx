import { useStore } from '../store/useStore';

export function PrivacyBadge() {
  const showPrivacyBadge = useStore((s) => s.showPrivacyBadge);
  const togglePrivacyBadge = useStore((s) => s.togglePrivacyBadge);

  if (!showPrivacyBadge) return null;

  return (
    <div className="pointer-events-auto absolute top-10 right-4 z-[500] hidden items-center gap-2 rounded border border-border-subtle bg-bg-panel/80 px-2.5 py-1.5 font-mono text-[9px] text-text-muted backdrop-blur md:flex">
      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
      <span>Responsible AI: No ALPR · No facial recognition · Solo conteos agregados</span>
      <button onClick={togglePrivacyBadge} className="text-text-muted hover:text-text-primary">
        ✕
      </button>
    </div>
  );
}