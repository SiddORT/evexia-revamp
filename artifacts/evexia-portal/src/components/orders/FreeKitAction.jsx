import { useEffect, useRef, useState } from 'react';
import ImmDialog from '../immunotherapy/ImmDialog.jsx';
import { useOrderActions } from './OrderPortalContext.jsx';
import { request } from '../../services/serverKits.js';
import { getSession } from '../../auth/adminSession.js';
import { setNavigationGuard } from '../../auth/navigationGuard.js';

const period = (v) => v === 'month' ? 'Month' : 'Financial year';

function Allowance({ title, value }) {
  return <section><h3>{title}</h3>{value ? <p>
    {period(value.period)}: {value.dateFrom} to {value.dateTo} · Asia/Kolkata<br />
    Cap: {value.cap} orders · Used: {value.used} · Remaining: {value.remaining}
  </p> : <p>Unavailable until settings and saved attribution are complete.</p>}</section>;
}

export default function FreeKitAction({ order, onSaved }) {
  const can = useOrderActions('kits');
  const [open, setOpen] = useState(false), [quote, setQuote] = useState(null);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false), [confirmed, setConfirmed] = useState(false);
  const opener = useRef(null), attempt = useRef(null), sending = useRef(false);
  const returnFocus = useRef(null);
  const owner = useRef(getSession().user?.id).current;
  useEffect(() => {
    if (!busy && !uncertain) return undefined;
    const leave = setNavigationGuard(() => {
      setError('Keep this confirmation open and retry the unchanged mark until its outcome is confirmed.');
      return true;
    });
    const unload = (event) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', unload);
    return () => { leave(); window.removeEventListener('beforeunload', unload); };
  }, [busy, uncertain]);
  async function preview() {
    if (sending.current) return;
    sending.current = true; setBusy(true); setError(''); setQuote(null); setConfirmed(false);
    try {
      const value = await request(`/${order.id}/free-kit-preview`);
      if (!Number.isSafeInteger(value?.orderVersion) || typeof value.eligible !== 'boolean') throw new Error('Allowance response could not be read. Retry loading the preview.');
      if (value.orderVersion !== order.version) {
        value.eligible = false;
        value.reason = 'This saved order changed. Your view is preserved. Open the latest saved view separately before preparing a new mark.';
      }
      setQuote(value);
    } catch (cause) { setError(cause.message); }
    finally { sending.current = false; setBusy(false); }
  }
  async function mark() {
    if (sending.current || (!attempt.current && (!confirmed || !quote?.eligible))) return;
    if (!owner || owner !== getSession().user?.id) { setError('The signed-in account changed. Return to this operation with the original account.'); return; }
    sending.current = true; setBusy(true); setError('');
    attempt.current ||= { expected_version: quote.orderVersion, settingsVersion: quote.settingsVersion,
      idempotencyKey: crypto.randomUUID(), confirmPermanent: true };
    try {
      const saved = await request(`/${order.id}/mark-free-kit`, { body: attempt.current });
      if (saved?.id !== order.id || saved.freeKit?.classification !== 'Free kit'
        || saved.version < attempt.current.expected_version + 1) {
        const cause = new Error('The saved Free kit outcome could not be confirmed. Retry unchanged.');
        cause.ambiguous = true; throw cause;
      }
      attempt.current = null; setUncertain(false); setOpen(false); onSaved(saved);
    } catch (cause) {
      const unknown = Boolean(cause.ambiguous) || !cause.status || cause.status >= 500;
      setUncertain(unknown); setError(cause.message);
      if (!unknown) { attempt.current = null; setQuote(null); setConfirmed(false); }
    } finally { sending.current = false; setBusy(false); }
  }
  if (!can.protected) return null;
  if (order.freeKit) return <p ref={returnFocus} tabIndex={-1}><strong>Free kit</strong> · Classification is permanent.</p>;
  if (order.status !== 'Confirmed' || order.pricing != null || order.approval) return null;
  return <>
    <button ref={opener} type="button" className="admin-button admin-button--secondary"
      onClick={() => { setOpen(true); preview(); }}>Mark as free kit</button>
    {open && <ImmDialog title="Permanently mark as free kit" returnFocusRef={{ get current() { return returnFocus.current || opener.current; } }}
      onClose={() => { if (!busy && !uncertain) setOpen(false); }}
      description="This saved operational order will have no charge or financial contribution. Ordinary editing, rates, items, assignment and attachments will be permanently locked. It will still require an explicit approval or rejection.">
      <p>Order {order.number} · saved order date {order.date}. Allowance uses the saved MR and Doctor, not later master assignments.</p>
      <Allowance title={`Per MR · ${order.mr?.name || 'Missing saved MR'}`} value={quote?.mr} />
      <Allowance title={`Per Doctor · ${order.doctor?.name || 'Missing saved Doctor'}`} value={quote?.doctor} />
      <p>One order consumes one slot in both applicable periods, regardless of item quantities. Later rejection or fulfillment does not refund allowance. This cannot be undone.</p>
      {quote && !quote.eligible && <p role="alert">{quote.reason}</p>}
      {error && <p role="alert">{error}</p>}
      <a href={window.location.href} target="_blank" rel="noopener noreferrer">Open latest saved view separately</a>
      <label><input type="checkbox" checked={confirmed} disabled={busy || uncertain || !quote?.eligible}
        onChange={(event) => setConfirmed(event.target.checked)} /> I understand the permanent edit/pricing lock and both quota charges.</label>
      <div className="admin-dialog__actions">
        <button type="button" className="admin-button admin-button--secondary" disabled={busy || uncertain} onClick={() => setOpen(false)}>Cancel</button>
        <button type="button" className="admin-button admin-button--secondary" disabled={busy || uncertain} onClick={preview}>Refresh allowance</button>
        <button type="button" className="admin-button" disabled={busy || (!uncertain && (!confirmed || !quote?.eligible))} onClick={mark}>
          {busy ? 'Please wait…' : uncertain ? 'Retry unchanged mark' : 'Confirm permanent Free kit'}
        </button>
      </div>
    </ImmDialog>}
  </>;
}
