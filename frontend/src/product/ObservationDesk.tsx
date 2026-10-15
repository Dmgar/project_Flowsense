import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getObservation } from './api';
import { CityMap } from './CityMap';
import { classLabels } from './data';
import { checkedAt } from './cameraStatus';
import { openObservedCamera, useProduct } from './store';
import { Badge, EmptyState, Icon, Panel } from './ui';
import type { Observation } from './types';

interface DeskReading { observation?: Observation; previous?: Observation; error?: string }

function DeskFrame({ src, name }: { src: string; name: string }) {
  const [failed, setFailed] = useState<string | null>(null);
  return failed === src ? <EmptyState title="Fotograma no disponible" detail="La sesión de imágenes pudo vencer. Actualiza la mesa para consultar un nuevo fotograma." /> : <img src={src} alt={`Fotograma consultado de ${name}`} onError={() => setFailed(src)} />;
}

export function ObservationDesk() {
  const cameras = useProduct(s => s.cameras);
  const selected = useProduct(s => s.watchCameras);
  const items = useMemo(() => selected.flatMap(id => cameras.find(camera => camera.id === id) || []), [selected, cameras]);
  const ids = items.map(camera => camera.id).join('|');
  const [readings, setReadings] = useState<Record<string, DeskReading>>({});
  const [auto, setAuto] = useState(false);
  const [busy, setBusy] = useState(false);
  const pending = useRef<AbortController | null>(null);
  const update = useCallback(async () => {
    if (pending.current || !ids) return;
    const controller = new AbortController(); pending.current = controller;
    setBusy(true);
    const queue = ids.split('|');
    const worker = async () => {
      while (queue.length && !controller.signal.aborted) {
        const id = queue.shift()!;
        try {
          const observation = await getObservation(id, controller.signal);
          if (controller.signal.aborted) return;
          setReadings(old => ({ ...old, [id]: { observation, previous: old[id]?.observation?.observed_at !== observation.observed_at ? old[id]?.observation : old[id]?.previous } }));
          useProduct.getState().setCameras(useProduct.getState().cameras.map(camera => camera.id === id ? { ...camera, status: observation.source_status === 'provider_notice' ? 'provider_notice' : 'online', last_source_status: observation.source_status || 'image', last_observed_at: observation.observed_at } : camera));
        } catch (error) {
          if (!controller.signal.aborted) setReadings(old => ({ ...old, [id]: { ...old[id], error: error instanceof Error ? error.message : 'Fuente no disponible' } }));
        }
      }
    };
    try { await Promise.all([worker(), worker()]); }
    finally { if (pending.current === controller) pending.current = null; if (!controller.signal.aborted) setBusy(false); }
  }, [ids]);
  useEffect(() => {
    const start = window.setTimeout(() => { setBusy(false); void update(); }, 0);
    return () => { window.clearTimeout(start); pending.current?.abort(); pending.current = null; };
  }, [update]);
  useEffect(() => {
    if (!auto) return;
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void update(); }, 120000);
    return () => window.clearInterval(timer);
  }, [auto, update]);
  const exportDesk = () => {
    const blob = new Blob([JSON.stringify({ title: 'Mesa de observación FlowSense', exported_at: new Date().toISOString(), note: 'Consultas independientes; no son capturas simultáneas ni aforos acumulables. La hora de consulta no certifica la hora de captura.', cameras: items.map(camera => ({ id: camera.id, name: camera.name, location: { lat: camera.lat, lng: camera.lng }, source_url: camera.source_url, ...readings[camera.id] })) }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob); const link = document.createElement('a');
    link.href = url; link.download = 'flowsense-mesa-observacion.json'; link.click(); URL.revokeObjectURL(url);
  };
  const available = items.filter(camera => readings[camera.id]?.observation?.counts && !readings[camera.id]?.error).length;
  return <div className="p-screen p-observation-desk"><div className="p-explorer-hero"><div><span className="p-eyebrow">VARIOS PUNTOS · UNA REVISIÓN</span><h1>Mesa de observación</h1><p>Contrasta la evidencia de hasta cuatro cámaras antes de atribuir una causa o abrir un caso.</p></div><div className="p-heading-actions"><button className="p-button" onClick={() => useProduct.getState().navigate('/explore')}><Icon name="plus" />Elegir cámaras</button><button className="p-button primary" disabled={busy || !items.length} onClick={() => void update()}><Icon name="refresh" />{busy ? 'Consultando fuentes…' : 'Actualizar mesa'}</button></div></div>
    {!items.length ? <EmptyState title="Empieza por un lugar" detail="Busca una calle o ciudad en el explorador y pulsa Contrastar en las cámaras que quieras revisar juntas." action={<button className="p-button primary" onClick={() => useProduct.getState().navigate('/explore')}>Explorar cámaras <Icon name="arrow" /></button>} /> : <>
    <div className="p-desk-summary"><div><strong>{items.length}<small>puntos elegidos</small></strong><strong>{available}<small>con conteos disponibles</small></strong></div><label><input type="checkbox" checked={auto} onChange={event => setAuto(event.target.checked)} />Actualización cada 2 min</label><button className="p-text-button" onClick={exportDesk}><Icon name="download" />Exportar contraste</button></div>
    <p className="p-small-note">Las consultas son independientes, no simultáneas. Los conteos pertenecen a cada fotograma y no deben sumarse como un aforo regional. La actualización automática se pausa al ocultar la pestaña.</p>
    <div className="p-desk-cameras">{items.map((camera, index) => {
      const reading = readings[camera.id]; const observation = reading?.observation;
      const previous = reading?.previous;
      const vehicles = observation?.counts ? Object.entries(observation.counts).filter(([name]) => name !== 'pedestrian').reduce((sum, [, n]) => sum + n, 0) : null;
      const priorVehicles = previous?.counts ? Object.entries(previous.counts).filter(([name]) => name !== 'pedestrian').reduce((sum, [, n]) => sum + n, 0) : null;
      return <article className="p-desk-card" key={camera.id}><header><span className="p-desk-index">0{index + 1}</span><div><h2>{camera.name}</h2><small>{camera.district}</small></div><button className="p-icon-button" aria-label={`Retirar ${camera.name} de la mesa`} onClick={() => useProduct.getState().toggleWatch(camera.id)}><Icon name="close" /></button></header><div className="p-desk-image">{observation ? <DeskFrame src={`${camera.image_url}?frame_id=${observation.frame_id}`} name={camera.name} /> : <EmptyState title={reading?.error ? 'Sin imagen disponible' : 'Consultando cámara'} detail={reading?.error || 'Se solicita un fotograma y su análisis.'} />}<Badge tone={reading?.error || observation?.source_status === 'provider_notice' ? 'amber' : observation ? 'green' : 'gray'}>{reading?.error ? 'Consulta interrumpida' : observation?.source_status === 'provider_notice' ? 'Aviso del proveedor' : observation ? 'Fotograma consultado' : 'Pendiente'}</Badge></div><div className="p-desk-card-body"><p>Consulta: <b>{checkedAt(observation?.observed_at)}</b></p>{reading?.error && <p className="p-inline-error" role="status">{reading.error} {observation && 'Se conserva la última observación disponible.'}</p>}<div className="p-desk-count"><strong>{vehicles ?? '—'}<small>vehículos en el fotograma</small></strong>{vehicles !== null && priorVehicles !== null && !reading?.error && <span>{vehicles - priorVehicles > 0 ? '+' : ''}{vehicles - priorVehicles} respecto a la consulta anterior</span>}</div><div className="p-desk-classes">{Object.entries(classLabels).map(([name, label]) => <span key={name}>{label}<b>{observation?.counts?.[name] ?? '—'}</b></span>)}</div><button className="p-button" onClick={() => openObservedCamera(camera.id)}>Revisar evidencia <Icon name="arrow" /></button></div></article>;
    })}</div>
    <div className="p-desk-context"><Panel title="Los puntos en contexto"><CityMap forceObserved cameraItems={items} signalItems={[]} compact /></Panel><Panel title="Antes de concluir"><div className="p-insight-list"><div><b>1</b><section><h4>Comprueba la escena</h4><p>Una cámara próxima no confirma cobertura de un cruce. Revisa dirección, visibilidad y avisos del proveedor.</p></section></div><div><b>2</b><section><h4>Contrasta momentos</h4><p>El cambio de conteos refleja dos imágenes consultadas. No demuestra velocidad, cola o duración de una congestión.</p></section></div><div><b>3</b><section><h4>Documenta la revisión</h4><p>Exporta este contraste o abre una revisión desde la cámara. La decisión queda en manos del operador.</p></section></div></div></Panel></div>
    </>}
  </div>;
}
