import type { Camera } from './types';

export function cameraStatus(camera: Camera) {
  if (camera.status === 'provider_notice') return { label: 'Aviso reciente del proveedor', tone: 'amber' as const, usable: false };
  if (camera.status === 'online') return { label: 'Imagen consultada recientemente', tone: 'green' as const, usable: true };
  if (camera.status === 'stale') return { label: camera.last_source_status === 'provider_notice' ? 'Aviso en la última consulta · abre para actualizar' : 'Consulta anterior · abre para actualizar', tone: 'gray' as const, usable: camera.last_source_status === 'image' };
  if (camera.verification === 'decodable_image') return { label: 'Comprobada al revisar el catálogo', tone: 'gray' as const, usable: true };
  return { label: camera.verification === 'placeholder' ? 'Aviso en la revisión del catálogo' : 'Disponibilidad por comprobar', tone: 'amber' as const, usable: false };
}

export function checkedAt(value?: string | null) {
  if (!value || Number.isNaN(Date.parse(value))) return 'Sin consulta registrada';
  return new Date(value).toLocaleString('es-CO', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
