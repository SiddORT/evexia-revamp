import { useRef, useState } from 'react';
import { useOrderActions, useOrderPortal } from './OrderPortalContext.jsx';
import { useAdminDateFormatters } from '../admin/adminPreferences.js';
import './orderApproval.css';

export default function OrderApproval({ kind, order, request, onApproved }) {
  const can = useOrderActions(kind);
  const { portal } = useOrderPortal();
  const { timestamp } = useAdminDateFormatters();
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [uncertain, setUncertain] = useState(false);
  const submission = useRef(null), sending = useRef(false);
  const permitted = portal !== 'mr' && (kind === 'kits' ? can.protected : can.edit);
  const eligible = order.mrEditable && (kind !== 'spt' || order.status === 'Saved');
  async function approve() {
    if (sending.current || !permitted) return;
    sending.current = true; setBusy(true); setError('');
    if (!submission.current) submission.current = { expected_version: order.version, idempotencyKey: crypto.randomUUID() };
    try {
      const saved = await request(`/${order.id}/approve`, { body: submission.current });
      submission.current = null; setUncertain(false); onApproved(saved);
    } catch (cause) {
      const keep = uncertain || Boolean(cause.ambiguous);
      setUncertain(keep);
      if (!keep) submission.current = null;
      setError(cause.message || 'Approval was not confirmed.');
    } finally { sending.current = false; setBusy(false); }
  }
  return <section className="order-approval" aria-label="Admin approval">
    <p>{order.approval
      ? <>Approved{order.approval.approvedAt ? ` · ${timestamp(order.approval.approvedAt)}` : ''}{order.approval.approvedBy ? ` · ${order.approval.approvedBy}` : ''}</>
      : order.status === 'Draft' ? 'Draft · not submitted'
        : eligible ? 'Submitted · awaiting Admin approval' : 'No recorded approval evidence'}</p>
    {permitted && eligible && <button type="button" className="admin-button" disabled={busy} onClick={approve}>{busy ? 'Approving…' : uncertain ? 'Retry unchanged approval' : 'Approve order'}</button>}
    {error && <p role="alert">{error}{uncertain && ' Keep this page open and retry the unchanged approval.'}</p>}
  </section>;
}
