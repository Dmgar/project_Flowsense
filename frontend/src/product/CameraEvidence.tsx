import { useEffect, useId, useRef, useState } from 'react';
import { LiveCameraPlayer, type VideoReading } from './LiveCameraPlayer';
import { TrafficSummary } from './TrafficSummary';
import { CaseDialog } from './ReviewWorkflow';
import { useProduct } from './store';
import { apiUrl } from '../api/urls';
import { nextCalibrationCamera } from './cameraCalibration';
import { cameraCatalogStatus } from './cameraCatalogStatus';
import { Badge, EmptyState, Icon, Panel } from './ui';
import type { Camera, Signal } from './types';
import './cameraOrientation.css';

export function CameraEvidence({ cameraId, onRetry }: { cameraId?: string; onRetry?: () => void }) {
  const sectionPrefix = useId();
  const videoSection = useRef<HTMLDivElement>(null);
  const reviewTrigger = useRef<HTMLButtonElement>(null);
  const cameras = useProduct(s => s.cameras);
  const catalogLoaded = useProduct(s => s.cameraCatalogLoaded);
  const catalogFailed = useProduct(s => s.cameraCatalogFailed);
  const catalogStatus = cameraCatalogStatus(cameras.length, catalogLoaded, catalogFailed);
  const camera = cameraId ? cameras.find(item => item.id === cameraId) : cameras.find(item => item.stream_url);
  const favorites = useProduct(s => s.favoriteCameras);
  const watched = useProduct(s => s.watchCameras);
  const [reading, setReading] = useState<VideoReading | null>(null);
  const [review, setReview] = useState<Signal | null>(null);
  const [queueNext, setQueueNext] = useState<Camera | null>(null);
  const [queueMessage, setQueueMessage] = useState('');
  const [queueProgress, setQueueProgress] = useState<{ ready: number; total: number } | null>(null);
  const [queueSaving, setQueueSaving] = useState(false);
  const [queueForCamera, setQueueForCamera] = useState('');
  const startZoneEditing = new URLSearchParams(window.location.search).get('calibrate') === 'road';
  const queueMode = new URLSearchParams(window.location.search).get('queue') === '1';
  useEffect(() => {
    if (!queueMode || !camera) return;
    const controller = new AbortController();
    void fetch(apiUrl('/api/v1/mobility/video/analysis-zones'), {
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]),
    })
      .then(async response => {
        if (!response.ok) throw new Error('Could not load the next camera in the calibration queue.');
        return response.json() as Promise<{ calibrated_count: number; video_camera_count: number; cameras: { camera_id: string; ready_for_road_analysis: boolean; route_metadata_available: boolean }[] }>;
      })
      .then(coverage => {
        setQueueProgress({ ready: coverage.calibrated_count, total: coverage.video_camera_count });
        const next = nextCalibrationCamera(cameras, coverage.cameras, camera.id);
        setQueueNext(next || null);
        setQueueMessage(next
          ? `Review this live feed and save a road zone only if its inbound direction is clear. If playback is unavailable, skip to ${next.name}; this camera will remain uncalibrated.`
          : 'No other video sources remain in the calibration queue. This camera still needs a reviewed road zone before it can contribute directional estimates.');
        setQueueForCamera(camera.id);
      })
      .catch(reason => {
        if (controller.signal.aborted) return;
        setQueueNext(null);
        setQueueMessage(reason instanceof Error ? reason.message : 'Reopen the camera list to continue the calibration queue.');
        setQueueForCamera(camera.id);
      });
    return () => controller.abort();
  }, [camera, cameras, queueMode]);
  useEffect(() => {
    const selectedCamera = camera;
    if (!selectedCamera || selectedCamera.provider !== 'Caltrans' || selectedCamera.provider_in_service === false
        || !selectedCamera.stream_url.toLowerCase().includes('.m3u8')) return;
    let stopped = false, pending = false;
    const controller = new AbortController();
    const check = async () => {
      if (stopped || pending || document.visibilityState !== 'visible') return;
      pending = true;
      try {
        const response = await fetch(apiUrl(`/api/v1/mobility/cameras/${encodeURIComponent(selectedCamera.id)}/video-health`), {
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12000)]),
        });
        if (!response.ok) throw new Error('Live source health is temporarily unavailable.');
        const health = await response.json() as NonNullable<Camera['video_health']>;
        if (!stopped) useProduct.getState().setCameraVideoHealth(selectedCamera.id, health);
      } catch { /* A temporary check failure never marks a source offline. */ }
      finally { pending = false; }
    };
    void check();
    const timer = window.setInterval(() => void check(), 30000);
    return () => { stopped = true; controller.abort(); clearInterval(timer); };
  }, [camera]);
  if (!camera) return <div className="p-screen p-camera-unavailable"><EmptyState headingAs="h1" icon={catalogStatus === 'error' ? 'alert' : 'camera'}
    title={catalogStatus === 'error' ? 'Camera catalog unavailable' : !catalogLoaded ? 'Loading camera sources' : cameraId ? 'Camera source not found' : 'No video cameras available'}
    detail={catalogStatus === 'error' ? 'The camera catalog could not be refreshed. Retry the connection to load registered video sources.' : !catalogLoaded ? 'Waiting for the catalog before locating this source. Your saved selections remain unchanged.' : cameraId ? 'This camera was not found in the loaded catalog. Open the catalog to choose another registered source.' : 'No registered video sources currently provide continuous video.'}
    action={catalogStatus === 'error'
      ? <button className="p-button primary" onClick={onRetry}>Retry camera catalog</button>
      : cameras.length > 0 || catalogStatus === 'empty' ? <button className="p-button" onClick={() => useProduct.getState().navigate('/cameras')}>View cameras</button> : undefined}
  /></div>;
  const current = reading?.camera_id === camera.id ? reading : null;
  const onDesk = watched.includes(camera.id);
  const deskFull = watched.length >= 4 && !onDesk;
  const sessionTone = current?.error ? 'amber' : current?.state === 'Live' ? 'green' : 'gray';
  const activeQueueMessage = queueForCamera === camera.id ? queueMessage : '';
  const activeQueueNext = queueForCamera === camera.id ? queueNext : null;
  const queueLoading = queueSaving || (queueMode && queueForCamera !== camera.id);
  const counts = current?.counts;
  const objectCount = current?.metrics?.analysis_pipeline?.inbound_tracks_peak
    ?? (counts ? Object.values(counts).reduce((sum, count) => sum + count, 0) : null);
  const exportSession = () => {
    if (!current) return;
    const blob = new Blob([JSON.stringify({ camera: camera.id, provider: camera.provider, source_url: camera.source_url, exported_at: new Date().toISOString(), note: 'Latest session telemetry; not a video recording or cumulative traffic count.', ...current }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `flowsense-video-${current.session_id}.json`; link.click(); URL.revokeObjectURL(url);
    useProduct.getState().notify(`${link.download} prepared. Check your browser downloads for the session metadata JSON.`);
  };
  const handleZoneSaved = () => {
    if (!queueMode) return;
    setQueueSaving(true);
    setQueueMessage('');
    void fetch(apiUrl('/api/v1/mobility/video/analysis-zones'), { signal: AbortSignal.timeout(10000) })
      .then(async response => {
        if (!response.ok) throw new Error('Zone saved. Could not load the next camera in the queue.');
        return response.json() as Promise<{ calibrated_count: number; video_camera_count: number; cameras: { camera_id: string; ready_for_road_analysis: boolean; route_metadata_available: boolean }[] }>;
      })
      .then(coverage => {
        setQueueProgress({ ready: coverage.calibrated_count, total: coverage.video_camera_count });
        const next = nextCalibrationCamera(cameras, coverage.cameras, camera.id);
        const currentZone = coverage.cameras.find(item => item.camera_id === camera.id);
        setQueueNext(next || null);
        setQueueMessage(next
          ? 'This road zone is saved.' + (currentZone?.route_metadata_available
            ? ''
            : ' Route and direction metadata still need review for this camera.') + ' Continue with ' + next.name + ' when you are ready.'
          : 'This road zone is saved.' + (currentZone?.ready_for_road_analysis
            ? ' No other video sources remain in the calibration queue.'
            : ' Route or direction metadata still needs review, so this source is not ready for road analysis yet.'));
        setQueueForCamera(camera.id);
      })
      .catch(reason => {
        setQueueNext(null);
        setQueueMessage(reason instanceof Error ? reason.message : 'Zone saved. Reopen the camera list to continue.');
        setQueueForCamera(camera.id);
      })
      .finally(() => setQueueSaving(false));
  };
  return <div className="p-screen p-camera-screen">
    <nav className="p-camera-breadcrumb" aria-label="Camera navigation"><a href="/cameras" onClick={event => { if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return; event.preventDefault(); useProduct.getState().navigate('/cameras'); }}><Icon name="camera" size={14} />Camera catalog</a><Icon name="arrow" size={12} /><span aria-current="page">{camera.name}</span></nav>
    <div className="p-page-heading"><div><span className="p-eyebrow">CONTINUOUS VIDEO · VEHICLE TRACKING</span><h1>{camera.name}</h1><p>{camera.provider} · {camera.district}</p></div><div className="p-heading-actions">
      <button className="p-button" aria-pressed={favorites.includes(camera.id)} onClick={() => useProduct.getState().toggleFavorite(camera.id)}><Icon name="star" />{favorites.includes(camera.id) ? 'Saved to favorites' : 'Save favorite'}</button>
      <button className="p-button" onClick={() => { useProduct.getState().setDistrict(camera.district); useProduct.getState().setMapFocus([camera.lat, camera.lng]); useProduct.getState().navigate('/map'); }}><Icon name="pin" />View on map</button>
    </div></div>
    <nav className="p-camera-section-links" aria-label="Camera page sections"><a href={`#${sectionPrefix}-video`}><Icon name="play" size={18} /><span><b>Video session</b><small>Watch and review</small></span><Icon name="arrow" size={13} /></a><a href={`#${sectionPrefix}-health`}><Icon name="info" size={18} /><span><b>Session health</b><small>Connection and timing</small></span><Icon name="arrow" size={13} /></a><a href={`#${sectionPrefix}-history`}><Icon name="report" size={18} /><span><b>Saved evidence</b><small>Earlier captures</small></span><Icon name="arrow" size={13} /></a></nav>
    <div className="p-camera-layout"><div ref={videoSection} id={`${sectionPrefix}-video`} className="p-camera-main" tabIndex={-1} aria-label="Video session and review actions">
      <LiveCameraPlayer key={camera.id} cameraId={camera.id} name={camera.name} supported={!!camera.stream_url} providerOutOfService={camera.provider_in_service === false} sourceUnavailableMessage={camera.video_health?.state === 'unavailable' ? camera.video_health.message : undefined} sourceHealthTimedOut={camera.video_health?.state === 'temporary_error'} onReading={setReading} startZoneEditing={startZoneEditing} onZoneSaved={handleZoneSaved} routeReference={camera.route && camera.direction ? `${camera.route} · ${camera.direction}bound source reference` : undefined} />
      <div className="p-camera-tools"><button className="p-button" disabled={(!camera.stream_url || deskFull) && !onDesk} aria-label={`${onDesk ? 'Remove' : 'Add'} ${camera.name} ${onDesk ? 'from' : 'to'} the observation desk`} aria-describedby={`${sectionPrefix}-actions-help`} aria-pressed={onDesk} onClick={() => useProduct.getState().toggleWatch(camera.id)}><Icon name="grid" />{onDesk ? 'On the observation desk' : 'Add to desk'}</button><button className="p-button" disabled={!current} aria-describedby={`${sectionPrefix}-actions-help`} onClick={exportSession}><Icon name="download" />Export session metadata</button>{camera.source_url && <a className="p-button" href={camera.source_url} target="_blank" rel="noreferrer" aria-label={`Official source for ${camera.name}, opens in a new tab`}>Official source <Icon name="arrow" /></a>}</div>
      <p className="p-camera-action-hint" id={`${sectionPrefix}-actions-help`}>{current ? 'Metadata export saves a session snapshot (JSON), not video or cumulative traffic totals.' : 'Session metadata becomes available after the video session reports its data.'}{deskFull && ' The desk already has four saved selections; remove one before adding this source.'}</p>
      {deskFull && <button type="button" className="p-text-button p-camera-desk-shortcut" onClick={() => useProduct.getState().navigate('/watch')}>Review observation desk<Icon name="arrow" size={14} /></button>}
      <button ref={reviewTrigger} className="p-button p-camera-review-trigger" disabled={!current?.metrics} aria-describedby={`${sectionPrefix}-review-help`} onClick={() => {
        if (!current?.metrics) return;
        setReview({ id: `VIDEO-${current.session_id}-${current.metrics.sequence}`, title: 'Video session review', location: camera.name, district: camera.district,
          type: 'Manual review', severity: 'medium', confidence: null, impact: 0, evidence: 'Video session metadata', duration: 0, causes: [], lat: camera.lat, lng: camera.lng,
          action: `Reviewed video session ${current.session_id}, generation ${current.metrics.generation}, sample ${current.metrics.sequence}, media time ${current.metrics.media_time_seconds}s. Observation history is stored separately; detection-triggered video clip availability depends on server recording settings. Detection does not confirm an incident.`,
          owner: 'Traffic operations', cameraIndex: cameras.findIndex(item => item.id === camera.id), data_origin: 'observation', evidence_camera_id: camera.id,
          evidence_session_id: current.session_id, evidence_media_time_seconds: current.metrics.media_time_seconds });
      }}><Icon name="shield" />Open evidence review</button>
      <p className="p-camera-action-hint" id={`${sectionPrefix}-review-help`}>{current?.metrics ? 'Document the evidence you checked and the next human review step.' : 'A review can be opened when this session has reported observation metadata.'}</p>
      <p className="p-small-note">Inbound traffic analysis · Saved counts and observations depend on session storage availability. Check the saved record below. The counting line and road zone appear only while editing.</p>
      {queueMode && (queueLoading || activeQueueMessage) && <div className="p-calibration-queue" role="status">
        <div><span className="p-eyebrow">CAMERA CALIBRATION QUEUE</span>{queueProgress && <p>Road analysis ready · {queueProgress.ready} of {queueProgress.total} video cameras</p>}<p>{queueLoading ? 'Loading the next uncalibrated video source…' : activeQueueMessage}</p></div>
        {activeQueueNext && <button className="p-button primary" onClick={() => useProduct.getState().navigate('/cameras/' + activeQueueNext.id + '?calibrate=road&queue=1')}>{activeQueueMessage.startsWith('This road zone is saved.') ? 'Next' : 'Skip to'}: {activeQueueNext.name}{activeQueueNext.route ? ` · ${activeQueueNext.route}` : ''}{activeQueueNext.direction ? ` ${activeQueueNext.direction}bound reference` : ''}<Icon name="arrow" size={15} /></button>}
      </div>}
      {!camera.stream_url && <Panel title="Choose a video source"><div className="p-camera-alternatives">{cameras.filter(item => item.stream_url).slice(0, 5).map(item => <button key={item.id} onClick={() => useProduct.getState().navigate(`/cameras/${item.id}`)}>{item.name}<Icon name="arrow" /></button>)}</div></Panel>}
    </div><aside id={`${sectionPrefix}-health`} className="p-camera-insights" tabIndex={-1} aria-label="Video session health">
      <Panel title="Session health"><div className="p-health-rows"><span>Video<Badge tone={sessionTone}>{current?.state || 'Waiting for video'}</Badge></span><span>Inference engine<b>{current?.execution_provider || '—'}</b></span><span>Server output<b>{current ? `${current.output_fps} FPS` : '—'}</b></span><span>Inference<b>{current ? `${current.inference_fps} updates/s` : '—'}</b></span><span>Resolution<b>{current?.metrics ? `${current.metrics.width} × ${current.metrics.height}` : '—'}</b></span><span>Speed and lanes<b>Not calibrated</b></span></div></Panel>
    </aside><section id={`${sectionPrefix}-history`} className="p-camera-history" tabIndex={-1} aria-labelledby={`${sectionPrefix}-history-title`}>
      <div className="p-camera-history-heading"><span className="p-eyebrow">SAVED RECORD</span><h2 id={`${sectionPrefix}-history-title`}>Activity and saved evidence</h2><p>Saved evidence comes from earlier captures. Check its timestamps and source before comparing it with the current session.</p></div>
      <TrafficSummary key={camera.id} camera={camera} activeCount={objectCount} storageError={current?.storage_error || ''} />
    </section></div>{review && <CaseDialog signal={review} onClose={() => { setReview(null); requestAnimationFrame(() => { const trigger = reviewTrigger.current; if (trigger?.isConnected && !trigger.disabled) trigger.focus({ preventScroll: true }); else videoSection.current?.focus({ preventScroll: true }); }); }} />}
  </div>;
}
