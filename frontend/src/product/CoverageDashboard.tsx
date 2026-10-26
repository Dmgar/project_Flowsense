import { useEffect, useState } from 'react';
import { regions, matchesZone } from './coverage';
import { cameraStatus, checkedAt } from './cameraStatus';
import { CameraThumb } from './CameraThumb';
import { useProduct } from './store';
import { Badge, EmptyState, Icon, Panel } from './ui';
import { apiUrl } from '../api/urls';
import { loadCameraCoverage } from './cameraCoverageRequest';
import './coverageReading.css';
import { calibrationCorridorProgress, calibrationPlaybackCoverage, calibrationProgress, calibrationQueue, hasPreviouslyVerifiedVideo, isCurrentlyPlaying, type CameraZoneStatus } from './cameraCalibration';

interface ZoneCoverage extends CameraZoneStatus {
  camera_id: string; name?: string; status?: string; zone_revision?: number;
}

export function CoverageDashboard() {
  const cameras = useProduct(s => s.cameras);
  const district = useProduct(s => s.district);
  const favorites = useProduct(s => s.favoriteCameras);
  const catalogLoaded = useProduct(s => s.cameraCatalogLoaded);
  const catalogFailed = useProduct(s => s.cameraCatalogFailed);
  const [zoneCoverage, setZoneCoverage] = useState<ZoneCoverage[] | null>(null);
  const [zoneCoverageError, setZoneCoverageError] = useState('');
  const [loadingCoverage, setLoadingCoverage] = useState(true);
  const [coverageRetry, setCoverageRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void loadCameraCoverage<{ cameras: ZoneCoverage[] }>(apiUrl('/api/v1/mobility/video/analysis-zones'), controller.signal)
      .then(result => {
        if (!Array.isArray(result?.cameras)) throw new Error('The coverage service returned an incomplete response.');
        setZoneCoverage(result.cameras);
      })
      .catch(reason => { if (!controller.signal.aborted) setZoneCoverageError(reason instanceof Error ? reason.message : 'Could not load road-zone coverage.'); })
      .finally(() => { if (!controller.signal.aborted) setLoadingCoverage(false); });
    return () => controller.abort();
  }, [coverageRetry]);
  const scoped = cameras.filter(c => matchesZone(district, c.district));
  const scopedVideo = scoped.filter(camera => camera.stream_url);
  const catalogReady = catalogLoaded && !catalogFailed;
  const calibration = zoneCoverage && catalogReady ? calibrationProgress(scoped, zoneCoverage) : null;
  const calibratedCount = calibration?.ready ?? 0;
  const queue = zoneCoverage && catalogReady ? calibrationQueue(scopedVideo, zoneCoverage) : [];
  const playbackCoverage = calibrationPlaybackCoverage(queue);
  const liveVideoCount = zoneCoverage
    ? scopedVideo.filter(camera => isCurrentlyPlaying(zoneCoverage.find(item => item.camera_id === camera.id))).length
    : 0;
  const calibratedLiveCount = zoneCoverage
    ? scopedVideo.filter(camera => {
      const status = zoneCoverage.find(item => item.camera_id === camera.id);
      return status?.ready_for_road_analysis && isCurrentlyPlaying(status);
    }).length
    : 0;
  const corridorProgress = zoneCoverage && catalogReady ? calibrationCorridorProgress(scopedVideo, zoneCoverage) : [];
  const unavailableSources = (zoneCoverage ?? []).filter(status => status.source_health?.state === 'unavailable');
  const nextCamera = queue[0];
  const coverageTotal = calibration?.total ?? null;
  const linked = scoped.filter(c => c.stream_url).length;
  const saved = scoped.filter(c => favorites.includes(c.id));
  const savedEmptyState = favorites.length === 0
    ? { title: 'No cameras saved yet', detail: catalogFailed ? 'Your saved-camera list is empty. The camera catalog is unavailable, so you cannot browse and save a source right now.' : catalogLoaded ? 'Save frequently used cameras from the gallery or evidence view. They will be kept in this browser.' : 'Camera sources are still loading. You can save a camera from the gallery or evidence view once they are available.', action: catalogFailed ? <button className="p-button" onClick={() => useProduct.getState().navigate('/cameras')}>Open camera catalog to retry</button> : undefined }
    : catalogFailed
      ? { title: 'Saved camera details unavailable', detail: 'The camera catalog could not load. Your saved camera IDs remain in this browser; retry the connection to restore their details.', action: <button className="p-button" onClick={() => useProduct.getState().navigate('/cameras')}>Open camera catalog to retry</button> }
      : !catalogLoaded
        ? { title: 'Loading your saved cameras', detail: 'Checking the camera catalog for your saved sources.' }
        : !cameras.some(camera => favorites.includes(camera.id))
          ? { title: 'Saved references are not in this catalog', detail: 'Your camera choices remain saved in this browser, but the current catalog does not include their details. Browse available sources to choose a camera; your existing references have not been removed.', action: <button className="p-button" onClick={() => useProduct.getState().navigate('/cameras')}>Browse current camera catalog</button> }
          : { title: 'Saved cameras in other areas', detail: 'Your saved cameras are outside the selected city. Show all areas to find them.', action: <button className="p-button" onClick={() => { useProduct.getState().setDistrict('All districts'); useProduct.getState().setMapFocus(null); }}>Show all areas</button> };
  return <section className="p-coverage-dashboard" aria-label="Coverage and saved cameras">
    <Panel title="Coverage by city" action={<Badge tone="green">{catalogReady ? `${cameras.length} sources` : catalogFailed ? 'Unavailable' : 'Loading…'}</Badge>}>
      <p className="p-small-note">{catalogReady ? `${linked} video sources registered in this area. Playback is checked when you open a camera; sources are not all running in the background.` : catalogFailed ? 'Camera coverage counts are unavailable because the catalog could not be loaded.' : 'Loading the public camera catalog before calculating coverage.'}</p>
      <div className="p-road-calibration" aria-label="Road-zone calibration progress">
        <div><div><b>Road analysis calibration</b><span>{!catalogReady ? catalogFailed ? 'Unavailable' : 'Loading…' : loadingCoverage ? 'Loading…' : coverageTotal === null ? 'Unavailable' : `${calibratedCount} of ${coverageTotal} zones reviewed`}</span></div>
          <progress hidden={!catalogReady || coverageTotal === null} max={Math.max(1, coverageTotal || 1)} value={calibratedCount} aria-label="Camera road zones reviewed" /></div>
        <p>{!catalogReady
          ? catalogFailed ? 'Calibration progress cannot be calculated until the camera catalog is available.' : 'The camera catalog is loading; calibration progress will appear when its sources are known.'
          : coverageTotal === null
          ? 'Camera tracks are not assigned to road conditions until each video source has an inbound road zone and direction.'
          : coverageTotal === 0
          ? 'No video sources are registered in this area, so there are no road zones to calibrate. Choose another city or explore the camera catalog.'
          : `${coverageTotal - calibratedCount} sources need road-zone review. ${liveVideoCount} are streaming now; ${calibratedLiveCount} also have reviewed zones. Live estimates require fresh analysis as well as video. Inactive sources remain unverified unless a source check confirms an outage. Of the sources awaiting review, ${queue.filter(camera => isCurrentlyPlaying(zoneCoverage?.find(item => item.camera_id === camera.id))).length} are streaming; ${playbackCoverage.previouslyVerified} URLs responded previously but still need live lane review; ${playbackCoverage.playbackCheckRequired} need playback verified before calibration.`}</p>
        {unavailableSources.length > 0 && <details className="p-road-queue p-source-health-list">
          <summary>Recent source checks report {unavailableSources.length} unavailable feed{unavailableSources.length === 1 ? '' : 's'}</summary>
          <p>These feeds cannot provide current video or road estimates while unavailable. Saved history is preserved.</p>
          <ul>{unavailableSources.map(source => <li key={source.camera_id}>
            <div><b>{source.name || source.camera_id}</b>
              <small>{[source.route, source.direction && `${source.direction}bound`].filter(Boolean).join(' · ') || 'Road reference needs review'}</small>
              <span>Source returned HTTP {source.source_health?.http_status ?? '404'} · check again later</span></div>
            <button className="p-text-button" aria-label={`Open ${source.name || source.camera_id}`} onClick={() => useProduct.getState().navigate(`/cameras/${encodeURIComponent(source.camera_id)}`)}>Open</button>
          </li>)}</ul>
        </details>}
        {zoneCoverageError && <div role="status" className="p-inline-error"><span>{zoneCoverageError}{zoneCoverage ? ' Showing the last successfully loaded coverage.' : ''}</span><button type="button" className="p-text-button" disabled={loadingCoverage} onClick={() => { setLoadingCoverage(true); setZoneCoverageError(''); setCoverageRetry(value => value + 1); }}>{loadingCoverage ? 'Retrying…' : 'Retry coverage'}</button></div>}
        {catalogReady && nextCamera && (nextCamera.route || nextCamera.direction) && <p>Next source reference: {[nextCamera.route, nextCamera.direction && `${nextCamera.direction}bound`].filter(Boolean).join(' · ')}. Confirm the inbound lanes against moving video before saving.</p>}
        <button className="p-button primary" disabled={!catalogReady || coverageTotal === 0 || !nextCamera || loadingCoverage} onClick={() => nextCamera && useProduct.getState().navigate(`/cameras/${encodeURIComponent(nextCamera.id)}?calibrate=road&queue=1`)}>
          <Icon name="route" />{!catalogReady ? catalogFailed ? 'Camera catalog unavailable' : 'Loading camera catalog' : loadingCoverage ? 'Loading calibration queue' : zoneCoverageError && !zoneCoverage ? 'Coverage unavailable · retry above' : coverageTotal === 0 ? 'No video sources in this area' : nextCamera ? `Calibrate next camera · ${nextCamera.name}` : calibratedCount === coverageTotal && coverageTotal !== null ? 'All video sources calibrated' : 'Coverage unavailable'}
        </button>
        {corridorProgress.length > 0 && <details className="p-road-queue p-corridor-coverage">
          <summary>Directed road coverage · {corridorProgress.reduce((total, item) => total + item.ready, 0)} of {corridorProgress.reduce((total, item) => total + item.total, 0)} cameras calibrated across {corridorProgress.length} corridors</summary>
          <ol>{corridorProgress.map(corridor => <li key={corridor.key}>
            <div><b>{corridor.route} · {corridor.direction}{corridor.direction.endsWith('review') ? '' : 'bound'}</b>
              <small>{corridor.ready} of {corridor.total} cameras calibrated · {corridor.pending} pending</small></div>
            {corridor.next_camera && <button className="p-text-button" aria-label={`Calibrate ${corridor.route} ${corridor.direction}: ${corridor.next_camera.name}`} onClick={() => useProduct.getState().navigate(`/cameras/${encodeURIComponent(corridor.next_camera!.id)}?calibrate=road&queue=1`)}>Next: {corridor.next_camera.name}</button>}
          </li>)}</ol>
          <p>Road references group cameras by route and direction. Each camera still needs its inbound lane and counting line reviewed against live video.</p>
        </details>}
        {queue.length > 0 && <details className="p-road-queue">
          <summary>View calibration queue · {queue.length} remaining</summary>
          <ol>{queue.slice(0, 8).map(camera => {
            const status = zoneCoverage?.find(item => item.camera_id === camera.id);
            const route = [camera.route, camera.direction && `${camera.direction}bound`].filter(Boolean).join(' · ');
            const requirement = status?.status === 'zone_and_metadata_required' ? 'Road zone and route reference required'
              : status?.status === 'route_metadata_required' ? 'Route reference required' : 'Inbound road zone required';
            return <li key={camera.id}><div><b>{camera.name}</b><small>{route || 'Road and direction reference needs review'}</small>
              <span>{status?.source_health?.state === 'unavailable'
                ? `Source unavailable${status.source_health.http_status ? ` · HTTP ${status.source_health.http_status}` : ''}. Skip calibration until the feed returns.`
                : `${requirement} · ${isCurrentlyPlaying(status) ? `Live video verified now · ${status?.playback_session_state}` : hasPreviouslyVerifiedVideo(camera) ? 'HLS URL returned HTTP 200 previously · confirm playback' : 'Verify live video first'}`}</span></div>
              <button className="p-text-button" aria-label={`Open calibration for ${camera.name}`} onClick={() => useProduct.getState().navigate(`/cameras/${encodeURIComponent(camera.id)}?calibrate=road&queue=1`)}>Open</button>
            </li>;
          })}</ol>
          {queue.length > 8 && <p>Showing the next 8 sources. The remaining {queue.length - 8} stay in the queue.</p>}
          <p>Confirm the inbound lanes and travel direction against the moving video before saving each road zone.</p>
        </details>}
      </div>
      <div className="p-coverage-cities">{regions.map(region => {
        const items = cameras.filter(c => matchesZone(region.name, c.district));
        const responded = items.filter(hasPreviouslyVerifiedVideo).length;
        return <button key={region.name} className={district === region.name ? 'active' : ''} onClick={() => { useProduct.getState().setDistrict(region.name); useProduct.getState().setMapFocus(null); useProduct.getState().navigate('/map'); }}>
          <span><Icon name="pin" size={16} /><b>{region.name}</b><strong>{catalogReady ? items.length : '—'}<span className="p-sr-only"> registered sources</span></strong></span>
          <div className="p-coverage-bar" aria-hidden="true"><i style={{ width: `${items.length ? responded / items.length * 100 : 0}%` }} /></div>
          <small>{catalogReady ? `${responded} video links responded previously · current playback unconfirmed` : catalogFailed ? 'Camera history unavailable · catalog could not be loaded' : 'Loading camera history…'}</small>
          <span className="p-coverage-open">{district === region.name ? 'Selected area · open map' : 'Open city map'}<Icon name="arrow" size={14} /></span>
        </button>;
      })}</div>
    </Panel>
    <Panel title="My cameras" action={<button className="p-text-button" onClick={() => useProduct.getState().navigate('/cameras')}>Explore cameras <Icon name="arrow" size={14} /></button>}>
      {saved.length ? <div className="p-saved-cameras">{saved.slice(0, 4).map(camera => <article key={camera.id}><CameraThumb camera={camera} /><div><b>{camera.district}</b><small>{cameraStatus(camera).label}</small><small>{checkedAt(camera.last_observed_at || camera.verified_at)}</small></div></article>)}</div> : <EmptyState {...savedEmptyState} />}
      {saved.length > 4 && <p className="p-small-note">{saved.length}  cameras saved in this area. Use the favorites filter in the gallery to see them all.</p>}
    </Panel>
  </section>;
}
