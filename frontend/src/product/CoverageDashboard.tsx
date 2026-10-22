import { useEffect, useState } from 'react';
import { regions, matchesZone } from './coverage';
import { cameraStatus, checkedAt } from './cameraStatus';
import { CameraThumb } from './CameraThumb';
import { useProduct } from './store';
import { Badge, EmptyState, Icon, Panel } from './ui';
import { apiUrl } from '../api/urls';
import { calibrationCorridorProgress, calibrationPlaybackCoverage, calibrationProgress, calibrationQueue, hasPreviouslyVerifiedVideo, isCurrentlyPlaying, type CameraZoneStatus } from './cameraCalibration';

interface ZoneCoverage extends CameraZoneStatus {
  camera_id: string; status?: string; zone_revision?: number;
}

export function CoverageDashboard() {
  const cameras = useProduct(s => s.cameras);
  const district = useProduct(s => s.district);
  const favorites = useProduct(s => s.favoriteCameras);
  const [zoneCoverage, setZoneCoverage] = useState<ZoneCoverage[] | null>(null);
  const [zoneCoverageError, setZoneCoverageError] = useState('');
  const [loadingCoverage, setLoadingCoverage] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    void fetch(apiUrl('/api/v1/mobility/video/analysis-zones'), { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]) })
      .then(async response => {
        if (!response.ok) throw new Error('Road-zone coverage is temporarily unavailable.');
        return response.json() as Promise<{ cameras: ZoneCoverage[] }>;
      })
      .then(result => { setZoneCoverage(result.cameras); setZoneCoverageError(''); })
      .catch(reason => { if (!controller.signal.aborted) setZoneCoverageError(reason instanceof Error ? reason.message : 'Could not load road-zone coverage.'); })
      .finally(() => { if (!controller.signal.aborted) setLoadingCoverage(false); });
    return () => controller.abort();
  }, []);
  const scoped = cameras.filter(c => matchesZone(district, c.district));
  const scopedVideo = scoped.filter(camera => camera.stream_url);
  const calibration = zoneCoverage ? calibrationProgress(scoped, zoneCoverage) : null;
  const calibratedCount = calibration?.ready ?? 0;
  const queue = zoneCoverage ? calibrationQueue(scopedVideo, zoneCoverage) : [];
  const playbackCoverage = calibrationPlaybackCoverage(queue);
  const corridorProgress = zoneCoverage ? calibrationCorridorProgress(scopedVideo, zoneCoverage) : [];
  const nextCamera = queue[0];
  const coverageTotal = calibration?.total ?? null;
  const linked = scoped.filter(c => c.stream_url).length;
  const saved = scoped.filter(c => favorites.includes(c.id));
  return <section className="p-coverage-dashboard" aria-label="Coverage and saved cameras">
    <Panel title="Coverage by city" action={<Badge tone="green">{cameras.length}  sources</Badge>}>
      <p className="p-small-note">{linked} video sources registered in this area. Playback is checked when you open a camera; sources are not all running in the background.</p>
      <div className="p-road-calibration" aria-label="Road-zone calibration progress">
        <div><div><b>Road analysis calibration</b><span>{loadingCoverage ? 'Loading…' : coverageTotal === null ? 'Unavailable' : `${calibratedCount} of ${coverageTotal} ready`}</span></div>
          <progress max={Math.max(1, coverageTotal || 1)} value={calibratedCount} aria-label="Cameras ready for road analysis" /></div>
        <p>{coverageTotal === null ? 'Camera tracks are not assigned to road conditions until each video source has an inbound road zone and direction.' : `${coverageTotal - calibratedCount} sources still need road-zone review. ${queue.filter(camera => isCurrentlyPlaying(zoneCoverage?.find(item => item.camera_id === camera.id))).length} are decoding fresh video now; ${playbackCoverage.previouslyVerified} pending URLs previously returned HLS 200 and still need live lane review; ${playbackCoverage.playbackCheckRequired} need playback verified before calibration.`}</p>
        {zoneCoverageError && <p role="status" className="p-inline-error">{zoneCoverageError}</p>}
        {nextCamera && (nextCamera.route || nextCamera.direction) && <p>Next source reference: {[nextCamera.route, nextCamera.direction && `${nextCamera.direction}bound`].filter(Boolean).join(' · ')}. Confirm the inbound lanes against moving video before saving.</p>}
        <button className="p-button primary" disabled={!nextCamera || loadingCoverage} onClick={() => nextCamera && useProduct.getState().navigate(`/cameras/${encodeURIComponent(nextCamera.id)}?calibrate=road&queue=1`)}>
          <Icon name="route" />{nextCamera ? `Calibrate next camera · ${nextCamera.name}` : calibratedCount === coverageTotal && coverageTotal !== null ? 'All video sources calibrated' : 'Preparing calibration queue'}
        </button>
        {corridorProgress.length > 0 && <details className="p-road-queue p-corridor-coverage">
          <summary>Directed road coverage · {corridorProgress.reduce((total, item) => total + item.ready, 0)} of {corridorProgress.reduce((total, item) => total + item.total, 0)} cameras ready across {corridorProgress.length} corridors</summary>
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
              <span>{requirement} · {isCurrentlyPlaying(status) ? `Live video verified now · ${status?.playback_session_state}` : hasPreviouslyVerifiedVideo(camera) ? 'HLS URL returned HTTP 200 previously · confirm playback' : 'Verify live video first'}</span></div>
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
          <span><Icon name="pin" size={16} /><b>{region.name}</b><strong>{items.length}</strong></span>
          <div className="p-coverage-bar" aria-hidden="true"><i style={{ width: `${items.length ? responded / items.length * 100 : 0}%` }} /></div>
          <small>{responded} HLS URLs returned HTTP 200 previously · playback unconfirmed</small>
        </button>;
      })}</div>
    </Panel>
    <Panel title="My cameras" action={<button className="p-text-button" onClick={() => useProduct.getState().navigate('/cameras')}>Explore cameras <Icon name="arrow" size={14} /></button>}>
      {saved.length ? <div className="p-saved-cameras">{saved.slice(0, 4).map(camera => <article key={camera.id}><CameraThumb camera={camera} /><div><b>{camera.district}</b><small>{cameraStatus(camera).label}</small><small>{checkedAt(camera.last_observed_at || camera.verified_at)}</small></div></article>)}</div> : <EmptyState title="Your selection, one click away" detail={favorites.length ? "No cameras saved in this area. Change cities to recover your selection." : "Save frequently used cameras from the gallery or evidence view. They will be kept in this browser."} />}
      {saved.length > 4 && <p className="p-small-note">{saved.length}  cameras saved in this area. Use the favorites filter in the gallery to see them all.</p>}
    </Panel>
  </section>;
}
