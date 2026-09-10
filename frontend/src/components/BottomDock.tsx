import { useStore, type MobilePanel } from '../store/useStore';

const DOCK_ITEMS: { panel: MobilePanel; icon: string; label: string; action?: 'benchmark' | 'replay' | 'present' }[] = [
  { panel: 'dispatch', icon: '🚨', label: 'Despacho' },
  { panel: 'layers', icon: '🗺️', label: 'Capas' },
  { panel: 'none', icon: '▶', label: 'Replay', action: 'replay' },
  { panel: 'none', icon: '▦', label: 'Bench', action: 'benchmark' },
  { panel: 'follow', icon: '◎', label: 'Seguir' },
];

export function BottomDock() {
  const mobilePanel = useStore((s) => s.mobilePanel);
  const setMobilePanel = useStore((s) => s.setMobilePanel);
  const isReplaying = useStore((s) => s.isReplaying);
  const setIsReplaying = useStore((s) => s.setIsReplaying);
  const replayFrames = useStore((s) => s.replayFrames);
  const setCurrentReplayIndex = useStore((s) => s.setCurrentReplayIndex);
  const toggleBenchmark = useStore((s) => s.toggleBenchmark);
  const togglePresentationMode = useStore((s) => s.togglePresentationMode);

  const handle = (item: (typeof DOCK_ITEMS)[number]) => {
    switch (item.action) {
      case 'replay': {
        if (isReplaying) {
          setIsReplaying(false);
        } else {
          if (replayFrames.length === 0) {
            useStore.getState().setConnectionStatus('offline');
          }
          setCurrentReplayIndex(0);
          setIsReplaying(true);
        }
        return;
      }
      case 'benchmark': {
        toggleBenchmark();
        return;
      }
      case 'present': {
        togglePresentationMode();
        return;
      }
      default: {
        setMobilePanel(item.panel === mobilePanel ? 'none' : item.panel);
      }
    }
  };

  return (
    <nav className="pb-safe fixed inset-x-0 bottom-0 z-[600] border-t border-border-primary bg-bg-panel/95 backdrop-blur md:hidden">
      <div className="mx-auto flex max-w-md items-stretch justify-around px-2 pt-1">
        {DOCK_ITEMS.map((item) => {
          const active = item.panel !== 'none' && mobilePanel === item.panel;
          const isReplayOn = item.action === 'replay' && isReplaying;
          return (
            <button
              key={item.label}
              onClick={() => handle(item)}
              className={`flex flex-1 flex-col items-center gap-0.5 py-2 ${active || isReplayOn ? 'text-accent-cyan' : 'text-text-muted'}`}
            >
              <span className="text-lg leading-none">{item.icon}</span>
              <span className="font-mono text-[9px] tracking-wider">{item.label.toUpperCase()}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}