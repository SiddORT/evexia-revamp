import { useEffect, useRef, useState } from 'react';
import { FileKey, X } from 'lucide-react';
import ImmDialog from '../immunotherapy/ImmDialog.jsx';
import { useAdminSession } from '../../auth/AdminBoundary.jsx';
import { getSession } from '../../auth/adminSession.js';
import { setNavigationGuard } from '../../auth/navigationGuard.js';
import { useOrderActions, useOrderPortal } from './OrderPortalContext.jsx';
import './orderIRN.css';

const invalidNumber = (value) => {
  const number = value.trim();
  return !number || [...number].length > 256 || /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}<>]/u.test(number);
};

export function OrderIRNSummary({ order }) {
  return order?.irn ? <p className="order-irn-summary" data-testid="text-order-irn"><strong>IRN Number:</strong> {order.irn.number}</p> : null;
}

// One dialog at listing scope: background list refreshes may replace row
// buttons but must never discard a pending operation or its entered text.
export function useOrderIRN(kind, request, onSaved) {
  const can = useOrderActions(kind);
  const { portal } = useOrderPortal();
  const { user } = useAdminSession();
  const [selected, setSelected] = useState(null);
  const focus = useRef(null), fallback = useRef(null);
  const permitted = portal !== 'mr' && (['kits', 'lupin'].includes(kind) ? can.protected : can.edit);
  return {
    action: (order) => permitted && (order.irn || order.irnCanRecord === true) ? <button
      type="button" className="admin-icon-button order-view-action"
      aria-label={`${order.irn ? 'View IRN' : 'Add IRN number'} for ${order.number}`}
      title={order.irn ? 'View IRN' : 'Add IRN number'}
      data-testid={`button-order-irn-${kind}-${order.id}`}
      onClick={(event) => {
        focus.current = event.currentTarget;
        fallback.current = event.currentTarget.closest('section[aria-label]');
        setSelected({ order, owner: user?.id });
      }}><FileKey size={16} aria-hidden="true" /></button> : null,
    dialog: <>
      {selected && <IRNDialog key={`${selected.owner}/${selected.order.id}`} {...selected} request={request}
        returnFocusRef={{ get current() { return focus.current?.isConnected ? focus.current : fallback.current; } }}
        onClose={() => setSelected(null)} onSaved={onSaved} />}</>,
  };
}

function IRNDialog({ order: initial, owner, request, onClose, onSaved, returnFocusRef }) {
  const { user } = useAdminSession();
  const [order, setOrder] = useState(initial), [number, setNumber] = useState('');
  const [busy, setBusy] = useState(false), [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState(''), [conflict, setConflict] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);
  const operation = useRef(null), sending = useRef(false), alive = useRef(true);
  const changedAccount = !owner || user?.id !== owner;
  const locked = busy || uncertain;
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    if (!locked) return undefined;
    const release = setNavigationGuard(() => {
      setError('Keep this IRN dialog open and retry the unchanged save until its outcome is confirmed.');
      return true;
    });
    const unload = (event) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', unload);
    return () => { release(); window.removeEventListener('beforeunload', unload); };
  }, [locked]);
  const active = () => alive.current && getSession().user?.id === owner;
  async function save(event) {
    event.preventDefault();
    if (sending.current || changedAccount || order.irn || conflict || (!uncertain && invalidNumber(number))) return;
    sending.current = true; setBusy(true); setError('');
    if (!operation.current) operation.current = {
      expected_version: order.version, number: number.trim(), idempotencyKey: crypto.randomUUID(),
    };
    const body = operation.current;
    try {
      const saved = await request(`/${order.id}/irn`, { body });
      if (!active()) return;
      if (saved?.id !== order.id || saved.irn?.number !== body.number
          || saved.irn?.recordedBy !== owner || saved.irn?.recordVersion !== body.expected_version + 1
          || !Number.isSafeInteger(saved.version) || saved.version < saved.irn.recordVersion) {
        const cause = new Error('The IRN save could not be confirmed. Retry the unchanged save.');
        cause.ambiguous = true; throw cause;
      }
      operation.current = null; setUncertain(false); setOrder(saved); setSavedNotice(true);
      onSaved(saved);
    } catch (cause) {
      if (!active()) return;
      const keep = uncertain || Boolean(cause.ambiguous);
      setUncertain(keep);
      if (!keep) operation.current = null;
      if (!keep && cause.status === 409) setConflict(true);
      setError(keep
        ? 'The save outcome is not confirmed. Keep this dialog open and retry the unchanged save; do not enter another IRN.'
        : cause.status === 409
          ? 'The saved order changed or no longer accepts this IRN. Refresh the saved order before continuing. Your entered text is preserved.'
          : cause.status === 422
            ? 'Enter 1–256 plain-text characters without controls or markup. Your entered text is preserved.'
            : 'The IRN was not accepted. Check your access or connection and retry. Your entered text is preserved.');
    } finally {
      sending.current = false;
      if (alive.current) {
        // A renewal/account boundary may prevent consumption of a successful
        // reply. Retain the original operation, never unlock it as a new save.
        if (operation.current) setUncertain(true);
        setBusy(false);
      }
    }
  }
  async function refresh() {
    if (sending.current || locked || changedAccount) return;
    sending.current = true; setBusy(true); setError('');
    try {
      const current = await request(`/${order.id}`);
      if (!active()) return;
      if (current?.id !== order.id || !Number.isSafeInteger(current.version)) throw new Error();
      setOrder(current); setConflict(false); onSaved(current);
    } catch {
      if (active()) setError('The latest saved order could not be loaded. Your entered text is preserved.');
    } finally { sending.current = false; if (alive.current) setBusy(false); }
  }
  const close = () => { if (!sending.current && !locked) onClose(); };
  return <ImmDialog title="IRN Number" eyebrow={order.number} className="order-irn-dialog"
    returnFocusRef={returnFocusRef} onClose={close} testId="dialog-order-irn"
    description="External reference only. Saving does not issue or verify an e-invoice, or change the Invoice number.">
    <button type="button" className="admin-icon-button order-irn-dialog__close" aria-label="Close IRN Number"
      disabled={locked} onClick={close} data-testid="button-irn-close-icon"><X size={18} aria-hidden="true" /></button>
    {changedAccount ? <p role="alert">The signed-in account changed. This account cannot view, send or recover the original IRN operation.</p>
      : <form onSubmit={save}>
        {order.irn ? <OrderIRNSummary order={order} /> : <label className="order-irn-dialog__field">
          IRN Number <span aria-hidden="true">*</span>
          <input name="irn-number" required value={number} disabled={locked} data-testid="input-order-irn"
            onChange={(event) => setNumber(event.target.value)} aria-describedby="order-irn-limit" />
          <small id="order-irn-limit">Required. Up to 256 plain-text characters.</small>
          {number && invalidNumber(number) && <small role="status">Enter 1–256 plain-text characters without controls, line breaks or markup.</small>}
        </label>}
        {savedNotice && <p role="status">IRN saved. This value is read-only.</p>}
        {error && <p role="alert">{error}</p>}
        {!order.irn && !order.irnCanRecord && <p role="status">This saved order no longer accepts an IRN.</p>}
        <div className="admin-dialog__actions">
          <button type="button" className="admin-button admin-button--secondary" disabled={locked} onClick={close} data-testid="button-irn-close">Close</button>
          {conflict && !uncertain && <button type="button" className="admin-button admin-button--secondary" disabled={busy} onClick={refresh} data-testid="button-irn-refresh">Refresh saved order</button>}
          {!order.irn && <button type="submit" className="admin-button" data-testid="button-irn-save"
            disabled={busy || conflict || (!uncertain && (!order.irnCanRecord || invalidNumber(number)))}>
            {busy ? 'Saving…' : uncertain ? 'Retry unchanged save' : 'Save'}</button>}
        </div>
      </form>}
  </ImmDialog>;
}
