// Development entry only. Vite's production entry remains index.html.
import { createRoot } from 'react-dom/client';
import { useCallback, useEffect, useState } from 'react';
import { PublicVideoPlayer } from './product/PublicVideoPlayer';

export function PlaybackQA() {
  const [reason, setReason] = useState('');
  const [revision, setRevision] = useState(0);
  const [source, setSource] = useState('Disponible');
  const [visibility, setVisibility] = useState<string[]>([document.visibilityState]);
  useEffect(() => {
    const changed = () => setVisibility(previous => [...previous.slice(-19), document.visibilityState]);
    document.addEventListener('visibilitychange', changed);
    return () => document.removeEventListener('visibilitychange', changed);
  }, []);
  const unavailable = useCallback((message: string) => setReason(message), []);
  const changeSource = async (cut: boolean) => {
    try {
      const response = await fetch(`http://127.0.0.1:8003/${cut ? 'cut' : 'resume'}`, { method: 'POST' });
      if (!response.ok) throw new Error('No se pudo controlar la fuente de prueba');
      setSource(cut ? 'Interrumpida' : 'Disponible');
    } catch (error) { setSource(error instanceof Error ? error.message : 'Error de conexión'); }
  };
  return <main style={{ maxWidth: 850, margin: '30px auto', padding: 20, fontFamily: 'system-ui', color: '#284331' }}>
    <h1>Verificación del reproductor</h1><p>Patrón sintético local. No es una cámara pública ni una prueba de disponibilidad de Caltrans.</p>
    <p role="status">Fuente de prueba: {source}</p><div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
      <button onClick={() => void changeSource(true)}>Interrumpir fuente</button>
      <button onClick={() => void changeSource(false)}>Restaurar fuente</button>
      <button onClick={() => { setReason(''); setRevision(value => value + 1); }}>Iniciar nueva sesión</button>
    </div>
    <p>Visibilidad registrada: <output data-testid="visibility-history">{visibility.join(' → ')}</output></p>
    {reason ? <p role="alert">Retorno a imagen: {reason}</p> : <PublicVideoPlayer key={revision} url="http://127.0.0.1:8003/playlist.m3u8" onUnavailable={unavailable} />}
    <style>{'video{width:100%;max-height:480px;background:#15231b}button,select{padding:9px}.p-video-health{display:flex;justify-content:space-between;padding:12px;background:#edf2e7}.p-video-health>div{display:flex;gap:12px}'}</style>
  </main>;
}

createRoot(document.getElementById('root')!).render(<PlaybackQA />);
