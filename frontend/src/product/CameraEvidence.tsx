import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PublicVideoPlayer } from './PublicVideoPlayer';
import { nearbyCameraOptions } from './evidenceSearch';
import { cameraStatus } from './cameraStatus';
import { classColors, classLabels } from './data';
import { getHistory, getObservation } from './api';
import { useProduct } from './store';
import { Badge, EmptyState, Icon, MetricCard, Panel, TrendChart } from './ui';
import type { Camera, Observation } from './types';
import type { Signal } from './types';
import { CaseDialog } from './ReviewWorkflow';

export function CameraThumb({ camera, onClick }: { camera?: Camera; onClick?: () => void }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const [epoch, setEpoch] = useState(0);
  const refreshSeconds = camera?.refresh_seconds || 120;
  useEffect(() => {
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') setEpoch((value) => value + 1); }, refreshSeconds * 1000);
    return () => window.clearInterval(timer);
  }, [refreshSeconds]);
  if (!camera) return <div className="p-photo-empty"><Icon name="camera" /><span>No associated camera</span></div>;
  const imageUrl = `${camera.image_url}?v=${epoch}`;
  return <button className="p-camera-thumb" onClick={onClick || (() => useProduct.getState().navigate(`/cameras/${camera.id}`))} aria-label={`Open ${camera.name}`}>
    {failedUrl !== imageUrl ? <img src={imageUrl} alt={camera.name} loading="lazy" onError={() => setFailedUrl(imageUrl)} /> : <div className="p-photo-empty"><Icon name="camera" />Source temporarily unavailable</div>}
    <span><Icon name="camera" size={13} />{camera.name.replace('I-110 : ', '').replace('I-10 : ', '')}</span>
  </button>;
}

export function CameraEvidence({ cameraId }: { cameraId?: string }) {
  const cameras = useProduct((s) => s.cameras);
  const dataMode = useProduct((s) => s.mode);
  const favorites = useProduct((s) => s.favoriteCameras);
  const period = useProduct((s) => s.period);
  const camera = cameraId ? cameras.find((c) => c.id === cameraId) : cameras[0];
  const alternatives = useMemo(() => camera ? nearbyCameraOptions(cameras.filter(item => cameraStatus(item).usable), camera) : [], [camera, cameras]);
  const activeCameraId = camera?.id;
  const refreshSeconds = camera?.refresh_seconds || 120;
  const [observation, setObservation] = useState<Observation | null>(null);
  const [history, setHistory] = useState<Observation[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [playing, setPlaying] = useState(true);
  const [video, setVideo] = useState(false);
  const [videoMessage, setVideoMessage] = useState('');
  const watched = useProduct(s => s.watchCameras);
  const [archived, setArchived] = useState<string | null>(null);
  const [classes, setClasses] = useState(Object.keys(classLabels));
  const [threshold, setThreshold] = useState(.35);
  const [review, setReview] = useState<Signal | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const pending = useRef<AbortController | null>(null);
  const videoUnavailable = useCallback((reason: string) => { setVideo(false); setVideoMessage(reason); }, []);
  const refresh = useCallback(async () => {
    if (!activeCameraId || pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    try {
      const next = await getObservation(activeCameraId, controller.signal);
      if (controller.signal.aborted) return;
      setObservation(next); setError('');
      useProduct.getState().setCameras(useProduct.getState().cameras.map((c) => c.id === activeCameraId ? { ...c, status: next.source_status === 'provider_notice' ? 'provider_notice' : 'online', last_source_status: next.source_status || 'image', last_observed_at: next.observed_at } : c));
      const observations = await getHistory(activeCameraId, controller.signal);
      if (!controller.signal.aborted) setHistory(observations);
    } catch (error) {
      if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Could not query the source.");
    } finally {
      if (pending.current === controller) pending.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }, [activeCameraId]);
  useEffect(() => {
    const start = window.setTimeout(() => void refresh(), 0);
    return () => { window.clearTimeout(start); pending.current?.abort(); pending.current = null; };
  }, [refresh]);
  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, refreshSeconds * 1000);
    return () => window.clearInterval(timer);
  }, [playing, refresh, refreshSeconds]);
  if (!camera) return <EmptyState title={cameras.length ? "Camera not registered" : "Loading camera inventory"} detail={cameras.length ? "This URL does not match a source in the catalog." : "Querying the public source catalog."} action={cameras.length ? <button className="p-button" onClick={() => useProduct.getState().navigate('/cameras')}>View cameras</button> : undefined} />;
  const shown = archived === null ? observation : history.find(item => item.observed_at === archived);
  const filteredDetections = shown?.detections.filter((d) => classes.includes(d.className) && d.confidence >= threshold) || [];
  const counts = shown?.counts ? Object.fromEntries(Object.keys(classLabels).map((name) => [name, filteredDetections.filter((d) => d.className === name).length])) : null;
  const measuredHistory = history.filter(o => o.counts !== null);
  const total = counts ? Object.values(counts).reduce((a, b) => a + b, 0) : null;
  const vehicles = counts ? Object.entries(counts).filter(([name]) => name !== 'pedestrian').reduce((a, [, count]) => a + count, 0) : null;
  const imageUrl = `${camera.image_url}?${shown ? `frame_id=${shown.frame_id}` : 'v=current'}`;
  const exportObservation = () => {
    if (!shown) return;
    const blob = new Blob([JSON.stringify({ source: camera.provider, source_url: camera.source_url, view_filters: { classes, confidence_threshold: threshold }, ...shown }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob); const link = document.createElement('a');
    link.href = url; link.download = `flowsense-${camera.id}-${shown.frame_id}.json`; link.click(); URL.revokeObjectURL(url);
    useProduct.getState().notify("Observation exported with its source, query time and detections.");
  };
  return <div className="p-screen p-camera-screen">
    <div className="p-page-heading"><div><span className="p-eyebrow">VISUAL EVIDENCE</span><h1>{camera.name}</h1><p>{camera.provider} · {camera.district} · {camera.id}</p></div><div className="p-heading-actions"><button className="p-button" aria-pressed={favorites.includes(camera.id)} onClick={() => useProduct.getState().toggleFavorite(camera.id)}><Icon name="star" />{favorites.includes(camera.id) ? "Saved to favorites" : "Save favorite"}</button><Badge tone={error ? 'red' : shown?.source_status === 'provider_notice' ? 'amber' : shown ? 'green' : 'gray'}>{error ? "Source unavailable" : shown?.source_status === 'provider_notice' ? "Provider notice" : shown ? "Image retrieved" : "Querying source"}</Badge><button className="p-button" onClick={() => { useProduct.getState().setDistrict(camera.district); useProduct.getState().setMapFocus([camera.lat, camera.lng]); useProduct.getState().navigate('/map'); }}><Icon name="pin" />View on map</button><button className="p-button" disabled={busy} onClick={() => void refresh()}><Icon name="refresh" />{busy ? "Analyzing…" : "Refresh"}</button></div></div>
    <div className="p-camera-layout">
      <div className="p-camera-main">
        <div className="p-camera-stage" ref={stageRef}>
          <div className="p-image-tag"><i />{video ? "PUBLIC VIDEO" : archived !== null ? "SESSION OBSERVATION" : "PUBLIC IMAGE"}<span>{shown ? `Queried ${new Date(shown.observed_at).toLocaleTimeString("en-US")}` : 'Caltrans'}</span></div>
          {video && camera.stream_url ? <PublicVideoPlayer poster={imageUrl} url={camera.stream_url} onUnavailable={videoUnavailable} /> : error && !shown ? <EmptyState title="This camera is not responding" detail={error} action={<button className="p-button" onClick={() => void refresh()}>Retry</button>} /> : <div className="p-image-stage" style={{ aspectRatio: `${shown?.width || 320}/${shown?.height || 260}` }}><img src={imageUrl} alt={`Public image from ${camera.name}`} onError={() => setError("The image is temporarily unavailable.")} />{filteredDetections.map((d, i) => <div key={`${shown?.frame_id || 'loading'}-${i}`} className="p-detection" style={{ left: `${d.bbox.x * 100}%`, top: `${d.bbox.y * 100}%`, width: `${d.bbox.width * 100}%`, height: `${d.bbox.height * 100}%`, borderColor: classColors[d.className] }}><span style={{ background: classColors[d.className] }}>{classLabels[d.className]} {(d.confidence * 100).toFixed(0)}%</span></div>)}</div>}
          <div className="p-camera-stage-footer"><span><Icon name="shield" size={14} />No identification of people or license plates</span><button aria-label="Expand camera" onClick={() => { const stage = stageRef.current; if (!stage?.requestFullscreen) { useProduct.getState().notify("Full-screen viewing is unavailable in this browser."); return; } void stage.requestFullscreen().catch(() => useProduct.getState().notify("Could not open full-screen viewing. Try expanding the browser window.")); }}><Icon name="expand" /></button></div>
        </div>
        {camera.stream_url && camera.hls_status !== 200 && <p className="p-small-note">The official video link did not return a valid playlist in the last check. You can try it; the image will be used if it fails.</p>}
        {!camera.stream_url && <p className="p-small-note">This source provides periodic images. The provider has no video in the catalog; movement between images is not simulated.</p>}
        {videoMessage && <p className="p-video-fallback" role="status"><Icon name="info" size={17} />{videoMessage}</p>}
        {error && <p className="p-inline-error" role="alert">{error}</p>}
        <div className="p-camera-tools"><button className="p-button" aria-pressed={watched.includes(camera.id)} onClick={() => useProduct.getState().toggleWatch(camera.id)}><Icon name="grid" />{watched.includes(camera.id) ? "On the observation desk" : "Add to desk"}</button><button className="p-button" onClick={() => setPlaying(!playing)}><Icon name={playing ? 'pause' : 'play'} />{playing ? "Pause updates" : "Resume"}</button><div className="p-segmented"><button className={!video ? 'active' : ''} onClick={() => setVideo(false)}>Image + detection</button><button disabled={!camera.stream_url} className={video ? 'active' : ''} onClick={() => { setVideoMessage(''); setVideo(true); }}>{camera.hls_status === 200 ? "Public video" : "Try video"}</button></div><a className="p-button" href={camera.source_url || 'https://quickmap.dot.ca.gov/'} target="_blank" rel="noreferrer">Official source <Icon name="arrow" /></a></div>
        {shown && <div className="p-evidence-exports"><a className="p-text-button" href={`${camera.image_url}?frame_id=${shown.frame_id}`} download={`${camera.id}-${shown.frame_id}.jpg`}><Icon name="download" size={14} />Save frame</a><button className="p-text-button" onClick={exportObservation}><Icon name="report" size={14} />Export observation</button><button className="p-text-button" onClick={() => setReview({ id: `OBS-${camera.id}-${shown.frame_id}`, title: "Public image review", location: camera.name, district: camera.district, type: "Manual review", severity: 'medium', confidence: null, impact: 0, evidence: shown.observed_at, duration: 0, causes: [], lat: camera.lat, lng: camera.lng, action: `Frame ${shown.frame_id}, queried ${shown.observed_at}. Instantaneous count; does not confirm incidents.`, owner: "Traffic operations", cameraIndex: cameras.findIndex((c) => c.id === camera.id), data_origin: 'observation', evidence_camera_id: camera.id, evidence_frame_id: shown.frame_id })}><Icon name="shield" size={14} />Open evidence review</button>{video && <small>Counts refer to the analyzed frame, not the video being played.</small>}</div>}
        <Panel title="Objects in the frame" action={<small>Minimum confidence {(threshold * 100).toFixed(0)}%</small>}><div className="p-overlay-options">{Object.keys(classLabels).map((name) => <label key={name}><input type="checkbox" checked={classes.includes(name)} onChange={() => setClasses(classes.includes(name) ? classes.filter((c) => c !== name) : [...classes, name])} /><i style={{ background: classColors[name] }} />{classLabels[name]}</label>)}<input aria-label="Minimum detection confidence" type="range" min=".20" max=".95" step=".05" value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} /></div></Panel>
        <Panel title="Observations in this session" action={<Badge tone="gray">{history.length}  frames queried</Badge>}><div className="p-evidence-timeline"><Icon name="clock" /><input aria-label="Choose a camera observation" type="range" min="0" max={Math.max(0, history.length - 1)} value={archived === null ? Math.max(0, history.length - 1) : Math.max(0, history.findIndex(item => item.observed_at === archived))} disabled={history.length < 2} onChange={(e) => { setArchived(history[Number(e.target.value)]?.observed_at || null); setPlaying(false); }} /><button className="p-text-button" onClick={() => { setArchived(null); setPlaying(true); }}>Latest image</button></div><p className="p-small-note">Caltrans updates images approximately every {camera.refresh_seconds / 60}  min. Query time does not establish capture time. The session keeps observations in memory; no provider historical archive is available.</p></Panel>
      </div>
      <aside className="p-camera-insights">
        {(videoMessage || error || !camera.stream_url) && <Panel title="Other nearby locations"><p className="p-small-note">Catalog cameras with video, sorted by distance. Proximity does not establish the same scene or current video availability.</p><div className="p-camera-alternatives">{alternatives.map(({ camera: alternative, distanceKm }) => <button key={alternative.id} onClick={() => useProduct.getState().navigate(`/cameras/${alternative.id}`)}><Icon name="camera" /><span><b>{alternative.name}</b><small>{alternative.district} · {distanceKm.toFixed(1)}  km approx.</small></span><Icon name="arrow" size={14} /></button>)}</div><button className="p-text-button" onClick={() => { useProduct.getState().setDistrict("All districts"); useProduct.getState().navigate(`/explore?q=${encodeURIComponent(camera.route || camera.district)}`); }}>Explore sources on the map <Icon name="arrow" size={14} /></button></Panel>}
        <Panel title="Detected movement" action={<Badge tone={counts ? 'green' : 'amber'}>{counts ? `OpenCV · filter ${(threshold * 100).toFixed(0)}%` : "Pending"}</Badge>}><div className="p-class-counts">{Object.entries(classLabels).map(([name, label]) => <div key={name}><span style={{ color: classColors[name] }}><Icon name={name === 'pedestrian' ? 'walk' : 'car'} size={23} /></span><small>{label}</small><strong>{counts ? counts[name] : '—'}</strong></div>)}</div><p className="p-small-note">{shown?.note || "No counts available. Check the source and inference status."}</p></Panel>
        <Panel title="Scene composition"><div className="p-mix-layout"><div className="p-donut" style={{ background: counts && total ? `conic-gradient(${Object.keys(classLabels).map((name, i, names) => { const start = names.slice(0, i).reduce((sum, n) => sum + counts[n], 0) / total * 100; return `${classColors[name]} ${start}% ${start + counts[name] / total * 100}%`; }).join(',')})` : '#e4eae5' }}><div><b>{total ?? '—'}</b><small>objects</small></div></div><ul>{Object.entries(classLabels).map(([name, label]) => <li key={name}><i style={{ background: classColors[name] }} />{label}<b>{counts && total ? (counts[name] / total * 100).toFixed(0) + '%' : '—'}</b></li>)}</ul></div></Panel>
        <div className="p-two-metrics"><MetricCard label="Vehicles detected" value={vehicles ?? '—'} icon="car" note="In this frame" /><MetricCard label="Pedestrians detected" value={counts?.pedestrian ?? '—'} icon="walk" note="No personal tracking" /></div>
        <Panel title="Lane occupancy" action={<Badge tone="amber">{dataMode === 'presentation' ? "Illustrative example" : "Not calibrated"}</Badge>}>{dataMode === 'presentation' ? <div className="p-lane-occupancy">{[72, 61, 48, 67].map((base, i) => { const value = Math.round(base * (period === "Last 15 min" ? 1 : period === "Last hour" ? .9 : .8)); return <div key={i}><span>Lane {i + 1}</span><i><b style={{ width: `${value}%`, background: value > 65 ? '#d0ac61' : '#87a576' }} /></i><strong>{value}%</strong></div>; })}<p className="p-small-note">These values explain the review format. They are not derived from the public image; lane definitions and camera calibration are required.</p></div> : <p className="p-small-note">Lane regions and calibration are required before estimating actual occupancy.</p>}</Panel>
        <Panel title="Source status"><div className="p-health-rows"><span>Public image<Badge tone={error ? 'red' : shown?.source_status === 'provider_notice' ? 'amber' : shown ? 'green' : 'gray'}>{error ? "Interrupted" : shown?.source_status === 'provider_notice' ? "Provider notice" : shown ? "Available" : "Querying"}</Badge></span><span>Detection<Badge tone={shown?.inference_status === 'ready' ? 'green' : 'amber'}>{shown?.inference_status === 'ready' ? "Available" : "Unavailable"}</Badge></span><span>Speed and lanes<b>Not calibrated</b></span><span>Resolution<b>{shown ? `${shown.width} × ${shown.height}` : '—'}</b></span></div>{shown?.inference_error && <p className="p-small-note">{shown.inference_error}</p>}</Panel>
        <Panel title="Count per observation">{measuredHistory.length > 1 ? <TrendChart metric="count" height={135} bars data={measuredHistory.map((o) => ({ hour: new Date(o.observed_at).toLocaleTimeString("en-US", { hour: '2-digit', minute: '2-digit' }), count: Object.values(o.counts || {}).reduce((a, b) => a + b, 0) }))} /> : <p className="p-small-note">Two observations with available counts are required. Provider notices are not converted to zeros.</p>}</Panel>
      </aside>
    </div>
    {review && <CaseDialog signal={review} onClose={() => setReview(null)} />}
  </div>;
}
