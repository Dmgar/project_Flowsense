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
  return <section className="p-coverage-dashboard" aria-label="Cobertura y cámaras guardadas">
    <Panel title="Cobertura por ciudad" action={<Badge tone="green">{cameras.length} fuentes</Badge>}>
      <p className="p-small-note">{recent} imágenes consultadas recientemente en esta zona. Los estados del catálogo corresponden a su última revisión; no se consultan todas las cámaras en segundo plano.</p>
      <div className="p-coverage-cities">{regions.map(region => {
        const items = cameras.filter(c => matchesZone(region.name, c.district));
        const checked = items.filter(c => cameraStatus(c).usable).length;
        return <button key={region.name} className={district === region.name ? 'active' : ''} onClick={() => { useProduct.getState().setDistrict(region.name); useProduct.getState().setMapFocus(null); useProduct.getState().navigate('/map'); }}>
          <span><Icon name="pin" size={16} /><b>{region.name}</b><strong>{items.length}</strong></span>
          <div className="p-coverage-bar" aria-hidden="true"><i style={{ width: `${items.length ? checked / items.length * 100 : 0}%` }} /></div>
          <small>{checked} con imagen en su última comprobación · {items.length - checked} por revisar</small>
        </button>;
      })}</div>
    </Panel>
    <Panel title="Mis cámaras" action={<button className="p-text-button" onClick={() => useProduct.getState().navigate('/cameras')}>Explorar cámaras <Icon name="arrow" size={14} /></button>}>
      {saved.length ? <div className="p-saved-cameras">{saved.slice(0, 4).map(camera => <article key={camera.id}><CameraThumb camera={camera} /><div><b>{camera.district}</b><small>{cameraStatus(camera).label}</small><small>{checkedAt(camera.last_observed_at || camera.verified_at)}</small></div></article>)}</div> : <EmptyState title="Tu selección, a un clic" detail={favorites.length ? 'No hay cámaras guardadas en esta zona. Cambia de ciudad para recuperar tu selección.' : 'Guarda las cámaras que consultas con frecuencia desde la galería o la evidencia. Se conservarán en este navegador.'} />}
      {saved.length > 4 && <p className="p-small-note">{saved.length} cámaras guardadas en esta zona. Consulta la galería con el filtro de favoritas para verlas todas.</p>}
    </Panel>
  </section>;
}
