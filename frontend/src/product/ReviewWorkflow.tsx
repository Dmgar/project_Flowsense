import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { getCases, openCase, reviewCase } from './api';
import { recordPolicyAcceptance } from './api';
import { PolicyAcceptanceFields } from './LegalPages';
import { usePolicyChoices } from './usePolicyChoices';
import { useProduct } from './store';
import { statusLabels } from './data';
import { caseReviewWasSaved } from './reviewOutcome';
import { Icon, ReviewBadge } from './ui';
import type { ReviewStatus, Signal } from './types';
import './reviewDialog.css';

type PendingReviewAttempt = { status: ReviewStatus; owner: string; note: string; receiptId: string };

export function CaseDialog({ signal, onClose }: { signal: Signal; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const statusInput = useRef<HTMLSelectElement>(null);
  const noteInput = useRef<HTMLTextAreaElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const retryStatusButton = useRef<HTMLButtonElement>(null);
  const saving = useRef(false);
  const cases = useProduct((s) => s.cases);
  const existing = cases.find((c) => c.signal_id === signal.id);
  const readOnly = existing?.status === 'resolved' || existing?.status === 'dismissed';
  const [owner, setOwner] = useState(existing?.owner || signal.owner);
  const [note, setNote] = useState('');
  const [target, setTarget] = useState<ReviewStatus | ''>('');
  const [busy, setBusy] = useState(false);
  const [retryingCaseList, setRetryingCaseList] = useState(false);
  const [pendingReview, setPendingReview] = useState<PendingReviewAttempt | null>(null);
  const [error, setError] = useState('');
  const policy = usePolicyChoices();
  const allowed: Record<ReviewStatus, ReviewStatus[]> = { new: ['assigned', 'under_review', 'dismissed'], assigned: ['under_review', 'confirmed', 'dismissed'], under_review: ['assigned', 'confirmed', 'dismissed'], confirmed: ['resolved'], resolved: [], dismissed: [] };
  useEffect(() => { dialog.current?.showModal(); (readOnly ? closeButton.current : statusInput.current)?.focus(); }, [readOnly]);
  useEffect(() => { if (pendingReview && error && !busy && !retryingCaseList) retryStatusButton.current?.focus(); }, [pendingReview, error, busy, retryingCaseList]);
  const refreshReviewOutcome = async (attempt: PendingReviewAttempt): Promise<'saved' | 'not-confirmed' | 'unavailable'> => {
    setRetryingCaseList(true);
    try {
      const latestCases = await getCases();
      const product = useProduct.getState();
      product.setCases(latestCases);
      product.setError('');
      const savedCase = latestCases.find(item => item.signal_id === signal.id);
      if (savedCase && caseReviewWasSaved(latestCases, signal.id, attempt.status, attempt.owner, attempt.note)) {
        if (signal.data_origin === 'observation') product.recordJourney('review_saved');
        product.notify(`Case ${savedCase.id}: ${statusLabels[attempt.status].toLowerCase()} · policy receipt ${attempt.receiptId}.`);
        setPendingReview(null);
        onClose();
        return 'saved';
      }
      setPendingReview(null);
      return 'not-confirmed';
    } catch {
      const product = useProduct.getState();
      product.setCasesLoadStatus('error');
      product.setError('Saved cases could not be refreshed. Retry the case status check before submitting another review.');
      return 'unavailable';
    } finally { setRetryingCaseList(false); }
  };
  const retryCaseStatusCheck = async () => {
    if (!pendingReview || retryingCaseList) return;
    setError('');
    const attempt = pendingReview;
    const outcome = await refreshReviewOutcome(attempt);
    if (outcome === 'not-confirmed') setError(`The latest case list does not confirm the requested status. Review the current case state before submitting another change. Policy receipt ${attempt.receiptId}.`);
    else if (outcome === 'unavailable') setError(`The review status is still unconfirmed · receipt ${attempt.receiptId}. Retry this status check before submitting again.`);
  };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (saving.current || retryingCaseList || pendingReview) return;
    if (!target) { setError('Choose the next case status before saving.'); return; }
    saving.current = true; setBusy(true); setError('');
    let receiptId = '';
    try {
      const receipt = await recordPolicyAcceptance({ form_type: 'case_review', operator_reference: policy.operatorReference, terms_accepted: policy.termsAccepted, privacy_acknowledged: policy.privacyAcknowledged });
      receiptId = receipt.receipt_id;
      const current = existing || await openCase(signal, owner);
      await reviewCase(current.id, target, owner, note);
      if (signal.data_origin === 'observation') useProduct.getState().recordJourney('review_saved');
      try {
        useProduct.getState().setCases(await getCases());
        useProduct.getState().notify(`Case ${current.id}: ${statusLabels[target].toLowerCase()} · policy receipt ${receiptId}.`);
      } catch {
        const product = useProduct.getState();
        product.setCasesLoadStatus('error');
        product.setError(`Review saved for ${current.id}, but the case list could not refresh. Use Retry connection to update the review queue.`);
        useProduct.getState().notify(`Review saved for ${current.id}, but the case list could not refresh · policy receipt ${receiptId}.`);
      }
      onClose();
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Could not save.';
      if (receiptId) {
        const attempt = { status: target, owner, note, receiptId };
        setPendingReview(attempt);
        setTarget('');
        const outcome = await refreshReviewOutcome(attempt);
        if (outcome === 'saved') return;
        if (outcome === 'not-confirmed') {
          setError(`Policy choices were recorded · receipt ${receiptId}. The latest case list does not confirm the requested status. Choose a valid next status and save again after reviewing the current case state. ${detail}`);
          return;
        }
        setError(`Policy choices were recorded · receipt ${receiptId}. The review status could not be confirmed. Retry the case status check before submitting again. ${detail}`);
        return;
      }
      setError(detail);
    }
    finally { saving.current = false; setBusy(false); }
  };
  const controlsDisabled = busy || retryingCaseList || pendingReview !== null;
  const statusGuidance: Record<ReviewStatus, string> = {
    new: 'Start with the available evidence and identify the next review step.',
    assigned: 'Identify the team responsible for the next review step.',
    under_review: 'Document the evidence being examined and what remains uncertain.',
    confirmed: 'Record a human confirmation supported by the evidence you reviewed.',
    resolved: 'Explain why the confirmed case can now be closed.',
    dismissed: 'Explain why the available evidence does not warrant keeping the case open.',
  };
  return <dialog ref={dialog} className="p-dialog p-review-dialog" aria-labelledby="case-dialog-title" aria-describedby="case-dialog-context" onCancel={event => { if (busy || retryingCaseList) event.preventDefault(); else onClose(); }}>
    <form aria-busy={busy || retryingCaseList} onSubmit={event => { if (readOnly) event.preventDefault(); else void save(event); }}>
      <header><span className="p-eyebrow">{readOnly ? 'CASE AUDIT' : 'HUMAN REVIEW'}</span><button ref={closeButton} type="button" className="p-icon-button" aria-label={readOnly ? 'Close case audit' : 'Close review'} disabled={busy || retryingCaseList} onClick={onClose}><Icon name="close" /></button><h2 id="case-dialog-title">{existing?.id || 'Review this signal'}</h2><p id="case-dialog-context">{signal.title} · {signal.location}</p><div className="p-review-context"><span className="p-review-origin"><Icon name={signal.data_origin === 'observation' ? 'camera' : 'play'} size={14} />{signal.data_origin === 'observation' ? 'Observation evidence' : 'Presentation scenario'}</span><span className="p-review-current-status">Current status<ReviewBadge value={existing?.status || 'new'} /></span></div></header>
      <div className="p-review-dialog-body">
        {readOnly ? <><div className="p-review-closed-note"><Icon name="shield" size={20} /><p>This case is closed. You can read its audit history, but its status can no longer be changed.</p></div>{existing && <dl className="p-review-case-summary"><div><dt>Current status</dt><dd>{statusLabels[existing.status]}</dd></div><div><dt>Responsible team</dt><dd>{existing.owner}</dd></div></dl>}</> : <>
          <fieldset className="p-review-section"><legend>Review decision</legend><div className="p-review-decision-fields">
            <label htmlFor="case-review-team">Responsible team<select id="case-review-team" disabled={controlsDisabled} value={owner} onChange={event => setOwner(event.target.value)}>{Array.from(new Set([owner, 'Traffic operations', 'Freight and road space', 'Road safety', 'Field team', 'Signal operations', 'Public mobility'])).map(team => <option key={team}>{team}</option>)}</select></label>
            <label htmlFor="case-review-status">Next status (required)<select id="case-review-status" ref={statusInput} required disabled={controlsDisabled} value={target} aria-describedby="case-review-status-help" onChange={event => setTarget(event.target.value as ReviewStatus | '')}><option value="" disabled>Select a next status</option>{allowed[existing?.status || 'new'].map(value => <option key={value} value={value}>{statusLabels[value]}</option>)}</select></label>
          </div><p id="case-review-status-help" className="p-review-status-help" role="status"><Icon name="info" size={16} />{target ? statusGuidance[target] : 'Choose a next status to see what to document in your review.'}</p></fieldset>
          <fieldset className="p-review-section"><legend>Your review note (required)</legend><label htmlFor="case-review-note" className="p-review-note-label"><span className="p-sr-only">Review note</span><textarea id="case-review-note" ref={noteInput} disabled={controlsDisabled} required minLength={3} maxLength={2000} rows={4} placeholder="What did you review, what does it support, and what should happen next?" aria-describedby="case-review-note-guidance case-review-note-count" value={note} onChange={event => setNote(event.target.value)} /><span className="p-review-note-meta"><small id="case-review-note-guidance" className="p-review-note-guidance">Include the evidence you checked and the reason for this status. At least 3 characters.</small><small id="case-review-note-count" className="p-review-note-count">{note.length.toLocaleString('en-US')} / 2,000</small></span></label>
            <details className="p-review-writing-help"><summary>What makes a useful note?<Icon name="plus" size={14} /></summary><ul><li>Name the source or saved clip you examined.</li><li>Explain the observation that supports your decision.</li><li>Record uncertainty and the next human check. Keep personal contact details out of the note.</li></ul></details>
          </fieldset>
          <p className="p-review-evidence-boundary"><Icon name={signal.data_origin === 'observation' ? 'camera' : 'play'} size={17} /><span>{signal.data_origin === 'observation' ? 'Manual review of a camera observation. Object detection does not confirm an incident.' : 'This case belongs to the presentation scenario.'} Confirmation documents the review; it does not control traffic signals or dispatch units.</span></p>
          <PolicyAcceptanceFields formType="case_review" operatorReference={policy.operatorReference} onOperatorReference={policy.setOperatorReference} termsAccepted={policy.termsAccepted} onTermsAccepted={policy.setTermsAccepted} privacyAcknowledged={policy.privacyAcknowledged} onPrivacyAcknowledged={policy.setPrivacyAcknowledged} disabled={controlsDisabled} />
        </>}
        {existing && <section className="p-audit" aria-label="Case audit log"><header><h3>Case audit log</h3><span>{existing.audit.length} {existing.audit.length === 1 ? 'entry' : 'entries'}</span></header><p className="p-review-audit-timezone">Times use your device time zone: {Intl.DateTimeFormat().resolvedOptions().timeZone}. Original timestamps remain attached to each entry.</p>{existing.audit.length ? <ol tabIndex={0} aria-label="Audit entries; scroll to read the full history">{existing.audit.map((item, index) => <li key={index}><span className="p-review-audit-marker" aria-hidden="true" /><div><strong>{statusLabels[item.action] || item.action}</strong><span className="p-review-audit-owner">Responsible team: {item.owner || 'Not recorded'}</span><time dateTime={item.at} title={item.at}>{new Date(item.at).toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short' })}</time><p>{item.note}</p></div></li>)}</ol> : <p className="p-review-audit-empty">No audit entries were returned for this case.</p>}</section>}
        {error && <div className="p-inline-error" role="alert"><span>{error}</span>{pendingReview && <button ref={retryStatusButton} type="button" className="p-button" disabled={retryingCaseList} onClick={() => void retryCaseStatusCheck()}>{retryingCaseList ? 'Checking case status…' : 'Retry case status check'}</button>}</div>}
      </div>
      <footer><span className="p-review-save-context">{readOnly ? 'Read-only audit record' : pendingReview ? 'Confirm the previous submission before saving again.' : busy || retryingCaseList ? 'Keep this dialog open while the request completes.' : 'Your decision and note become part of the case history.'}</span><button type="button" className="p-button" disabled={busy || retryingCaseList} onClick={onClose}>{readOnly ? 'Close' : 'Cancel'}</button>{!readOnly && <button className="p-button primary" disabled={controlsDisabled || !target || !allowed[existing?.status || 'new'].length || !policy.termsAccepted || !policy.privacyAcknowledged || policy.operatorReference.trim().length < 2}>{busy ? 'Saving…' : 'Save review'}<span className={busy ? 'p-request-progress' : undefined} aria-hidden="true"><Icon name={busy ? 'refresh' : 'check'} /></span></button>}</footer>
    </form>
  </dialog>;
}
