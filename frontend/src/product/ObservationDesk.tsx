import { CityMap } from './CityMap';
import { LiveCameraPlayer } from './LiveCameraPlayer';
import { openObservedCamera, useProduct } from './store';
import { EmptyState, Icon, Panel } from './ui';

export function ObservationDesk() {
  const cameras = useProduct(s => s.cameras);
  const selected = useProduct(s => s.watchCameras);
  const items = selected.flatMap(id => cameras.find(camera => camera.id === id && camera.stream_url) || []);
  const unsupported = selected.filter(id => !cameras.some(camera => camera.id === id && camera.stream_url));
  return <div className="p-screen p-observation-desk"><div className="p-explorer-hero"><div><span className="p-eyebrow">CONTINUOUS VIDEO · MULTIPLE LOCATIONS</span><h1>Observation desk</h1><p>Watch up to four video cameras with vehicle tracking. Available capacity depends on the source and processing hardware.</p></div><button className="p-button" onClick={() => useProduct.getState().navigate('/explore')}><Icon name="plus" />Choose cameras</button></div>
    {unsupported.length > 0 && <div className="p-small-note">Some saved cameras do not provide video or are no longer registered. {unsupported.map(id => <button className="p-text-button" key={id} onClick={() => useProduct.getState().toggleWatch(id)}>Remove {id}</button>)}</div>}
    {!items.length ? <EmptyState title="Choose a video camera" detail="Open the explorer and add video cameras to your observation desk." action={<button className="p-button primary" onClick={() => useProduct.getState().navigate('/explore')}>Explore cameras</button>} /> : <>
      <p className="p-small-note">Each source has its own timing and upstream delay. In-video counts describe that scene; do not sum them as regional traffic flow.</p>
      <div className="p-desk-cameras">{items.map((camera, index) => <article className="p-desk-card" key={camera.id}><header><span className="p-desk-index">0{index + 1}</span><div><h2>{camera.name}</h2><small>{camera.district}</small></div><button className="p-icon-button" aria-label={`Remove ${camera.name} from the desk`} onClick={() => useProduct.getState().toggleWatch(camera.id)}><Icon name="close" /></button></header>
        <LiveCameraPlayer cameraId={camera.id} name={camera.name} providerOutOfService={camera.provider_in_service === false} sourceUnavailableMessage={camera.video_health?.state === 'unavailable' ? camera.video_health.message : undefined} /><div className="p-desk-card-body"><button className="p-button" onClick={() => openObservedCamera(camera.id)}>Open camera details <Icon name="arrow" /></button></div>
      </article>)}</div><Panel title="Locations in context"><CityMap forceObserved cameraItems={items} signalItems={[]} compact /></Panel>
    </>}
  </div>;
}
