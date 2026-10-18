import { regions, matchesZone } from './coverage';
import { cameraStatus, checkedAt } from './cameraStatus';
import { CameraThumb } from './CameraEvidence';
import { useProduct } from './store';
import { Badge, EmptyState, Icon, Panel } from './ui';

export function CoverageDashboard() {
  const cameras = useProduct(s => s.cameras);
  const district = useProduct(s => s.district);
  const favorites = useProduct(s => s.favoriteCameras);
  const scoped = cameras.filter(c => matchesZone(district, c.district));
  const recent = scoped.filter(c => c.status === 'online').length;
  const saved = scoped.filter(c => favorites.includes(c.id));
  return <section className="p-coverage-dashboard" aria-label="Coverage and saved cameras">
    <Panel title="Coverage by city" action={<Badge tone="green">{cameras.length}  sources</Badge>}>
      <p className="p-small-note">{recent}  images queried recently in this area. Catalog statuses reflect their last review; not all cameras are queried in the background.</p>
      <div className="p-coverage-cities">{regions.map(region => {
        const items = cameras.filter(c => matchesZone(region.name, c.district));
        const checked = items.filter(c => cameraStatus(c).usable).length;
        return <button key={region.name} className={district === region.name ? 'active' : ''} onClick={() => { useProduct.getState().setDistrict(region.name); useProduct.getState().setMapFocus(null); useProduct.getState().navigate('/map'); }}>
          <span><Icon name="pin" size={16} /><b>{region.name}</b><strong>{items.length}</strong></span>
          <div className="p-coverage-bar" aria-hidden="true"><i style={{ width: `${items.length ? checked / items.length * 100 : 0}%` }} /></div>
          <small>{checked}  with an image on their last check · {items.length - checked}  awaiting review</small>
        </button>;
      })}</div>
    </Panel>
    <Panel title="My cameras" action={<button className="p-text-button" onClick={() => useProduct.getState().navigate('/cameras')}>Explore cameras <Icon name="arrow" size={14} /></button>}>
      {saved.length ? <div className="p-saved-cameras">{saved.slice(0, 4).map(camera => <article key={camera.id}><CameraThumb camera={camera} /><div><b>{camera.district}</b><small>{cameraStatus(camera).label}</small><small>{checkedAt(camera.last_observed_at || camera.verified_at)}</small></div></article>)}</div> : <EmptyState title="Your selection, one click away" detail={favorites.length ? "No cameras saved in this area. Change cities to recover your selection." : "Save frequently used cameras from the gallery or evidence view. They will be kept in this browser."} />}
      {saved.length > 4 && <p className="p-small-note">{saved.length}  cameras saved in this area. Use the favorites filter in the gallery to see them all.</p>}
    </Panel>
  </section>;
}
