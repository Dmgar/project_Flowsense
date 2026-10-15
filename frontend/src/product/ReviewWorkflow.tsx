import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { getCases, openCase, reviewCase } from './api';
import { useProduct } from './store';
import { statusLabels } from './data';
import { Icon } from './ui';
import type { ReviewStatus, Signal } from './types';

export function CaseDialog({ signal, onClose }: { signal: Signal; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const cases = useProduct((s) => s.cases);
  const existing = cases.find((c) => c.signal_id === signal.id);
  const [owner, setOwner] = useState(existing?.owner || signal.owner);
  const [note, setNote] = useState('');
  const [target, setTarget] = useState<ReviewStatus>(existing?.status === 'confirmed' ? 'resolved' : existing?.status === 'assigned' ? 'under_review' : 'assigned');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const allowed: Record<ReviewStatus, ReviewStatus[]> = { new: ['assigned', 'under_review', 'dismissed'], assigned: ['under_review', 'confirmed', 'dismissed'], under_review: ['assigned', 'confirmed', 'dismissed'], confirmed: ['resolved'], resolved: [], dismissed: [] };
  useEffect(() => { dialog.current?.showModal(); }, []);
  const save = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const current = existing || await openCase(signal, owner);
      await reviewCase(current.id, target, owner, note);
      useProduct.getState().setCases(await getCases());
      useProduct.getState().notify(`Caso ${current.id}: ${statusLabels[target].toLowerCase()}.`); onClose();
    } catch (error) { setError(error instanceof Error ? error.message : 'No se pudo guardar.'); }
    finally { setBusy(false); }
  };
  return <dialog ref={dialog} className="p-dialog" onCancel={onClose}><form onSubmit={(event) => void save(event)}><header><span className="p-eyebrow">REVISIÓN HUMANA</span><button type="button" className="p-icon-button" aria-label="Cerrar revisión" onClick={onClose}><Icon name="close" /></button><h2>{existing?.id || 'Abrir un caso'}</h2><p>{signal.title} · {signal.location}</p></header><label>Equipo responsable<select value={owner} onChange={(e) => setOwner(e.target.value)}>{['Operaciones de tráfico', 'Carga y espacio vial', 'Seguridad vial', 'Equipo de campo', 'Operación de señales', 'Movilidad colectiva'].map((team) => <option key={team}>{team}</option>)}</select></label><label>Siguiente estado<select value={target} onChange={(e) => setTarget(e.target.value as ReviewStatus)}>{allowed[existing?.status || 'new'].map((value) => <option key={value} value={value}>{statusLabels[value]}</option>)}</select></label><label>Observación de la revisión<textarea autoFocus required minLength={3} maxLength={2000} rows={3} placeholder="Describe qué revisaste y por qué tomas esta decisión." value={note} onChange={(e) => setNote(e.target.value)} /></label><p className="p-small-note">{signal.data_origin === 'observation' ? 'Revisión manual de una observación de cámara. La detección de objetos no confirma un incidente.' : 'Este caso pertenece al escenario de presentación.'} La confirmación documenta la revisión; no controla semáforos ni despacha unidades.</p>{existing?.audit.length ? <div className="p-audit"><b>Bitácora del caso</b>{existing.audit.map((item, index) => <div key={index}><span>{statusLabels[item.action] || item.action} · {item.owner}</span><small>{new Date(item.at).toLocaleString('es-CO')} · {item.note}</small></div>)}</div> : null}{error && <p className="p-inline-error" role="alert">{error}</p>}<footer><button type="button" className="p-button" onClick={onClose}>Cancelar</button><button className="p-button primary" disabled={busy || !allowed[existing?.status || 'new'].length}>{busy ? 'Guardando…' : 'Guardar revisión'}<Icon name="check" /></button></footer></form></dialog>;
}
