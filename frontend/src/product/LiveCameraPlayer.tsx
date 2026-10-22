import { useEffect, useRef, useState } from 'react';
import { apiUrl } from '../api/urls';
import { Badge, Icon } from './ui';
import { RoadZoneEditor } from './RoadZoneEditor';
import { automaticReconnectMessage, reconnectDelayMs, shouldRecoverDisconnectedWebRtcConnection, shouldWatchCameraFrames, WEBRTC_DISCONNECT_GRACE_MS } from './reconnectPolicy';
import { CameraFrameHealth } from './cameraFrameHealth';
import { cameraMediaErrorMessage, shouldRetryCameraMediaError, shouldRetryCameraRequestStatus } from './cameraMediaError';
import { detectionPipelineStatus, formatOutsideZoneSummary, visibleClassBreakdown, visibleDetectionCount } from './detectionDiagnostics';
import { acquireCameraViewer } from './monitoring';
import { LiveTrackTrailBuffer } from './liveTrackTrails';
import './liveVideo.css';

export interface VideoReading {
  session_id: string; camera_id: string; state: string; error: string; inference_error: string;
  counts: Record<string, number> | null; sample_age_seconds: number | null;
  metrics: { sequence: number; media_time_seconds: number; generation: number; width: number; height: number; inference_age_seconds: number | null; track_ids: number[]; model_detections?: number | null;
    detections?: { id: number; class: string; bbox: [number, number, number, number]; class_status?: string; candidate_class?: string | null; trail?: [number, number][] }[];
    observed_detections?: { id: number; class: string; bbox: [number, number, number, number]; trail?: [number, number][] }[];
    motion_tracks?: { id: number; class: string; bbox: [number, number, number, number]; trail: [number, number][] }[];
    analysis_pipeline?: { raw_candidates: number; road_candidates: number; duplicate_candidates?: number; inbound_tracks: number; aligned_tracks?: number; confirmed_tracks?: number; displayed_tracks: number; confirmed_displayed_tracks?: number; provisional_displayed_tracks?: number;
      window_seconds?: number; window_frames?: number; raw_candidate_frames?: number; road_candidate_frames?: number; road_candidate_observations?: number;
      outside_zone_candidates?: number; outside_zone_observations?: number; outside_zone_classes?: Record<string, number>;
      outside_zone_boxes?: { bbox: [number, number, number, number]; class: string; confidence: number }[];
      directional_outside_tracks?: { bbox: [number, number, number, number]; class: string; candidate_class?: string | null;
        confidence: number; observation_hits: number; trail: [number, number][] }[]; inbound_tracks_peak?: number } } | null;
  output_fps: number; inference_fps: number; recorded: boolean;
  rendered_fps?: number | null;
  settings: { confidence: number; classes: string[]; show_candidates: boolean };
  model?: string; execution_provider?: string; storage_error?: string; detection_profile?: string;
  analysis_zone?: { enabled: boolean; name: string; revision: number }; tracker?: string;
}
const base = '/api/v1/mobility/video';
class VideoRequestError extends Error {
  readonly status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  let timedOut = false;
  if (init?.signal?.aborted) abort();
  else init?.signal?.addEventListener('abort', abort, { once: true });
  const deadline = window.setTimeout(() => { timedOut = true; controller.abort(); }, 15000);
  try {
    const response = await fetch(apiUrl(`${base}${path}`), { ...init, signal: controller.signal, headers: { 'Content-Type': 'application/json', ...init?.headers } });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new VideoRequestError(typeof body.detail === 'string' ? body.detail : 'Video service unavailable.', response.status);
    }
    return await response.json();
  } catch (reason) {
    if (timedOut) throw new Error('Video service took too long to respond. Reconnect to try again.');
    throw reason;
  } finally {
    clearTimeout(deadline); init?.signal?.removeEventListener('abort', abort);
  }
}

export function LiveCameraPlayer({ cameraId, name, supported = true, onReading, compact = false, startZoneEditing = false, onZoneSaved, routeReference }: {
  cameraId: string; name: string; supported?: boolean; onReading?: (reading: VideoReading | null) => void; compact?: boolean; startZoneEditing?: boolean; onZoneSaved?: () => void; routeReference?: string;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const motionTrailBuffer = useRef(new LiveTrackTrailBuffer());
  const [videoStage, setVideoStage] = useState<HTMLDivElement | null>(null);
  const callback = useRef(onReading);
  useEffect(() => { callback.current = onReading; }, [onReading]);
  const retries = useRef(0);
  const lastFailure = useRef('');
  const hasEverDecodedFrame = useRef(false);
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState('Connecting');
  const [error, setError] = useState('');
  const [reading, setReading] = useState<VideoReading | null>(null);
  const [viewer, setViewer] = useState('');
  const [paused, setPaused] = useState(false);
  const intentionallyPaused = useRef(false);
  const autoplayBlocked = useRef(false);
  const [editingZone, setEditingZone] = useState<boolean | null>(null);
  const zoneEditorOpen = editingZone ?? (startZoneEditing && state === 'Live');
  const [visible, setVisible] = useState(document.visibilityState === 'visible');
  const frameHealthRef = useRef<CameraFrameHealth | null>(null);
  useEffect(() => supported && visible ? acquireCameraViewer(cameraId) : undefined, [cameraId, supported, visible]);
  useEffect(() => {
    const changed = () => setVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', changed);
    return () => document.removeEventListener('visibilitychange', changed);
  }, []);
  useEffect(() => {
    retries.current = 0;
    lastFailure.current = '';
    hasEverDecodedFrame.current = false;
    motionTrailBuffer.current.reset();
  }, [cameraId]);

  useEffect(() => {
    const video = ref.current;
    if (!video || !supported || !visible) return;
    let active = true, failedOnce = false, polling = false;
    let viewerId = '';
    let lastTime = -1, lastAdvance = performance.now();
    let presentedAt = 0, presentedBase = 0, renderedFps: number | null = null;
    let hasDecodedFrame = false;
    let receivedTrack: MediaStreamTrack | undefined;
    let trackEndedHandler: (() => void) | undefined;
    let trackMutedHandler: (() => void) | undefined;
    let trackUnmutedHandler: (() => void) | undefined;
    let trackSilenceTimer: number | undefined;
    const frameHealth = new CameraFrameHealth(performance.now());
    frameHealthRef.current = frameHealth;
    let lastPresentedFrames = -1;
    let frameCallback: number | undefined;
    let retryTimer: number | undefined, disconnectedTimer: number | undefined;
    let peer: RTCPeerConnection | undefined;
    const controller = new AbortController();
    const presented: VideoFrameRequestCallback = (now, metadata) => {
      if (!active) return;
      if (metadata.presentedFrames > lastPresentedFrames) {
        lastPresentedFrames = metadata.presentedFrames;
        hasDecodedFrame = true;
        hasEverDecodedFrame.current = true;
        autoplayBlocked.current = false;
        frameHealth.recordFrame(now);
      }
      if (!presentedAt) { presentedAt = now; presentedBase = metadata.presentedFrames; }
      if (now - presentedAt >= 1000) {
        renderedFps = Math.round((metadata.presentedFrames - presentedBase) * 10000 / (now - presentedAt)) / 10;
        presentedAt = now; presentedBase = metadata.presentedFrames;
      }
      frameCallback = video.requestVideoFrameCallback(presented);
    };
    frameHealth.setWatching(performance.now(), shouldWatchCameraFrames(visible, intentionallyPaused.current,
      Boolean(receivedTrack), autoplayBlocked.current));
    if (video.requestVideoFrameCallback) frameCallback = video.requestVideoFrameCallback(presented);
    const closeViewer = (id: string) => { void fetch(apiUrl(`${base}/viewers/${id}`), { method: 'DELETE', keepalive: true }).catch(() => {}); };
    const clearCounts = () => { motionTrailBuffer.current.reset(); setReading(null); callback.current?.(null); };
    const failed = (message: string, retry = true) => {
      if (!active || failedOnce) return;
      window.clearTimeout(disconnectedTimer);
      disconnectedTimer = undefined;
      failedOnce = true;
      lastFailure.current = message;
      setState('Video unavailable'); setError(message); clearCounts();
      video.pause(); video.srcObject = null;
      peer?.close();
      if (viewerId) closeViewer(viewerId);
      if (retry) {
        retries.current = Math.min(retries.current + 1, 4);
        setState('Reconnecting');
        retryTimer = window.setTimeout(() => setRevision(value => value + 1), reconnectDelayMs(retries.current));
      }
    };
    const onMediaError = () => {
      if (!active || failedOnce || !video.error) return;
      failed(cameraMediaErrorMessage(video.error.code), shouldRetryCameraMediaError(
        video.error.code, retries.current, hasEverDecodedFrame.current));
    };
    video.addEventListener('error', onMediaError);
    const connect = async () => {
      try {
        const retrying = retries.current > 0;
        setState(retrying ? 'Reconnecting' : 'Connecting');
        setError(retrying ? automaticReconnectMessage(lastFailure.current) : '');
        setViewer(''); setPaused(false); clearCounts();
        if (typeof RTCPeerConnection === 'undefined') throw new Error('This browser does not support WebRTC video.');
        peer = new RTCPeerConnection({ iceServers: [] });
        peer.addTransceiver('video', { direction: 'recvonly' });
        peer.ontrack = event => {
          if (!active) return;
          receivedTrack = event.track;
          autoplayBlocked.current = false;
          frameHealth.recordTrack(performance.now());
          const track = event.track;
          trackEndedHandler = () => failed('The camera ended its video track.');
          trackMutedHandler = () => {
            window.clearTimeout(trackSilenceTimer);
            // Some sources mute briefly during startup. Recover only after video
            // has played and the same track remains silent for several seconds.
            if (hasDecodedFrame) trackSilenceTimer = window.setTimeout(() => {
              if (active && track.muted) failed('The camera stopped sending video frames.');
            }, 4500);
          };
          trackUnmutedHandler = () => window.clearTimeout(trackSilenceTimer);
          track.addEventListener('ended', trackEndedHandler, { once: true });
          track.addEventListener('mute', trackMutedHandler);
          track.addEventListener('unmute', trackUnmutedHandler);
          video.srcObject = new MediaStream([track]);
          void video.play().then(() => { autoplayBlocked.current = false; }).catch(() => {
            if (active) { autoplayBlocked.current = true; setState('Press play to continue'); setPaused(true); }
          });
        };
        peer.onconnectionstatechange = () => {
          if (!active) return;
          if (peer?.connectionState === 'failed') failed('Video connection failed.');
          if (peer?.connectionState === 'disconnected') {
            setState('Reconnecting'); clearCounts();
            window.clearTimeout(disconnectedTimer);
            const disconnectedAt = performance.now();
            disconnectedTimer = window.setTimeout(() => {
              if (shouldRecoverDisconnectedWebRtcConnection(peer?.connectionState, disconnectedAt, performance.now())
                || peer?.connectionState === 'failed')
                failed('Video connection dropped.');
            }, WEBRTC_DISCONNECT_GRACE_MS);
          }
          if (peer?.connectionState === 'connected') {
            window.clearTimeout(disconnectedTimer);
            disconnectedTimer = undefined;
          }
        };
        await peer.setLocalDescription(await peer.createOffer());
        if (peer.iceGatheringState !== 'complete') await new Promise<void>((resolve, reject) => {
          const timer = window.setTimeout(() => { cleanup(); reject(new Error('Video negotiation timed out.')); }, 8000);
          const changed = () => { if (peer?.iceGatheringState === 'complete') { cleanup(); resolve(); } };
          const abort = () => { cleanup(); reject(new DOMException('Aborted', 'AbortError')); };
          const cleanup = () => { clearTimeout(timer); peer?.removeEventListener('icegatheringstatechange', changed); controller.signal.removeEventListener('abort', abort); };
          peer!.addEventListener('icegatheringstatechange', changed);
          controller.signal.addEventListener('abort', abort, { once: true });
        });
        if (!active) return;
        const answer = await request<{ sdp: string; type: RTCSdpType; viewer_id: string }>(`/cameras/${encodeURIComponent(cameraId)}/offer`, {
          method: 'POST', body: JSON.stringify(peer.localDescription), signal: controller.signal,
        });
        viewerId = answer.viewer_id;
        if (!active) { closeViewer(viewerId); return; }
        setViewer(viewerId);
        await peer.setRemoteDescription({ sdp: answer.sdp, type: answer.type });
      } catch (reason) {
        if (active) failed(reason instanceof Error ? reason.message : 'Could not connect to video.',
          !(reason instanceof VideoRequestError) || shouldRetryCameraRequestStatus(reason.status));
      }
    };
    void connect();
    const timer = window.setInterval(async () => {
      if (!active || failedOnce) return;
      const now = performance.now();
      if (!video.paused && video.currentTime !== lastTime && video.readyState >= 2) {
        lastTime = video.currentTime; lastAdvance = now;
        if (!video.requestVideoFrameCallback) {
          hasDecodedFrame = true;
          hasEverDecodedFrame.current = true;
          frameHealth.recordFrame(now);
        }
      }
      const advancing = now - lastAdvance < 2000 && lastTime >= 0 && !video.paused;
      if (video.paused && video.readyState >= 2) { setState('Video paused'); clearCounts(); }
      else if (!advancing && now - lastAdvance > 2500) { setState('Buffering'); clearCounts(); }
      const frameStatus = frameHealth.poll(now,
        shouldWatchCameraFrames(visible, intentionallyPaused.current, Boolean(receivedTrack), autoplayBlocked.current),
        Boolean(receivedTrack));
      if (frameStatus === 'no-track' || frameStatus === 'no-frame' || frameStatus === 'stalled') {
        failed(frameStatus === 'no-frame'
          ? 'The camera session connected but did not deliver a decoded video frame.'
          : frameStatus === 'no-track' ? 'The video connection did not deliver a media track.'
            : 'The camera video stopped delivering decoded frames.');
        return;
      }
      if (!viewerId || polling) return;
      polling = true;
      try {
        const next = await request<VideoReading>(`/viewers/${viewerId}`, { signal: controller.signal });
        if (!active || failedOnce) return;
        if (['Video unavailable', 'Recorded playback ended'].includes(next.state)) {
          failed(next.state === 'Recorded playback ended' ? 'Recorded playback ended. Reconnect to replay.' : next.error || 'Video unavailable.', next.state !== 'Recorded playback ended'); return;
        }
        if (advancing && ['Live', 'Recorded playback'].includes(next.state)) {
          if (video.currentTime > 10) retries.current = 0;
          lastFailure.current = '';
          const motionTracks = motionTrailBuffer.current.update(next);
          const measured = { ...next, rendered_fps: renderedFps,
            metrics: next.metrics ? { ...next.metrics, motion_tracks: motionTracks } : next.metrics };
          setState(next.state); setError(''); setReading(measured); callback.current?.(measured);
        } else if (!video.paused) { setState(next.state === 'Live' || next.state === 'Recorded playback' ? 'Buffering' : next.state); clearCounts(); }
      } catch (reason) {
        if (active && !controller.signal.aborted) failed(reason instanceof Error ? reason.message : 'Video status unavailable.');
      } finally { polling = false; }
    }, 500);
    return () => {
      active = false; controller.abort(); clearInterval(timer); clearTimeout(retryTimer); clearTimeout(disconnectedTimer);
      video.removeEventListener('error', onMediaError);
      window.clearTimeout(trackSilenceTimer);
      if (receivedTrack && trackEndedHandler) receivedTrack.removeEventListener('ended', trackEndedHandler);
      if (receivedTrack && trackMutedHandler) receivedTrack.removeEventListener('mute', trackMutedHandler);
      if (receivedTrack && trackUnmutedHandler) receivedTrack.removeEventListener('unmute', trackUnmutedHandler);
      if (frameCallback !== undefined) video.cancelVideoFrameCallback(frameCallback);
      peer?.close(); video.pause(); video.srcObject = null;
      frameHealthRef.current = null;
      if (viewerId) closeViewer(viewerId);
      callback.current?.(null);
    };
  }, [cameraId, supported, revision, visible]);

  const changeFilter = async (settings: VideoReading['settings']) => {
    if (!viewer) return;
    try { setReading(await request<VideoReading>(`/viewers/${viewer}/settings`, { method: 'PATCH', body: JSON.stringify(settings) })); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not update camera settings.'); }
  };
  const status = !supported ? 'Video not supported' : !visible ? 'Video suspended' : state;
  const covered = !supported || !visible || ['Video unavailable', 'Connecting', 'Reconnecting', 'Buffering'].includes(status);
  const pipeline = reading?.metrics?.analysis_pipeline
    ?? {} as NonNullable<NonNullable<VideoReading['metrics']>['analysis_pipeline']>;
  const pipelineStatus = detectionPipelineStatus(reading?.metrics, reading?.inference_fps,
    reading?.state === 'Live' && reading.sample_age_seconds !== null && reading.sample_age_seconds <= 2);
  const pipelineReady = typeof pipeline.raw_candidates === 'number';
  const visibleNow = visibleDetectionCount(reading?.metrics?.detections, pipeline?.displayed_tracks);
  const classBreakdown = visibleClassBreakdown(reading?.metrics?.detections);
  const windowFrames = pipelineReady ? pipeline.window_frames || 0 : 0;
  const windowSeconds = pipeline?.window_seconds || 2;
  const diagnostic = !reading ? '' : pipelineStatus === 'unavailable'
    ? 'Live video is advancing, but this camera API does not provide the current detection telemetry. Restart the API to enable per-frame model diagnostics.'
    : pipelineStatus === 'inference_only' ? `The model is processing about ${reading.inference_fps.toFixed(1)} frames per second; this camera API does not provide per-frame candidate and tracking details.`
    : pipelineStatus === 'stale' ? 'Live video is advancing, but the server has no fresh analyzed frame. Detection counts are hidden until analysis resumes.'
    : visibleNow > 0 ? `${visibleNow} ${visibleNow === 1 ? 'tracked object is' : 'tracked objects are'} visible now.`
    : (pipeline.inbound_tracks_peak || 0) > 0 ? `Inbound traffic was tracked in the last ${windowSeconds} seconds; waiting for the next visible frame.`
    : (pipeline.road_candidate_frames || 0) > 0 ? `Vehicle candidates appeared in ${pipeline.road_candidate_frames} of ${windowFrames} recent frames; tracking is checking consistent motion.`
    : (pipeline.raw_candidate_frames || 0) > 0 ? `The model found ${pipeline.outside_zone_observations ?? pipeline.raw_candidates} vehicle candidates outside the inbound zone in ${pipeline.raw_candidate_frames} of ${windowFrames} recent frames${pipeline.outside_zone_classes && Object.keys(pipeline.outside_zone_classes).length ? ` (${Object.entries(pipeline.outside_zone_classes).map(([name, count]) => `${count} ${name}`).join(', ')})` : ''}. They may be traffic on another carriageway or vehicles missed by the current road boundary. Review the dashed gold boxes in Edit road zone before changing the polygon; these candidates are not tracked or counted.`
    : `No objects were detected in the last ${windowSeconds} seconds. Night glare, blur, and distant vehicles can hide traffic.`;
  return <div className="p-live-player" ref={stage}>
    <div className="p-live-stage" ref={setVideoStage}><video ref={ref} autoPlay muted playsInline aria-label={`Continuous video from ${name}`} />
      {covered && <div className="p-live-cover" role="status"><Icon name="camera" size={34} /><strong>{status}</strong><span>{!supported ? 'This source does not provide continuous video.' : error || 'Waiting for the video source…'}</span></div>}
      <div className="p-live-badge"><Badge tone={status === 'Live' ? 'green' : 'amber'}>{status}</Badge></div>
    </div>
    {!compact && reading && <section className="p-detection-diagnostic" aria-label="Live detection pipeline" aria-live="polite">
      <div className="p-detection-diagnostic-head"><strong>Live detection</strong><span>{pipelineReady ? `Rolling ${pipeline.window_seconds ?? 2}-second window · latest model frame` : pipelineStatus === 'inference_only' ? 'Model inference active · details unavailable' : pipelineStatus === 'unavailable' ? 'Detection telemetry unavailable' : 'No fresh analysis result'}</span></div>
      <div className="p-detection-stages">
        {[['Model now', pipelineReady ? pipeline.raw_candidates : pipelineStatus === 'unavailable' || pipelineStatus === 'inference_only' ? 'Unavailable' : 'Stale'], ['Road hits / frames', pipelineReady ? `${pipeline.road_candidate_observations ?? pipeline.road_candidates} / ${pipeline.window_frames ?? 1}` : pipelineStatus === 'unavailable' || pipelineStatus === 'inference_only' ? 'Unavailable' : 'Stale'], ['Tracked peak', pipelineReady ? pipeline.inbound_tracks_peak ?? pipeline.inbound_tracks : pipelineStatus === 'unavailable' || pipelineStatus === 'inference_only' ? 'Unavailable' : 'Stale'], ['Visible now', pipelineReady ? visibleNow : pipelineStatus === 'unavailable' || pipelineStatus === 'inference_only' ? 'Unavailable' : 'Stale']].map(([label, value]) =>
          <div className="p-detection-stage" key={label as string}><span>{label}</span><strong>{typeof value === 'number' || typeof value === 'string' ? value : '—'}</strong></div>)}
      </div>
      {!!pipeline?.duplicate_candidates && <span className="p-detection-duplicates">{pipeline.duplicate_candidates} overlapping duplicate {pipeline.duplicate_candidates === 1 ? 'box removed' : 'boxes removed'} before tracking.</span>}
      <p>{diagnostic}</p>
      {pipelineReady && classBreakdown && visibleNow > 0 && <p className="p-detection-class-note">Visible object classes · {classBreakdown.stable} stable · {classBreakdown.pending} pending. Pending vehicle classes remain generic until repeated evidence supports a specific type.</p>}
      {reading.analysis_zone?.enabled && pipelineReady && <p className="p-detection-zone-diagnostic">
        {formatOutsideZoneSummary(pipeline.outside_zone_observations ?? pipeline.outside_zone_candidates ?? 0,
          pipeline.outside_zone_classes, pipeline.window_seconds ?? 2)}
      </p>}
      <small className="p-detection-label-note">Percentages on provisional boxes show vehicle-detection confidence, not class probability. A “?” marks a provisional type; history keeps it as Vehicle until confirmed.</small>
    </section>}
    {zoneEditorOpen && <RoadZoneEditor cameraId={cameraId} stageElement={videoStage} onClose={() => setEditingZone(false)} onSaved={onZoneSaved} routeReference={routeReference}
      frameWidth={reading?.metrics?.width ?? 0} frameHeight={reading?.metrics?.height ?? 0}
      motionTracks={reading?.metrics?.motion_tracks ?? reading?.metrics?.observed_detections ?? reading?.metrics?.detections ?? []}
      outsideCandidateCount={reading?.metrics?.analysis_pipeline?.outside_zone_candidates ?? 0}
      outsideCandidates={reading?.metrics?.analysis_pipeline?.outside_zone_boxes ?? []}
      directionalOutsideTracks={reading?.metrics?.analysis_pipeline?.directional_outside_tracks ?? []} />}
    <div className="p-live-controls"><button className="p-button" disabled={covered} onClick={() => {
      const video = ref.current; if (!video) return;
      if (video.paused) { intentionallyPaused.current = false; autoplayBlocked.current = false; void video.play().then(() => { frameHealthRef.current?.setWatching(performance.now(), shouldWatchCameraFrames(visible, intentionallyPaused.current)); setPaused(false); }).catch(() => { autoplayBlocked.current = true; setError('Press play to continue.'); }); }
      else { intentionallyPaused.current = true; autoplayBlocked.current = false; video.pause(); frameHealthRef.current?.setWatching(performance.now(), shouldWatchCameraFrames(visible, intentionallyPaused.current)); setPaused(true); setState('Video paused'); setReading(null); callback.current?.(null); }
    }}><Icon name={paused ? 'play' : 'pause'} />{paused ? 'Resume' : 'Pause'}</button>
      <button className="p-button" disabled={!supported} onClick={() => { intentionallyPaused.current = false; autoplayBlocked.current = false; retries.current = 0; lastFailure.current = ''; setRevision(value => value + 1); }}><Icon name="refresh" />Reconnect</button>
      {!compact && <button className="p-button" onClick={() => void stage.current?.requestFullscreen?.().catch(() => setError('Fullscreen is unavailable in this browser.'))}><Icon name="expand" />Fullscreen</button>}
      {!compact && <button className="p-button" disabled={state !== 'Live'} onClick={() => setEditingZone(open => !(open ?? (startZoneEditing && state === 'Live')))}>Edit road zone</button>}
      {!compact && <span className="p-small-note">{reading ? `${reading.rendered_fps ?? reading.output_fps} ${reading.rendered_fps == null ? 'server' : 'rendered'} FPS · ${reading.inference_fps} detection updates/s${reading.detection_profile === 'low_light' ? ' · Low-light analysis' : ''}` : 'Continuous video · vehicle tracking'}</span>}
    </div>
    {reading && !compact && <details className="p-live-settings"><summary>Detection settings</summary><p className="p-small-note">Shared by all viewers of this camera.</p>
      <p className="p-small-note">Model: {reading.model || 'Configured detector'} · {reading.tracker || 'Tracker'}. {reading.analysis_zone?.enabled ? `Approaching traffic only · zone revision ${reading.analysis_zone.revision}.` : 'Full-scene analysis; configure a road zone to restrict direction.'} Specific types require repeated class evidence; uncertain objects remain “vehicle”.</p>
      {reading.detection_profile === 'low_light' && <p className="p-small-note">Low-light analysis uses the configured road detector and repeated observations to confirm tracks. Glare and blur can still hide vehicles.</p>}
      {reading.detection_profile === 'low_light_unavailable' && <p role="status" className="p-inline-error">The low-light model is not installed. Using the standard detector.</p>}
      <label>Minimum track confidence {Math.round(reading.settings.confidence * 100)}%<input aria-label="Minimum detection confidence" type="range" min=".1" max=".95" step=".05" value={reading.settings.confidence} onChange={event => void changeFilter({ ...reading.settings, confidence: Number(event.target.value) })} /></label>
      <label className="p-low-light-candidates"><input type="checkbox" checked={reading.settings.show_candidates} onChange={event => void changeFilter({ ...reading.settings, show_candidates: event.target.checked })} />Show repeated low-light candidates <span>Dashed amber boxes are provisional; this display setting does not change saved tracks, crossing totals or road estimates.</span></label>
      <div className="p-overlay-options">{['car', 'motorcycle', 'bus', 'truck', 'vehicle', 'bicycle', 'pedestrian', ...(reading.settings.classes.includes('rider') ? ['rider'] : [])].map(name => <label key={name}><input type="checkbox" checked={reading.settings.classes.includes(name)} onChange={event => void changeFilter({ ...reading.settings, classes: event.target.checked ? [...reading.settings.classes, name] : reading.settings.classes.filter(item => item !== name) })} />{name === 'vehicle' ? 'Uncertain vehicle type' : name === 'rider' ? 'Rider (bike or motorcycle unclear)' : name}</label>)}</div>
    </details>}
    {error && <p className="p-inline-error" role="status">{error}</p>}
    {reading?.storage_error && <p className="p-inline-error" role="status">{reading.storage_error}</p>}
  </div>;
}
