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
  if (!camera) return <div className="p-photo-empty"><Icon name="camera" /><span>Sin cámara asociada</span></div>;
  const imageUrl = `${camera.image_url}?v=${epoch}`;
  return <button className="p-camera-thumb" onClick={onClick || (() => useProduct.getState().navigate(`/cameras/${camera.id}`))} aria-label={`Abrir ${camera.name}`}>
    {failedUrl !== imageUrl ? <img src={imageUrl} alt={camera.name} loading="lazy" onError={() => setFailedUrl(imageUrl)} /> : <div className="p-photo-empty"><Icon name="camera" />Fuente temporalmente no disponible</div>}
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
      if (!controller.signal.aborted) setError(error instanceof Error ? error.message : 'No se pudo consultar la fuente.');
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
  if (!camera) return <EmptyState title={cameras.length ? 'Cámara no registrada' : 'Cargando inventario de cámaras'} detail={cameras.length ? 'Esta URL no corresponde a una fuente del catálogo.' : 'Se consulta el catálogo de fuentes públicas.'} action={cameras.length ? <button className="p-button" onClick={() => useProduct.getState().navigate('/cameras')}>Ver cámaras</button> : undefined} />;
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
    useProduct.getState().notify('Observación exportada con fuente, hora de consulta y detecciones.');
  };
  return <div className="p-screen p-camera-screen">
    <div className="p-page-heading"><div><span className="p-eyebrow">EVIDENCIA VISUAL</span><h1>{camera.name}</h1><p>{camera.provider} · {camera.district} · {camera.id}</p></div><div className="p-heading-actions"><button className="p-button" aria-pressed={favorites.includes(camera.id)} onClick={() => useProduct.getState().toggleFavorite(camera.id)}><Icon name="star" />{favorites.includes(camera.id) ? 'Guardada en favoritas' : 'Guardar favorita'}</button><Badge tone={error ? 'red' : shown?.source_status === 'provider_notice' ? 'amber' : shown ? 'green' : 'gray'}>{error ? 'Fuente no disponible' : shown?.source_status === 'provider_notice' ? 'Aviso del proveedor' : shown ? 'Imagen consultada' : 'Consultando fuente'}</Badge><button className="p-button" onClick={() => { useProduct.getState().setDistrict(camera.district); useProduct.getState().setMapFocus([camera.lat, camera.lng]); useProduct.getState().navigate('/map'); }}><Icon name="pin" />Ver en mapa</button><button className="p-button" disabled={busy} onClick={() => void refresh()}><Icon name="refresh" />{busy ? 'Analizando…' : 'Actualizar'}</button></div></div>
    <div className="p-camera-layout">
      <div className="p-camera-main">
        <div className="p-camera-stage" ref={stageRef}>
          <div className="p-image-tag"><i />{video ? 'VIDEO PÚBLICO' : archived !== null ? 'OBSERVACIÓN DE SESIÓN' : 'IMAGEN PÚBLICA'}<span>{shown ? `Consultada ${new Date(shown.observed_at).toLocaleTimeString('es-CO')}` : 'Caltrans'}</span></div>
          {video && camera.stream_url ? <PublicVideoPlayer poster={imageUrl} url={camera.stream_url} onUnavailable={videoUnavailable} /> : error && !shown ? <EmptyState title="Esta cámara no responde" detail={error} action={<button className="p-button" onClick={() => void refresh()}>Reintentar</button>} /> : <div className="p-image-stage" style={{ aspectRatio: `${shown?.width || 320}/${shown?.height || 260}` }}><img src={imageUrl} alt={`Imagen pública de ${camera.name}`} onError={() => setError('La imagen está temporalmente fuera de servicio.')} />{filteredDetections.map((d, i) => <div key={`${shown?.frame_id || 'loading'}-${i}`} className="p-detection" style={{ left: `${d.bbox.x * 100}%`, top: `${d.bbox.y * 100}%`, width: `${d.bbox.width * 100}%`, height: `${d.bbox.height * 100}%`, borderColor: classColors[d.className] }}><span style={{ background: classColors[d.className] }}>{classLabels[d.className]} {(d.confidence * 100).toFixed(0)}%</span></div>)}</div>}
          <div className="p-camera-stage-footer"><span><Icon name="shield" size={14} />Sin identificación de personas o matrículas</span><button aria-label="Expandir cámara" onClick={() => void stageRef.current?.requestFullscreen()}><Icon name="expand" /></button></div>
        </div>
        {camera.stream_url && camera.hls_status !== 200 && <p className="p-small-note">El enlace de video es oficial, pero no respondió con una lista válida en la última comprobación. Puedes intentarlo; se usará la imagen si falla.</p>}
        {!camera.stream_url && <p className="p-small-note">Esta fuente ofrece imágenes periódicas. El proveedor no tiene un video disponible en el catálogo; no se simula movimiento entre imágenes.</p>}
        {videoMessage && <p className="p-video-fallback" role="status"><Icon name="info" size={17} />{videoMessage}</p>}
        {error && <p className="p-inline-error" role="alert">{error}</p>}
        <div className="p-camera-tools"><button className="p-button" aria-pressed={watched.includes(camera.id)} onClick={() => useProduct.getState().toggleWatch(camera.id)}><Icon name="grid" />{watched.includes(camera.id) ? 'En mesa de observación' : 'Añadir a mesa'}</button><button className="p-button" onClick={() => setPlaying(!playing)}><Icon name={playing ? 'pause' : 'play'} />{playing ? 'Pausar actualización' : 'Reanudar'}</button><div className="p-segmented"><button className={!video ? 'active' : ''} onClick={() => setVideo(false)}>Imagen + detección</button><button disabled={!camera.stream_url} className={video ? 'active' : ''} onClick={() => { setVideoMessage(''); setVideo(true); }}>{camera.hls_status === 200 ? 'Video público' : 'Intentar video'}</button></div><a className="p-button" href={camera.source_url || 'https://quickmap.dot.ca.gov/'} target="_blank" rel="noreferrer">Fuente oficial <Icon name="arrow" /></a></div>
        {shown && <div className="p-evidence-exports"><a className="p-text-button" href={`${camera.image_url}?frame_id=${shown.frame_id}`} download={`${camera.id}-${shown.frame_id}.jpg`}><Icon name="download" size={14} />Guardar fotograma</a><button className="p-text-button" onClick={exportObservation}><Icon name="report" size={14} />Exportar observación</button><button className="p-text-button" onClick={() => setReview({ id: `OBS-${camera.id}-${shown.frame_id}`, title: 'Revisión de imagen pública', location: camera.name, district: camera.district, type: 'Revisión manual', severity: 'medium', confidence: null, impact: 0, evidence: shown.observed_at, duration: 0, causes: [], lat: camera.lat, lng: camera.lng, action: `Fotograma ${shown.frame_id}, consultado ${shown.observed_at}. Conteo instantáneo; no confirma incidentes.`, owner: 'Operaciones de tráfico', cameraIndex: cameras.findIndex((c) => c.id === camera.id), data_origin: 'observation', evidence_camera_id: camera.id, evidence_frame_id: shown.frame_id })}><Icon name="shield" size={14} />Abrir revisión de evidencia</button>{video && <small>Los conteos corresponden al fotograma analizado, no al video en reproducción.</small>}</div>}
        <Panel title="Objetos en el fotograma" action={<small>Confianza mínima {(threshold * 100).toFixed(0)}%</small>}><div className="p-overlay-options">{Object.keys(classLabels).map((name) => <label key={name}><input type="checkbox" checked={classes.includes(name)} onChange={() => setClasses(classes.includes(name) ? classes.filter((c) => c !== name) : [...classes, name])} /><i style={{ background: classColors[name] }} />{classLabels[name]}</label>)}<input aria-label="Confianza mínima de detecciones" type="range" min=".20" max=".95" step=".05" value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} /></div></Panel>
        <Panel title="Observaciones de esta sesión" action={<Badge tone="gray">{history.length} fotogramas consultados</Badge>}><div className="p-evidence-timeline"><Icon name="clock" /><input aria-label="Elegir observación de cámara" type="range" min="0" max={Math.max(0, history.length - 1)} value={archived === null ? Math.max(0, history.length - 1) : Math.max(0, history.findIndex(item => item.observed_at === archived))} disabled={history.length < 2} onChange={(e) => { setArchived(history[Number(e.target.value)]?.observed_at || null); setPlaying(false); }} /><button className="p-text-button" onClick={() => { setArchived(null); setPlaying(true); }}>Última imagen</button></div><p className="p-small-note">Caltrans actualiza las imágenes aproximadamente cada {camera.refresh_seconds / 60} min. La hora de consulta no acredita la hora de captura. La sesión conserva observaciones en memoria; no existe un archivo histórico del proveedor.</p></Panel>
      </div>
      <aside className="p-camera-insights">
        {(videoMessage || error || !camera.stream_url) && <Panel title="Otros puntos del entorno"><p className="p-small-note">Cámaras con video en el catálogo, ordenadas por distancia. La proximidad no acredita la misma escena ni que el video esté disponible ahora.</p><div className="p-camera-alternatives">{alternatives.map(({ camera: alternative, distanceKm }) => <button key={alternative.id} onClick={() => useProduct.getState().navigate(`/cameras/${alternative.id}`)}><Icon name="camera" /><span><b>{alternative.name}</b><small>{alternative.district} · {distanceKm.toFixed(1)} km aprox.</small></span><Icon name="arrow" size={14} /></button>)}</div><button className="p-text-button" onClick={() => { useProduct.getState().setDistrict('Todos los distritos'); useProduct.getState().navigate(`/explore?q=${encodeURIComponent(camera.route || camera.district)}`); }}>Explorar fuentes en el mapa <Icon name="arrow" size={14} /></button></Panel>}
        <Panel title="Movimiento detectado" action={<Badge tone={counts ? 'green' : 'amber'}>{counts ? `OpenCV · filtro ${(threshold * 100).toFixed(0)}%` : 'Pendiente'}</Badge>}><div className="p-class-counts">{Object.entries(classLabels).map(([name, label]) => <div key={name}><span style={{ color: classColors[name] }}><Icon name={name === 'pedestrian' ? 'walk' : 'car'} size={23} /></span><small>{label}</small><strong>{counts ? counts[name] : '—'}</strong></div>)}</div><p className="p-small-note">{shown?.note || 'Sin conteos disponibles. Consulta el estado de la fuente y de la inferencia.'}</p></Panel>
        <Panel title="Composición de la escena"><div className="p-mix-layout"><div className="p-donut" style={{ background: counts && total ? `conic-gradient(${Object.keys(classLabels).map((name, i, names) => { const start = names.slice(0, i).reduce((sum, n) => sum + counts[n], 0) / total * 100; return `${classColors[name]} ${start}% ${start + counts[name] / total * 100}%`; }).join(',')})` : '#e4eae5' }}><div><b>{total ?? '—'}</b><small>objetos</small></div></div><ul>{Object.entries(classLabels).map(([name, label]) => <li key={name}><i style={{ background: classColors[name] }} />{label}<b>{counts && total ? (counts[name] / total * 100).toFixed(0) + '%' : '—'}</b></li>)}</ul></div></Panel>
        <div className="p-two-metrics"><MetricCard label="Vehículos detectados" value={vehicles ?? '—'} icon="car" note="En este fotograma" /><MetricCard label="Peatones detectados" value={counts?.pedestrian ?? '—'} icon="walk" note="Sin seguimiento personal" /></div>
        <Panel title="Ocupación por carril" action={<Badge tone="amber">{dataMode === 'presentation' ? 'Ejemplo ilustrativo' : 'Sin calibración'}</Badge>}>{dataMode === 'presentation' ? <div className="p-lane-occupancy">{[72, 61, 48, 67].map((base, i) => { const value = Math.round(base * (period === 'Últimos 15 min' ? 1 : period === 'Última hora' ? .9 : .8)); return <div key={i}><span>Carril {i + 1}</span><i><b style={{ width: `${value}%`, background: value > 65 ? '#d0ac61' : '#87a576' }} /></i><strong>{value}%</strong></div>; })}<p className="p-small-note">Estos valores explican el formato de revisión. No se derivan de la imagen pública; requieren definir carriles y calibrar la cámara.</p></div> : <p className="p-small-note">Se necesitan regiones de carril y calibración antes de estimar ocupación real.</p>}</Panel>
        <Panel title="Estado de la fuente"><div className="p-health-rows"><span>Imagen pública<Badge tone={error ? 'red' : shown?.source_status === 'provider_notice' ? 'amber' : shown ? 'green' : 'gray'}>{error ? 'Interrumpida' : shown?.source_status === 'provider_notice' ? 'Aviso del proveedor' : shown ? 'Disponible' : 'Consultando'}</Badge></span><span>Detección<Badge tone={shown?.inference_status === 'ready' ? 'green' : 'amber'}>{shown?.inference_status === 'ready' ? 'Disponible' : 'No disponible'}</Badge></span><span>Velocidad y carriles<b>Sin calibración</b></span><span>Resolución<b>{shown ? `${shown.width} × ${shown.height}` : '—'}</b></span></div>{shown?.inference_error && <p className="p-small-note">{shown.inference_error}</p>}</Panel>
        <Panel title="Conteo por observación">{measuredHistory.length > 1 ? <TrendChart metric="count" height={135} bars data={measuredHistory.map((o) => ({ hour: new Date(o.observed_at).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }), count: Object.values(o.counts || {}).reduce((a, b) => a + b, 0) }))} /> : <p className="p-small-note">Se necesitan dos observaciones con conteos disponibles. Los avisos del proveedor no se convierten en ceros.</p>}</Panel>
      </aside>
    </div>
    {review && <CaseDialog signal={review} onClose={() => setReview(null)} />}
  </div>;
}
