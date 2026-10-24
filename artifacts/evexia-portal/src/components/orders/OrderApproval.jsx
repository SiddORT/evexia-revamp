import { useEffect, useRef, useState } from 'react';
import { useOrderActions, useOrderPortal } from './OrderPortalContext.jsx';
import { useAdminDateFormatters } from '../admin/adminPreferences.js';
import ImmDialog from '../immunotherapy/ImmDialog.jsx';
import { getSession } from '../../auth/adminSession.js';
import { setNavigationGuard } from '../../auth/navigationGuard.js';
import './orderApproval.css';
import OrderReviewStatus from './OrderReviewStatus.jsx';

export default function OrderApproval({ kind, order, request, onApproved, dirty = false, blocked = false, onLockChange }) {
  const can = useOrderActions(kind);
  const { portal } = useOrderPortal();
  const { timestamp } = useAdminDateFormatters();
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [uncertain, setUncertain] = useState(false);
  const [confirmReject, setConfirmReject] = useState(false);
  const [reason, setReason] = useState(''), [ignoreDraft, setIgnoreDraft] = useState(false);
  const [conflict, setConflict] = useState('');
  const submission = useRef(null), sending = useRef(false);
  const decisionFocus = useRef(null);
  const permitted = portal !== 'mr' && (kind === 'kits' ? can.protected : can.edit);
  const eligibility = order.decisionEligibility;
  const eligible = Boolean(eligibility?.canReject);
  const owner = useRef(getSession().user?.id).current;
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { onLockChange?.(busy || uncertain); }, [busy, uncertain, onLockChange]);
  const resubmittable = portal === 'mr' && order.status === 'Rejected' && order.mrEditable && order.correctionSaved;
  useEffect(() => {
    if (!busy && !uncertain) return undefined;
    const release = onLockChange ? () => {} : setNavigationGuard(() => {
      setError('Keep this saved view open and retry the unchanged decision until its outcome is confirmed.');
      return true;
    });
    const unload = (event) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', unload);
    return () => { release(); window.removeEventListener('beforeunload', unload); };
  }, [busy, uncertain, onLockChange]);
  async function decide(decision) {
    if (sending.current || blocked || (!permitted && decision !== 'resubmit') || (conflict && !uncertain)) return;
    if (!owner || getSession().user?.id !== owner) {
      setError('The signed-in account changed. This account cannot send or recover the original operation.'); return;
    }
    if (!submission.current && (decision === 'resubmit' ? !resubmittable || dirty
      : decision === 'approve' ? !eligibility?.canApprove || dirty
        : !eligibility?.canReject || !reason.trim() || reason.length > 2000 || (dirty && !ignoreDraft))) return;
    if (submission.current && submission.current.owner !== owner) {
      setError('Only the original signed-in account can recover this decision. Keep this page open.'); return;
    }
    sending.current = true; setBusy(true); onLockChange?.(true); setError('');
    if (!submission.current) submission.current = { owner, decision, body: {
      expected_version: order.version, idempotencyKey: crypto.randomUUID(),
      ...(decision === 'reject' ? { reason: reason.trim() } : {}),
    } };
    const operation = submission.current;
    try {
      const saved = await request(`/${order.id}/${submission.current.decision}`, { body: submission.current.body });
      if (!alive.current || getSession().user?.id !== operation.owner) return;
      if (saved?.id !== order.id || !Number.isSafeInteger(saved.version) || saved.version <= operation.body.expected_version) {
        const failure = new Error('The decision response could not be confirmed. Retry the identical operation.');
        failure.ambiguous = true; throw failure;
      }
      submission.current = null; setUncertain(false); setConfirmReject(false); onApproved(saved);
    } catch (cause) {
      if (!alive.current || getSession().user?.id !== operation.owner) return;
      const keep = uncertain || Boolean(cause.ambiguous);
      setUncertain(keep);
      if (!keep) submission.current = null;
      setError(cause.message || 'Decision was not confirmed.');
      if (!keep && cause.status === 409) {
        setConflict('The saved order changed. Reopen its saved view separately before making a decision.');
        try {
          const current = await request(`/${order.id}`);
          if (!alive.current || getSession().user?.id !== owner) return;
          setConflict(`Saved state: ${current.status} · version ${current.version}. Reopen the saved view before deciding; this page has not replaced your displayed values.`);
        } catch { /* Keep the explicit conflict when the saved read is unavailable. */ }
      }
    } finally { sending.current = false; if (alive.current) setBusy(false); }
  }
  return <section className="order-approval" aria-label="Admin order decision" ref={decisionFocus} tabIndex={-1}>
    <OrderReviewStatus order={order} />
    <p>{order.approval
      ? <>Approved{order.approval.approvedAt ? ` · ${timestamp(order.approval.approvedAt)}` : ''}{order.approval.approvedBy ? ` · ${order.approval.approvedBy}` : ''}</>
      : order.rejection ? <>Rejected{order.rejection.rejectedAt ? ` · ${timestamp(order.rejection.rejectedAt)}` : ''}{order.rejection.rejectedBy ? ` · ${order.rejection.rejectedBy}` : ''}</>
        : order.status === 'Draft' ? 'Draft · not submitted'
          : eligible ? 'Submitted · awaiting Admin decision' : 'No recorded approval evidence'}</p>
    {permitted && <>
      {!eligibility && <p role="status">Decision availability is unavailable. Refresh the saved view; a compatible server/schema is required.</p>}
      {eligibility?.approvalUnavailable && <p role="status">{eligibility.approvalUnavailable}</p>}
      {dirty && <p role="status">Save changes first, then approve the resulting saved version. Rejection can target the saved submission while keeping your unsaved draft here.</p>}
      <div className="order-approval__actions">
        <button type="button" className="admin-button" disabled={busy || blocked || dirty || Boolean(conflict) || (uncertain ? submission.current?.decision !== 'approve' : !eligibility?.canApprove)} onClick={() => decide('approve')}>{busy && submission.current?.decision === 'approve' ? 'Approving…' : uncertain && submission.current?.decision === 'approve' ? 'Retry unchanged approval' : 'Approve order'}</button>
        <button type="button" className="admin-button admin-button--danger" disabled={busy || blocked || uncertain || !eligible || Boolean(conflict)} onClick={() => { setReason(''); setIgnoreDraft(false); setConfirmReject(true); }}>Reject order</button>
      </div>
    </>}
    {!busy && !uncertain && <a className="admin-button admin-button--secondary" href={`/${portal}/orders/${kind === 'kits' ? 'kits-consumables' : kind}/${order.id}`} target="_blank" rel="noopener noreferrer">
      Open latest saved view separately
    </a>}
    {portal === 'mr' && order.status === 'Rejected' && <>
      {!order.correctionSaved && <p>Open Edit order and save your corrections before resubmitting.</p>}
      {dirty && <p>Save corrections before resubmitting. Unsaved changes are not submitted.</p>}
      <button type="button" className="admin-button" disabled={busy || blocked || dirty || Boolean(conflict) || !resubmittable}
        onClick={() => decide('resubmit')}>{busy ? 'Resubmitting…' : uncertain ? 'Retry unchanged resubmission' : 'Resubmit for review'}</button>
    </>}
    {error && <p role="alert">{error}{uncertain && ' Keep this page open and retry the unchanged decision. Do not start a different decision.'}</p>}
    {conflict && <p role="status">{conflict}</p>}
    {confirmReject && <ImmDialog title="Reject order?" eyebrow={order.number}
      description="Reject the saved submission and return it to its owning MR for corrections. Pricing is not required. Nothing changes until you confirm."
      onClose={() => { if (!busy && !uncertain) setConfirmReject(false); }} className="order-approval__dialog" returnFocusRef={decisionFocus}>
      {error && <p role="alert">{error}</p>}
      {conflict && <p role="status">{conflict}</p>}
      <label>Rejection reason (required, up to 2,000 characters)
        <textarea value={reason} maxLength={2000} required disabled={busy || uncertain} onChange={(event) => setReason(event.target.value)} />
      </label>
      {dirty && <label><input type="checkbox" checked={ignoreDraft} disabled={busy || uncertain} onChange={(event) => setIgnoreDraft(event.target.checked)} />
        Reject the saved version only. Keep my unsaved edits in this editor; do not save or discard them.
      </label>}
      <div className="order-approval__actions">
        <button type="button" className="admin-button admin-button--secondary" disabled={busy || uncertain} onClick={() => setConfirmReject(false)}>Cancel</button>
        <button type="button" className="admin-button admin-button--danger" disabled={busy || blocked || Boolean(conflict) || (!uncertain && (!reason.trim() || (dirty && !ignoreDraft)))} onClick={() => decide('reject')}>{busy ? 'Rejecting…' : uncertain ? 'Retry unchanged rejection' : 'Reject order'}</button>
      </div>
    </ImmDialog>}
  </section>;
}
