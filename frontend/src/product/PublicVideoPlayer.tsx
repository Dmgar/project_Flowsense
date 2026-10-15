import { useEffect, useRef, useState } from 'react';
import type Hls from 'hls.js';
import workerUrl from 'hls.js/dist/hls.worker.js?url';
import { Badge, Icon } from './ui';
import { bufferedLiveTarget, PlaybackHealth } from './playbackHealth';

function liveTarget(instance: Hls | null, video: HTMLVideoElement) {
  return bufferedLiveTarget(instance?.latestLevelDetails?.live === true, instance?.liveSyncPosition,
    Array.from({ length: video.buffered.length }, (_, index) => [video.buffered.start(index), video.buffered.end(index)] as [number, number]));
}

export function PublicVideoPlayer({ url, poster, onUnavailable }: { url: string; poster?: string; onUnavailable: (reason: string) => void }) {
  const ref = useRef<HTMLVideoElement>(null);
  const hls = useRef<Hls | null>(null);
  const [quality, setQuality] = useState('stable');
  const [revision, setRevision] = useState(0);
  const [status, setStatus] = useState('Conectando con el proveedor…');
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    let active = true;
    const health = new PlaybackHealth(performance.now());
    health.setVisible(document.visibilityState === 'visible', performance.now());
    let deferredRecovery: 'network' | 'media' | null = null;
    let lastIssue = '';
    const timers: number[] = [];
    const unavailable = (reason?: string) => { if (active) { active = false; onUnavailable(reason || (lastIssue ? `${lastIssue} Se muestra la imagen periódica; puedes volver a intentar el video.` : 'El video no avanzó después de los intentos de recuperación. Se muestra la imagen periódica; puedes volver a intentar el video.')); } };
    const waitForUser = (error: unknown) => {
      if (!active) return;
      const name = error instanceof Error ? error.name : '';
      if (name === 'AbortError') return; // Reattachment can supersede an earlier play request.
      if (name === 'NotAllowedError') {
        health.setPaused(true, performance.now()); setStatus('Pulsa reproducir para continuar');
      } else unavailable('No se pudo iniciar este video en el navegador. Se muestra la imagen periódica; puedes intentar otra fuente del entorno.');
    };
    const recover = (kind: 'network' | 'media') => {
      if (!active) return;
      const decision = health.requestRecovery(performance.now());
      if (decision.action === 'fallback') { unavailable(); return; }
      if (decision.action !== 'retry') { deferredRecovery = kind; return; }
      deferredRecovery = null;
      setStatus(`Recuperando transmisión · intento ${decision.attempt}/2`);
      if (kind === 'media' && hls.current) hls.current.recoverMediaError();
      else {
        timers.push(window.setTimeout(() => {
          if (!active) return;
          if (hls.current) hls.current.startLoad(-1);
          else video.load();
          void video.play().catch(waitForUser);
        }, decision.attempt * 1000));
      }
    };
    const progress = () => {
      if (video.readyState >= 2 && health.recordProgress(video.currentTime, performance.now()) && active) {
        deferredRecovery = null;
        lastIssue = '';
        setStatus(video.paused ? 'Video en pausa' : 'Video en reproducción');
      }
    };
    const waiting = () => { if (active) setStatus('Cargando señal del proveedor…'); };
    const paused = () => { if (active) { health.setPaused(true, performance.now()); setStatus('Video en pausa'); } };
    const resumed = () => { if (active) { health.setPaused(false, performance.now()); setStatus('Cargando señal del proveedor…'); } };
    const visibility = () => health.setVisible(document.visibilityState === 'visible', performance.now());
    const nativeError = () => { if (!hls.current) recover('network'); };
    video.addEventListener('timeupdate', progress);
    video.addEventListener('waiting', waiting);
    video.addEventListener('pause', paused);
    video.addEventListener('play', resumed);
    document.addEventListener('visibilitychange', visibility);
    video.addEventListener('error', nativeError);
    const watchdog = window.setInterval(() => {
      if (!active || document.visibilityState !== 'visible') return;
      if (deferredRecovery) recover(deferredRecovery);
      if (!active) return;
      const decision = health.poll(performance.now(), video.seeking);
      if (decision === 'fallback') { unavailable(lastIssue ? undefined : 'No se recibió un primer fotograma de video tras 35 segundos de espera activa. Se muestra la imagen periódica; puedes intentar otra cámara del entorno.'); return; }
      if (decision === 'recover') {
        const live = liveTarget(hls.current, video);
        if (live && live > video.currentTime + 3) video.currentTime = live;
        recover('network');
      }
    }, 3000);
    void import('hls.js').then(({ default: HlsPlayer }) => {
      if (!active) return;
      setStatus('Cargando señal del proveedor…');
      if (video.canPlayType('application/vnd.apple.mpegurl') && !HlsPlayer.isSupported()) {
        video.src = url; void video.play().catch(waitForUser); return;
      }
      if (!HlsPlayer.isSupported()) { unavailable(); return; }
      const instance = new HlsPlayer({ enableWorker: true, workerPath: workerUrl, lowLatencyMode: false, maxBufferLength: 20, maxMaxBufferLength: 40, backBufferLength: 10, liveSyncDurationCount: 3, liveMaxLatencyDurationCount: 6, capLevelToPlayerSize: true, startLevel: quality === 'stable' ? 0 : -1 });
      hls.current = instance;
      instance.on(HlsPlayer.Events.MEDIA_ATTACHED, () => {
        if (active) void video.play().catch(waitForUser);
      });
      instance.on(HlsPlayer.Events.MANIFEST_PARSED, () => {
        if (quality === 'stable') instance.autoLevelCapping = 0;
        void video.play().catch(waitForUser);
      });
      instance.on(HlsPlayer.Events.ERROR, (_, data) => {
        if (data.type === HlsPlayer.ErrorTypes.NETWORK_ERROR) lastIssue = 'La solicitud de video al proveedor no se completó.';
        if (data.details === HlsPlayer.ErrorDetails.BUFFER_ADD_CODEC_ERROR || data.details === HlsPlayer.ErrorDetails.FRAG_PARSING_ERROR) lastIssue = 'No se pudo decodificar el video recibido en este navegador.';
        if (!data.fatal) return;
        if (data.response?.code === 403 || data.response?.code === 404) {
          unavailable(`El proveedor devolvió un error ${data.response.code} al solicitar el video. Se muestra la imagen periódica; la disponibilidad depende de Caltrans.`); return;
        }
        if (data.type === HlsPlayer.ErrorTypes.NETWORK_ERROR) recover('network');
        else if (data.type === HlsPlayer.ErrorTypes.MEDIA_ERROR) recover('media');
        else unavailable();
      });
      instance.loadSource(url); instance.attachMedia(video);
    }).catch(() => unavailable());
    return () => {
      active = false; window.clearInterval(watchdog); timers.forEach(timer => window.clearTimeout(timer));
      video.removeEventListener('timeupdate', progress); video.removeEventListener('waiting', waiting);
      video.removeEventListener('pause', paused); video.removeEventListener('play', resumed); video.removeEventListener('error', nativeError);
      document.removeEventListener('visibilitychange', visibility);
      hls.current?.destroy(); hls.current = null;
      video.pause(); video.removeAttribute('src'); video.load();
    };
  }, [url, quality, revision, onUnavailable]);
  return <div className="p-public-video"><video ref={ref} poster={poster} className="p-hls-video" controls muted autoPlay playsInline aria-label="Video público de la cámara" /><div className="p-video-health"><span role="status"><Badge tone={status === 'Video en reproducción' ? 'green' : 'amber'}>{status}</Badge></span><div><label>Calidad<select value={quality} onChange={event => setQuality(event.target.value)}><option value="stable">Priorizar estabilidad</option><option value="auto">Automática</option></select></label><button className="p-text-button" onClick={() => { const video = ref.current; const live = video ? liveTarget(hls.current, video) : null; if (video && live !== null) video.currentTime = live; void video?.play().catch(() => setStatus('Pulsa reproducir para continuar')); }}><Icon name="play" size={14} />Ir al directo</button><button className="p-text-button" onClick={() => { setStatus('Reconectando…'); setRevision(value => value + 1); }}><Icon name="refresh" size={14} />Reconectar</button></div></div></div>;
}
