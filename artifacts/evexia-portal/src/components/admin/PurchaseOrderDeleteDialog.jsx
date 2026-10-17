import { useRef, useState } from 'react';
import ConfirmationDialog from './ConfirmationDialog.jsx';
import {
  clearOrderMutation, deletePurchaseOrder, describeError, formatPaise, getPurchaseOrder,
  isStaleOrder, isUncertain, loadOrderMutation, newKey, saveOrderMutation,
} from '../../services/serverPurchaseOrders.js';

/** One mutation controller for listing and detail. Never replace an uncertain key. */
export default function PurchaseOrderDeleteDialog({ order, onClose, onDeleted }) {
  const [current, setCurrent] = useState(order);
  const [retry, setRetry] = useState(() => loadOrderMutation(order.id));
  const [busy, setBusy] = useState(false);
  const [stale, setStale] = useState(false);
  const [error, setError] = useState('');
  const busyRef = useRef(false);
  const pending = retry.status === 'found' ? retry.pending : null;
  const blocked = retry.status === 'blocked' ? retry.message
    : pending && pending.operation !== 'delete' ? 'An edit is unconfirmed. Open Edit to reconcile it before deleting.' : '';
  async function remove() {
    if (busyRef.current || blocked) return;
    busyRef.current = true; setBusy(true); setError('');
    try {
      if (stale) {
        const latest = await getPurchaseOrder(order.id);
        setCurrent(latest); setStale(false);
        if (latest.status !== 'open') { onDeleted(latest); return; }
        setError('Latest version loaded. Review the updated amount and confirm deletion again.');
        return;
      }
      const attempt = pending || { operation: 'delete', version: current.version, key: newKey() };
      if (!await saveOrderMutation(order.id, attempt)) {
        setRetry(loadOrderMutation(order.id));
        setError('Nothing was sent. Safe retry storage is unavailable or another tab has an unconfirmed action. Reopen this confirmation to reconcile it.');
        return;
      }
      setRetry({ status: 'found', pending: attempt });
      try {
        const saved = await deletePurchaseOrder(order.id, attempt.version, attempt.key);
        const cleared = await clearOrderMutation(order.id, attempt.key);
        if (!cleared) {
          setRetry(loadOrderMutation(order.id));
          setError('Deletion confirmed, but retry storage could not be cleared. Retry this same action to finish reconciliation.');
          return;
        }
        setRetry({ status: 'none' });
        onDeleted(saved);
      } catch (cause) {
        if (isUncertain(cause)) setError('Deletion is unconfirmed. Retry this exact action; its saved identity and version are reused.');
        else {
          const cleared = await clearOrderMutation(order.id, attempt.key);
          setRetry(loadOrderMutation(order.id));
          setStale(cleared && isStaleOrder(cause));
          setError(!cleared ? 'The request was rejected, but retry storage could not be cleared. Retry this same action to finish reconciliation before starting another.'
            : isStaleOrder(cause) ? 'This order changed or was deleted. Load its latest version here before confirming again.' : describeError(cause, 'The order could not be deleted.'));
        }
      }
    } catch (cause) {
      setError(describeError(cause, 'The latest order could not be loaded. Nothing new was sent.'));
    } finally { busyRef.current = false; setBusy(false); }
  }
  return <ConfirmationDialog
    title={`Delete ${current.number}?`}
    description={`Version ${current.version} · ${current.vendorName} · ${formatPaise(current.total)}. Deletion removes this value from open orders. The saved record and audit history remain; receipts and stock are unchanged.${pending?.operation === 'delete' ? ' An earlier deletion is unconfirmed; retry reconciles that same action.' : ''}`}
    destructive pending={busy} blocked={Boolean(blocked)}
    actionLabel={stale ? 'Load latest order' : pending?.operation === 'delete' ? 'Retry deletion' : 'Confirm deletion'}
    error={blocked || error} onConfirm={remove}
    onClose={() => { if (!busyRef.current) onClose(); }}
  />;
}
