import { useEffect, useRef, useState } from 'react';
import { Mail } from 'lucide-react';
import Dialog from './Dialog.jsx';
import { inviteAccount } from '../../services/emailDelivery.js';
import { reportingIdentityGuard } from '../../auth/adminSession.js';

export default function InviteAccountButton({ kind, record, disabled = false, className = 'admin-icon-button' }) {
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null), [error, setError] = useState('');
  const gate = useRef(false), alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const reason = record.status !== 'active' ? 'Activate this saved account before inviting.'
    : !record.email ? 'Save a recipient email address first.'
    : kind === 'staff' && (!record.workspace_login_enabled || !record.custom_role_id)
      ? 'Use Access to choose a custom role and enable workspace login first. An invitation cannot grant access.' : '';
  async function send() {
    if (gate.current || reason || result || error) return;
    const guard = reportingIdentityGuard();
    gate.current = true; setBusy(true);
    try {
      const response = await inviteAccount(kind, record);
      guard();
      if (alive.current) setResult(response);
    } catch (cause) {
      try { guard(); } catch { return; }
      if (alive.current) setError(cause.message + ' Check Email Logs before opening a new invitation request.');
    } finally { gate.current = false; if (alive.current) setBusy(false); }
  }
  return <>
    <button type="button" className={className} disabled={disabled}
      aria-label={`Invite ${record.name} by email`} title="Invite / send again"
      data-testid={`button-invite-${kind}-${record.id}`}
      onClick={() => { setOpen(true); setResult(null); setError(''); }}><Mail size={16} aria-hidden="true" /></button>
    {open && <Dialog title="Send email invitation?" eyebrow={kind === 'mr' ? 'MR Master' : 'Staff Management'}
      description={`Send a one-use, 15-minute set-password link to ${record.email || 'the saved email address'} for the ${kind === 'mr' ? 'MR' : 'Admin'} portal? No password is emailed. Existing credentials keep working until the link is accepted; roles and access are unchanged.`}
      onClose={() => { if (!gate.current) setOpen(false); }}
      footer={<><button type="button" className="admin-button admin-button--secondary" disabled={busy}
        onClick={() => setOpen(false)}>{result || error || reason ? 'Close' : 'Cancel'}</button>
        {!result && !error && <button type="button" className="admin-button" disabled={busy || Boolean(reason)}
          onClick={send} data-testid="button-confirm-invitation">{busy ? 'Sending…' : 'Send invitation'}</button>}</>}>
      {reason && <p role="alert">{reason}</p>}
      {error && <p role="alert">{error}</p>}
      {result && <p role={result.status === 'failed' ? 'alert' : 'status'}>{result.message}</p>}
      <p>Sending again is explicit, not automatic. A failed email does not undo a saved directory record. No inbox-delivery confirmation is available.</p>
    </Dialog>}
  </>;
}
