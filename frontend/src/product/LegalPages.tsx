import terms from '../legal/TERMS_OF_SERVICE.md?raw';
import privacy from '../legal/PRIVACY_NOTICE.md?raw';
import cookies from '../legal/COOKIE_NOTICE.md?raw';
import refunds from '../legal/REFUND_POLICY.md?raw';
import review from '../legal/IMPLEMENTATION_REVIEW.md?raw';
import { useId, useState } from 'react';
import type { ChangeEvent } from 'react';
import { Icon } from './ui';
import './legalReading.css';

export type PolicyForm = 'camera_connection' | 'case_review' | 'emergency_corridor';

export function PolicyAcceptanceFields({
  formType, operatorReference, onOperatorReference, termsAccepted, onTermsAccepted,
  privacyAcknowledged, onPrivacyAcknowledged, disabled = false,
}: {
  formType: PolicyForm; operatorReference: string; onOperatorReference: (value: string) => void;
  termsAccepted: boolean; onTermsAccepted: (value: boolean) => void;
  privacyAcknowledged: boolean; onPrivacyAcknowledged: (value: boolean) => void;
  disabled?: boolean;
}) {
  const fieldPrefix = useId();
  const missing = [
    operatorReference.trim().length < 2 ? 'an operator reference' : '',
    !termsAccepted ? 'the Terms and Conditions choice' : '',
    !privacyAcknowledged ? 'the Privacy Notice choice' : '',
  ].filter(Boolean);
  const action = formType === 'camera_connection' ? 'connect this camera' : formType === 'case_review' ? 'save this review' : 'calculate this corridor';
  return <fieldset className="p-policy-acceptance" disabled={disabled}>
    <legend>Policy choices and audit record</legend>
    <p id={`${fieldPrefix}-requirements`} className="p-policy-requirements">Required: an operator reference and both choices below. Document links open in a new tab so you can keep this form open.</p>
    <label className="p-operator-reference">Operator reference<input required minLength={2} maxLength={120} autoComplete="off" value={operatorReference} onChange={event => onOperatorReference(event.target.value)} placeholder="Staff ID or work handle" aria-describedby={`${fieldPrefix}-identity-note ${fieldPrefix}-requirements`} /><small id={`${fieldPrefix}-identity-note`}>Use a staff ID or work handle where available. Do not enter personal contact details. This reference is self-reported; FlowSense does not verify your identity.</small></label>
    <label className="p-policy-choice"><input type="checkbox" required aria-describedby={`${fieldPrefix}-requirements`} checked={termsAccepted} onChange={(event: ChangeEvent<HTMLInputElement>) => onTermsAccepted(event.target.checked)} /><span>I agree to the <a href="/legal/terms" target="_blank" rel="noreferrer" aria-label="Terms and Conditions, opens in a new tab">Terms and Conditions</a>.</span></label>
    <label className="p-policy-choice"><input type="checkbox" required aria-describedby={`${fieldPrefix}-requirements`} checked={privacyAcknowledged} onChange={(event: ChangeEvent<HTMLInputElement>) => onPrivacyAcknowledged(event.target.checked)} /><span>I acknowledge the <a href="/legal/privacy" target="_blank" rel="noreferrer" aria-label="Privacy Notice, opens in a new tab">Privacy Notice</a>.</span></label>
    <small>Each choice is recorded separately with the policy versions, document hashes, submission time, and this form type.</small>
    {missing.length > 0 && <p className="p-policy-pending" role="status">To {action}, complete: {missing.join('; ')}.</p>}
  </fieldset>;
}

const documents: Record<string, { title: string; eyebrow: string; content: string }> = {
  terms: { title: 'Terms and Conditions', eyebrow: 'LEGAL · VERSION 2026-10-24', content: terms },
  privacy: { title: 'Privacy Notice', eyebrow: 'PRIVACY · VERSION 2026-10-24', content: privacy },
  cookies: { title: 'Cookie and Local Storage Notice', eyebrow: 'PRIVACY · VERSION 2026-10-24', content: cookies },
  refunds: { title: 'Refund Policy', eyebrow: 'BILLING · VERSION 2026-10-24', content: refunds },
};

function inline(text: string) {
  const tokens = text.split(/(\[[^\]]+\]\([^)]+\)|\*\*[^*]+\*\*)/g);
  return tokens.map((token, index) => {
    const link = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (link) return <a key={index} href={link[2]} target={link[2].startsWith('http') ? '_blank' : undefined} rel={link[2].startsWith('http') ? 'noreferrer' : undefined}>{link[1]}</a>;
    const bold = token.match(/^\*\*(.+)\*\*$/);
    return bold ? <strong key={index}>{bold[1]}</strong> : token;
  });
}

function documentSections(content: string, idPrefix: string) {
  let inCodeBlock = false;
  return content.split(/\r?\n/).flatMap((line, index) => {
    if (line.startsWith('```')) { inCodeBlock = !inCodeBlock; return []; }
    if (inCodeBlock) return [];
    const heading = line.match(/^(#{2,3})\s+(.+)$/);
    return heading ? [{ id: `${idPrefix}-section-${index}`, title: heading[2].replace(/\*\*/g, ''), subsection: heading[1].length === 3 }] : [];
  });
}

function LegalContents({ content, idPrefix, title }: { content: string; idPrefix: string; title: string }) {
  const [open, setOpen] = useState(() => window.matchMedia('(min-width: 1001px)').matches);
  const sections = documentSections(content, idPrefix);
  if (!sections.length) return null;
  return <aside className="p-legal-reading-index"><details className="p-legal-contents" open={open} onToggle={event => setOpen(event.currentTarget.open)}><summary><Icon name="report" size={16} /><span>On this page<small>{sections.length} sections</small></span><Icon name="plus" size={15} /></summary><nav aria-label={`${title} sections`}>{sections.map(section => <a key={section.id} className={section.subsection ? 'subsection' : undefined} href={`#${section.id}`}>{section.title}</a>)}</nav></details></aside>;
}

function Markdown({ content, idPrefix = 'legal' }: { content: string; idPrefix?: string }) {
  const blocks: React.ReactNode[] = [];
  let list: string[] = [];
  let orderedList: string[] = [];
  let codeLines: string[] = [];
  let inCodeBlock = false;
  const flush = () => {
    if (list.length) { blocks.push(<ul key={`list-${blocks.length}`}>{list.map((item, i) => <li key={i}>{inline(item)}</li>)}</ul>); list = []; }
    if (orderedList.length) { blocks.push(<ol key={`ordered-list-${blocks.length}`}>{orderedList.map((item, i) => <li key={i}>{inline(item)}</li>)}</ol>); orderedList = []; }
  };
  content.split(/\r?\n/).forEach((line, index) => {
    if (line.startsWith('```')) {
      if (!inCodeBlock) { flush(); codeLines = []; inCodeBlock = true; }
      else { blocks.push(<pre key={`code-${blocks.length}`} tabIndex={0}><code>{codeLines.join('\n')}</code></pre>); codeLines = []; inCodeBlock = false; }
      return;
    }
    if (inCodeBlock) { codeLines.push(line); return; }
    if (line.startsWith('- ')) { if (orderedList.length) flush(); list.push(line.slice(2)); return; }
    const orderedItem = line.match(/^\d+\.\s+(.+)$/);
    if (orderedItem) { if (list.length) flush(); orderedList.push(orderedItem[1]); return; }
    flush();
    if (!line.trim()) return;
    if (line.startsWith('# ')) blocks.push(<h2 id={`${idPrefix}-section-${index}`} tabIndex={-1} key={index}>{inline(line.slice(2))}</h2>);
    else if (line.startsWith('## ')) blocks.push(<h3 id={`${idPrefix}-section-${index}`} tabIndex={-1} key={index}>{inline(line.slice(3))}</h3>);
    else if (line.startsWith('### ')) blocks.push(<h4 id={`${idPrefix}-section-${index}`} tabIndex={-1} key={index}>{inline(line.slice(4))}</h4>);
    else blocks.push(<p key={index}>{inline(line)}</p>);
  });
  if (inCodeBlock) blocks.push(<pre key={`code-${blocks.length}`} tabIndex={0}><code>{codeLines.join('\n')}</code></pre>);
  flush();
  return <div className="p-legal-copy">{blocks}</div>;
}

export function LegalPage({ kind }: { kind: string }) {
  const document = documents[kind];
  if (!document) return <div className="p-screen p-legal-page"><h1>Policy unavailable</h1><p>This policy could not be found. Open a listed document to continue.</p><a className="p-button" href="/legal/privacy">Open Privacy Notice<Icon name="arrow" size={15} /></a></div>;
  const idPrefix = `policy-${kind}`;
  return <article className="p-screen p-legal-page"><div className="p-page-heading"><div><span className="p-eyebrow">{document.eyebrow}</span><h1 id={`${idPrefix}-title`} tabIndex={-1}>{document.title}</h1><p>FlowSense operator workspace · United States</p></div><a className="p-button" href="/legal/review"><Icon name="shield" size={15} />Implementation review</a></div><nav className="p-legal-nav" aria-label="Legal documents">{Object.entries(documents).map(([key, item]) => <a key={key} aria-current={key === kind ? 'page' : undefined} href={`/legal/${key}`}>{item.title}</a>)}</nav><div className="p-legal-reading-layout"><LegalContents content={document.content} idPrefix={idPrefix} title={document.title} /><div className="p-legal-document-body"><Markdown content={document.content} idPrefix={idPrefix} /><div className="p-legal-reading-actions"><a href={`#${idPrefix}-title`}>Back to document title<Icon name="arrow" size={14} /></a></div><p className="p-legal-footnote">These baseline documents describe the repository-visible product. The deploying organization must complete its identity and contact details and have counsel review the terms before production use.</p></div></div></article>;
}

export function LegalReviewPage() {
  return <article className="p-screen p-legal-page"><div className="p-page-heading"><div><span className="p-eyebrow">U.S. BASELINE · ENGINEERING INVENTORY</span><h1 id="legal-review-title" tabIndex={-1}>Legal implementation review</h1><p>Repository-visible data flows and operator decisions that remain open.</p></div></div><div className="p-legal-reading-layout"><LegalContents content={review} idPrefix="legal-review" title="Legal implementation review" /><div className="p-legal-document-body"><Markdown content={review} idPrefix="legal-review" /><div className="p-legal-reading-actions"><a href="#legal-review-title">Back to document title<Icon name="arrow" size={14} /></a></div></div></div></article>;
}

