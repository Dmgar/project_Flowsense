import { useRef, useState } from 'react';
import { CityMap } from './CityMap';
import { LiveCameraPlayer } from './LiveCameraPlayer';
import { openObservedCamera, useProduct } from './store';
import { EmptyState, Icon, Panel } from './ui';
import { observationDeskSelection } from './deskSelection';
import './deskOrientation.css';

export function ObservationDesk() {
  const root = useRef<HTMLDivElement>(null);
  const chooseCameras = useRef<HTMLButtonElement>(null);
  const [selectionNotice, setSelectionNotice] = useState('');
  const cameras = useProduct(s => s.cameras);
  const selected = useProduct(s => s.watchCameras);
  const catalogLoaded = useProduct(s => s.cameraCatalogLoaded);
  const catalogFailed = useProduct(s => s.cameraCatalogFailed);
  const desk = observationDeskSelection(selected, cameras);
  const items = desk.playable;
  const hasSavedSelection = selected.length > 0;
  const remainingSelections = Math.max(0, 4 - selected.length);
  const savedDetailsPending = hasSavedSelection && (!catalogLoaded || catalogFailed);
  const removeSelection = (id: string) => {
    const name = cameras.find(camera => camera.id === id)?.name || id;
    const buttons = [...root.current?.querySelectorAll<HTMLButtonElement>('[data-desk-remove]') || []];
    const removedIndex = buttons.findIndex(button => button.dataset.deskRemove === id);
    useProduct.getState().toggleWatch(id);
    setSelectionNotice(`${name} removed from this desk.`);
    requestAnimationFrame(() => {
      const remaining = [...root.current?.querySelectorAll<HTMLButtonElement>('[data-desk-remove]') || []];
      const next = remaining[Math.min(Math.max(0, removedIndex), remaining.length - 1)] || chooseCameras.current;
      next?.focus({ preventScroll: false });
    });
  };
  return <div ref={root} className="p-screen p-observation-desk"><div className="p-explorer-hero"><div><span className="p-eyebrow">CONTINUOUS VIDEO · MULTIPLE LOCATIONS</span><h1>Observation desk</h1><p>Watch up to four video cameras with vehicle tracking. Available capacity depends on the source and processing hardware.</p></div><button ref={chooseCameras} className="p-button" onClick={() => useProduct.getState().navigate('/explore')}><Icon name="plus" />Choose cameras</button></div>
    <span className="p-sr-only" role="status" aria-live="polite">{selectionNotice}</span>
    <p className="p-small-note" role="status">{savedDetailsPending ? `${selected.length} saved camera ${selected.length === 1 ? 'selection' : 'selections'} · ${catalogFailed ? 'catalog details unavailable' : 'loading source details'}.` : `${selected.length} of 4 saved selections · ${items.length} video ${items.length === 1 ? 'entry' : 'entries'}${remainingSelections === 0 ? '. Remove a selection before adding another.' : ` · ${remainingSelections} selection ${remainingSelections === 1 ? 'space' : 'spaces'} available.`}`}</p>
    {catalogLoaded && !catalogFailed && desk.invalidIds.size > 0 && <div className="p-small-note p-desk-recovery" role="status"><span>{desk.recoveryMessages.join('; ')}. Remove {desk.invalidIds.size === 1 ? 'this camera' : 'these cameras'} from the desk to keep the selection current.</span>{[...desk.invalidIds].map(id => <button data-desk-remove={id} className="p-text-button" key={id} onClick={() => removeSelection(id)}>Remove {cameras.find(camera => camera.id === id)?.name || id}</button>)}</div>}
    {!items.length ? <EmptyState icon={catalogFailed && hasSavedSelection ? 'alert' : 'camera'} title={hasSavedSelection ? catalogFailed ? 'Your saved source details are unavailable' : !catalogLoaded ? 'Finding your saved sources' : 'Review your saved selection' : 'Build your observation desk'} detail={hasSavedSelection ? savedDetailsPending ? 'Your camera choices remain saved in this browser. Open the camera catalog to check the connection and restore their details.' : 'Some saved choices no longer provide a usable video entry. Review the selection above, then choose a source from the catalog.' : 'Choose up to four video sources to keep nearby. Each camera keeps its own timing and evidence context.'} action={<>{!hasSavedSelection && <ol className="p-desk-start-guide"><li><span aria-hidden="true">1</span><div><strong>Find a source</strong><small>Search for a street or browse registered cameras in Explore streets.</small></div></li><li><span aria-hidden="true">2</span><div><strong>Add it to the desk</strong><small>Use Add to desk on the sources you want to compare.</small></div></li><li><span aria-hidden="true">3</span><div><strong>Review independently</strong><small>Check each feed's timing, viewing direction and available evidence.</small></div></li></ol>}<button className="p-button primary" onClick={() => useProduct.getState().navigate(hasSavedSelection ? '/cameras' : '/explore')}>{hasSavedSelection ? 'Open camera catalog' : 'Find cameras for your desk'}<Icon name="arrow" size={15} /></button></>} /> : <>
      <p className="p-small-note">Each source has its own timing and upstream delay. In-video counts describe that scene; do not sum them as regional traffic flow.</p>
      <nav className="p-desk-source-index" aria-label="Jump to a selected camera">{items.length > 1 && items.map((camera, index) => <a key={camera.id} href={`#desk-source-${encodeURIComponent(camera.id)}`}><span aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>{camera.name}<Icon name="arrow" size={14} /></a>)}</nav>
      <div className="p-desk-cameras">{items.map((camera, index) => <article id={`desk-source-${camera.id}`} className="p-desk-card" key={camera.id} tabIndex={-1} aria-label={camera.name}><header><span className="p-desk-index">0{index + 1}</span><div><h2>{camera.name}</h2><small>{camera.district} · {camera.provider || 'Registered source'}</small></div><button data-desk-remove={camera.id} className="p-icon-button" aria-label={`Remove ${camera.name} from the desk`} onClick={() => removeSelection(camera.id)}><Icon name="close" /></button></header>
        <LiveCameraPlayer cameraId={camera.id} name={camera.name} providerOutOfService={camera.provider_in_service === false} sourceUnavailableMessage={camera.video_health?.state === 'unavailable' ? camera.video_health.message : undefined} /><div className="p-desk-card-body"><p><Icon name="clock" size={14} />Independent source timing · compare timestamps before drawing conclusions.</p><button className="p-button" onClick={() => openObservedCamera(camera.id)}>Open camera details <Icon name="arrow" /></button></div>
      </article>)}</div><Panel title="Locations in context"><CityMap forceObserved cameraItems={items} signalItems={[]} compact /></Panel>
    </>}
  </div>;
}
