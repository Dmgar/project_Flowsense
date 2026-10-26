import { useState } from 'react';
import type { MobilityCase } from './types';
import { useProduct } from './store';
import { statusLabels } from './data';
import { Icon, Panel, ReviewBadge } from './ui';
import './reportAuditPreview.css';

function AuditTimestamp({ value }: { value: string }) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return <span className="p-report-audit-timestamp"><span>Recorded timestamp</span><code>{value || 'Not supplied'}</code></span>;
  return <span className="p-report-audit-timestamp"><time dateTime={value}>{date.toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short' })}</time><code aria-label={`Original recorded timestamp: ${value}`}>{value}</code></span>;
}

function CaseAudit({ item }: { item: MobilityCase }) {
  const [open, setOpen] = useState(false);
  return <details className="p-report-audit-case" onToggle={event => setOpen(event.currentTarget.open)}><summary><Icon name="report" size={16} /><span><b>{item.id} · {item.title}</b><small>{item.audit.length} {item.audit.length === 1 ? 'audit entry' : 'audit entries'} · {item.data_origin === 'presentation' ? 'Illustrative scenario' : 'Observation'}</small></span><ReviewBadge value={item.status} /><span className="p-report-audit-disclosure" aria-hidden="true"><Icon name="plus" size={16} /></span></summary>{open && <div className="p-report-audit-content" role="region" aria-label={`Audit entries for ${item.id}`} tabIndex={0}>{item.audit.length ? <ol>{item.audit.map((entry, index) => <li key={`${entry.at}-${index}`}><div><strong>{statusLabels[entry.action] || entry.action}</strong><AuditTimestamp value={entry.at} /></div><p className="p-report-audit-owner">Recorded responsible team: {entry.owner || 'Not supplied'}</p>{entry.note && <p>{entry.note}</p>}</li>)}</ol> : <p>No audit entries are included in this loaded case.</p>}</div>}</details>;
}

export function ReportAuditPreview({ cases }: { cases: MobilityCase[] }) {
  const freshness = useProduct(state => state.casesLoadStatus);
  return <Panel title="Audit history preview">{freshness !== 'ready' && <p className="p-report-audit-freshness" role="status">{freshness === 'error' ? 'The refresh failed. This is the last loaded audit history and may be out of date.' : 'Refreshing the case record. This preview still shows the last loaded audit history.'}</p>}<p className="p-report-audit-intro">Open a case to inspect the loaded decision history before exporting. Readable dates use your device time zone; each original timestamp is also shown unchanged. Team labels describe responsibility; they do not independently verify an individual identity.</p><div className="p-report-audit-list">{cases.map(item => <CaseAudit key={item.id} item={item} />)}</div></Panel>;
}
