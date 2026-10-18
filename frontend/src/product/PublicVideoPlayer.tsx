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
  const [status, setStatus] = useState("Connecting to the provider…");
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    let active = true;
    const health = new PlaybackHealth(performance.now());
    health.setVisible(document.visibilityState === 'visible', performance.now());
    let deferredRecovery: 'network' | 'media' | null = null;
    let lastIssue = '';
    const timers: number[] = [];
    const unavailable = (reason?: string) => { if (active) { active = false; onUnavailable(reason || (lastIssue ? `${lastIssue} Showing the periodic image; you can retry the video.` : "Video did not advance after recovery attempts. Showing the periodic image; you can retry the video.")); } };
    const waitForUser = (error: unknown) => {
      if (!active) return;
      const name = error instanceof Error ? error.name : '';
      if (name === 'AbortError') return; // Reattachment can supersede an earlier play request.
      if (name === 'NotAllowedError') {
        health.setPaused(true, performance.now()); setStatus("Press play to continue");
      } else unavailable("Could not start this video in the browser. Showing the periodic image; you can try another nearby source.");
    };
    const recover = (kind: 'network' | 'media') => {
      if (!active) return;
      const decision = health.requestRecovery(performance.now());
      if (decision.action === 'fallback') { unavailable(); return; }
      if (decision.action !== 'retry') { deferredRecovery = kind; return; }
      deferredRecovery = null;
      setStatus(`Recovering stream · attempt ${decision.attempt}/2`);
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
        setStatus(video.paused ? "Video paused" : "Video playing");
      }
    };
    const waiting = () => { if (active) setStatus("Loading provider stream…"); };
    const paused = () => { if (active) { health.setPaused(true, performance.now()); setStatus("Video paused"); } };
    const resumed = () => { if (active) { health.setPaused(false, performance.now()); setStatus("Loading provider stream…"); } };
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
      if (decision === 'fallback') { unavailable(lastIssue ? undefined : "No first video frame arrived after 35 seconds of active waiting. Showing the periodic image; you can try another nearby camera."); return; }
      if (decision === 'recover') {
        const live = liveTarget(hls.current, video);
        if (live && live > video.currentTime + 3) video.currentTime = live;
        recover('network');
      }
    }, 3000);
    void import('hls.js').then(({ default: HlsPlayer }) => {
      if (!active) return;
      setStatus("Loading provider stream…");
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
        if (data.type === HlsPlayer.ErrorTypes.NETWORK_ERROR) lastIssue = "The video request to the provider did not complete.";
        if (data.details === HlsPlayer.ErrorDetails.BUFFER_ADD_CODEC_ERROR || data.details === HlsPlayer.ErrorDetails.FRAG_PARSING_ERROR) lastIssue = "This browser could not decode the received video.";
        if (!data.fatal) return;
        if (data.response?.code === 403 || data.response?.code === 404) {
          unavailable(`The provider returned an error ${data.response.code} when requesting video. Showing the periodic image; availability depends on Caltrans.`); return;
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
  return <div className="p-public-video"><video ref={ref} poster={poster} className="p-hls-video" controls muted autoPlay playsInline aria-label="Public video from camera" /><div className="p-video-health"><span role="status"><Badge tone={status === "Video playing" ? 'green' : 'amber'}>{status}</Badge></span><div><label>Quality<select value={quality} onChange={event => setQuality(event.target.value)}><option value="stable">Prioritize stability</option><option value="auto">Automatic</option></select></label><button className="p-text-button" onClick={() => { const video = ref.current; const live = video ? liveTarget(hls.current, video) : null; if (video && live !== null) video.currentTime = live; void video?.play().catch(() => setStatus("Press play to continue")); }}><Icon name="play" size={14} />Go live</button><button className="p-text-button" onClick={() => { setStatus("Reconnecting…"); setRevision(value => value + 1); }}><Icon name="refresh" size={14} />Reconnect</button></div></div></div>;
}
