import { useEffect, useRef, useState } from 'react';
import { useOrderActions, useOrderPortal } from './OrderPortalContext.jsx';
import { useAdminDateFormatters } from '../admin/adminPreferences.js';
import ImmDialog from '../immunotherapy/ImmDialog.jsx';
import { getSession } from '../../auth/adminSession.js';
import { setNavigationGuard } from '../../auth/navigationGuard.js';
import './orderApproval.css';

export default function OrderApproval({ kind, order, request, onApproved }) {
  const can = useOrderActions(kind);
  const { portal } = useOrderPortal();
  const { timestamp } = useAdminDateFormatters();
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [uncertain, setUncertain] = useState(false);
  const [confirmReject, setConfirmReject] = useState(false);
  const [conflict, setConflict] = useState('');
  const submission = useRef(null), sending = useRef(false);
  const decisionFocus = useRef(null);
  const permitted = portal !== 'mr' && (kind === 'kits' ? can.protected : can.edit);
  const eligibility = order.decisionEligibility;
  const eligible = Boolean(eligibility?.canReject);
  const owner = getSession().user?.id;
  useEffect(() => {
    if (!busy && !uncertain) return undefined;
    const release = setNavigationGuard(() => {
      setError('Keep this saved view open and retry the unchanged decision until its outcome is confirmed.');
      return true;
    });
    const unload = (event) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', unload);
    return () => { release(); window.removeEventListener('beforeunload', unload); };
  }, [busy, uncertain]);
  async function decide(decision) {
    if (sending.current || !permitted || (conflict && !uncertain)) return;
    if (!submission.current && !(decision === 'approve' ? eligibility?.canApprove : eligibility?.canReject)) return;
    if (submission.current && submission.current.owner !== owner) {
      setError('Only the original signed-in account can recover this decision. Keep this page open.'); return;
    }
    sending.current = true; setBusy(true); setError('');
    if (!submission.current) submission.current = { owner, decision, body: { expected_version: order.version, idempotencyKey: crypto.randomUUID() } };
    try {
      const saved = await request(`/${order.id}/${submission.current.decision}`, { body: submission.current.body });
      submission.current = null; setUncertain(false); setConfirmReject(false); onApproved(saved);
    } catch (cause) {
      const keep = uncertain || Boolean(cause.ambiguous);
      setUncertain(keep);
      if (!keep) submission.current = null;
      setError(cause.message || 'Decision was not confirmed.');
      if (!keep && cause.status === 409) {
        setConflict('The saved order changed. Reopen its saved view separately before making a decision.');
        try {
          const current = await request(`/${order.id}`);
          setConflict(`Saved state: ${current.status} · version ${current.version}. Reopen the saved view before deciding; this page has not replaced your displayed values.`);
        } catch { /* Keep the explicit conflict when the saved read is unavailable. */ }
      }
    } finally { sending.current = false; setBusy(false); }
  }
  return <section className="order-approval" aria-label="Admin order decision" ref={decisionFocus} tabIndex={-1}>
    <p>{order.approval
      ? <>Approved{order.approval.approvedAt ? ` · ${timestamp(order.approval.approvedAt)}` : ''}{order.approval.approvedBy ? ` · ${order.approval.approvedBy}` : ''}</>
      : order.rejection ? <>Rejected{order.rejection.rejectedAt ? ` · ${timestamp(order.rejection.rejectedAt)}` : ''}{order.rejection.rejectedBy ? ` · ${order.rejection.rejectedBy}` : ''}</>
        : order.status === 'Draft' ? 'Draft · not submitted'
          : eligible ? 'Submitted · awaiting Admin decision' : 'No recorded approval evidence'}</p>
    {permitted && <>
      {!eligibility && <p role="status">Decision availability is unavailable. Refresh the saved view; a compatible server/schema is required.</p>}
      {eligibility?.approvalUnavailable && <p role="status">{eligibility.approvalUnavailable}</p>}
      {(eligible || uncertain) && <div className="order-approval__actions">
        <button type="button" className="admin-button" disabled={busy || Boolean(conflict) || (uncertain ? submission.current?.decision !== 'approve' : !eligibility?.canApprove)} onClick={() => decide('approve')}>{busy && submission.current?.decision === 'approve' ? 'Approving…' : uncertain && submission.current?.decision === 'approve' ? 'Retry unchanged approval' : 'Approve order'}</button>
        <button type="button" className="admin-button admin-button--danger" disabled={busy || uncertain || Boolean(conflict)} onClick={() => setConfirmReject(true)}>Reject order</button>
      </div>}
    </>}
    {error && <p role="alert">{error}{uncertain && ' Keep this page open and retry the unchanged decision. Do not start a different decision.'}</p>}
    {conflict && <p role="status">{conflict}</p>}
    {confirmReject && <ImmDialog title="Reject order?" eyebrow={order.number}
      description="This declines the saved submission and prevents further MR edits. Pricing is not required. Nothing changes until you confirm."
      onClose={() => { if (!busy && !uncertain) setConfirmReject(false); }} className="order-approval__dialog" returnFocusRef={decisionFocus}>
      {error && <p role="alert">{error}</p>}
      {conflict && <p role="status">{conflict}</p>}
      <div className="order-approval__actions">
        <button type="button" className="admin-button admin-button--secondary" disabled={busy || uncertain} onClick={() => setConfirmReject(false)}>Cancel</button>
        <button type="button" className="admin-button admin-button--danger" disabled={busy || Boolean(conflict)} onClick={() => decide('reject')}>{busy ? 'Rejecting…' : uncertain ? 'Retry unchanged rejection' : 'Reject order'}</button>
      </div>
    </ImmDialog>}
  </section>;
}
