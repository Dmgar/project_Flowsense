import { useStore } from '../store/useStore';

export function StatusBar() {
  const city = useStore((state) => state.graphStatus?.city ?? 'Cartagena de Indias, Colombia');
  const connectionStatus = useStore((s) => s.connectionStatus);
  const statusLabel = connectionStatus === 'connected' ? "Traffic connected" : connectionStatus === 'reconnecting' ? "Reconnecting" : "Demo view";

  return (
    <header className="app-header">
      <a href="#mapa" className="header-brand" aria-label="FlowSense home">
        <span className="brand-mark">F</span><span>FlowSense</span>
      </a>
      <div className="header-city"><span className="city-pin">⌖</span> {city}</div>
      <div className="header-status"><i className={connectionStatus === 'connected' ? 'connected' : ''} />{statusLabel}</div>
    </header>
  );
}
