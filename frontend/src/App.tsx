import { useEffect } from 'react';
import { MapView } from './components/MapView';
import { StatusBar } from './components/StatusBar';
import { Sidebar } from './components/Sidebar';
import { LayerControls } from './components/LayerControls';
import { CongestionLegend } from './components/CongestionLegend';
import { AlertsFeed } from './components/AlertsFeed';
import { BenchmarkPanel } from './components/BenchmarkPanel';
import { PresentationOverlay } from './components/PresentationOverlay';
import { PrivacyBadge } from './components/PrivacyBadge';
import { TimelineScrubber } from './components/TimelineScrubber';
import { ReplayController } from './components/ReplayController';
import { DataInitializer } from './components/DataInitializer';
import { BootSplash } from './components/BootSplash';
import { BottomDock } from './components/BottomDock';
import { MobileSheets } from './components/MobileSheets';
import { useTelemetrySocket } from './hooks/useTelemetrySocket';
import { useStore } from './store/useStore';

export default function App() {
  useTelemetrySocket();
  const isPresentationMode = useStore((s) => s.isPresentationMode);
  const togglePresentationMode = useStore((s) => s.togglePresentationMode);
  const setMobilePanel = useStore((s) => s.setMobilePanel);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isPresentationMode) {
          togglePresentationMode();
        } else if (useStore.getState().mobilePanel !== 'none') {
          setMobilePanel('none');
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isPresentationMode, togglePresentationMode, setMobilePanel]);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-bg-primary supports-[height:100dvh]:h-dvh supports-[width:100dvw]:w-dvw">
      <BootSplash />
      <DataInitializer />
      <ReplayController />
      {!isPresentationMode && <StatusBar />}
      <div className="relative flex min-h-0 flex-1">
        <main className="relative min-w-0 flex-1">
          <MapView />
          {!isPresentationMode && <AlertsFeed />}
          <CongestionLegend />
          {!isPresentationMode && <LayerControls />}
          {!isPresentationMode && <TimelineScrubber />}
          {!isPresentationMode && <BenchmarkPanel />}
          {!isPresentationMode && <PrivacyBadge />}
          <PresentationOverlay />
        </main>
        {!isPresentationMode && <Sidebar />}
        {!isPresentationMode && <MobileSheets />}
      </div>
      {!isPresentationMode && <BottomDock />}
    </div>
  );
}