import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import AdminLayout from './AdminLayout.jsx';
import { useAdminDateFormatters } from './adminPreferences.js';
import { Editor, LineTable } from '../../pages/admin/PurchaseOrderFormPage.jsx';
import {
  clearOrderMutation, deletePurchaseOrder, describeError, formatPaise, getPurchaseOrder, isPermissionError,
  isStaleOrder, isUncertain, loadOrderMutation, newKey, saveOrderMutation,
} from '../../services/serverPurchaseOrders.js';

const BASE = '/admin/inventory/purchase-orders';

export default function PurchaseOrderDetail({ id }) {
  const { date, timestamp } = useAdminDateFormatters();
  const [, navigate] = useLocation();
  const [order, setOrder] = useState(null);
  const [error, setError] = useState('');
  const [denied, setDenied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [nonce, setNonce] = useState(0);
  const [retry, setRetry] = useState(() => loadOrderMutation(id));
  const [deleting, setDeleting] = useState(retry.pending?.operation === 'delete');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [mutationError, setMutationError] = useState('');
  const [notice, setNotice] = useState('');
  const [stale, setStale] = useState(false);
  const pending = retry.status === 'found' ? retry.pending : null;
  const blocked = retry.status === 'blocked' ? retry.message : '';
  useEffect(() => {
    if (editing || deleting || pending || blocked || busy) return undefined;
    const refresh = () => { if (!document.hidden) setNonce((n) => n + 1); };
    const timer = setInterval(refresh, 30000);
    window.addEventListener('focus', refresh);
    return () => { clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, [editing, deleting, pending, blocked, busy]);

  useEffect(() => {
    const controller = new AbortController();
    setOrder(null); setError(''); setDenied(false);
    getPurchaseOrder(id, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      setOrder(result);
      // Reconcile an edit even if a later mutation changed/deleted the order.
      if (pending?.operation === 'edit') setEditing(true);
    }).catch((cause) => {
      if (controller.signal.aborted) return;
      setError(describeError(cause, 'The saved purchase order could not be loaded.'));
      setDenied(isPermissionError(cause));
    });
    return () => controller.abort();
    // Retry metadata is consumed on mount/reload, not after each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, nonce]);

  function reload() {
    const next = loadOrderMutation(id);
    setRetry(next); setEditing(false); setDeleting(next.pending?.operation === 'delete'); setStale(false); setMutationError('');
    setNonce((n) => n + 1);
  }

  async function remove() {
    if (busyRef.current || blocked || stale) return;
    busyRef.current = true; setBusy(true); setMutationError('');
    const attempt = pending || { operation: 'delete', version: order.version, key: newKey() };
    if (attempt.operation !== 'delete' || !await saveOrderMutation(id, attempt)) {
      setMutationError('Nothing was sent. Safe retry storage is unavailable or another tab has an unconfirmed action. Reopen this order to reconcile it.');
      busyRef.current = false; setBusy(false); return;
    }
    setRetry({ status: 'found', pending: attempt });
    try {
      const saved = await deletePurchaseOrder(id, attempt.version, attempt.key);
      const cleared = await clearOrderMutation(id, attempt.key);
      setRetry(cleared ? { status: 'none' } : loadOrderMutation(id));
      setOrder(saved); setDeleting(false);
      setNotice('Purchase order deleted. It remains readable in Deleted orders and Activity. No stock or receipts were changed.');
    } catch (cause) {
      if (isUncertain(cause)) {
        setMutationError('Deletion is unconfirmed. Retry the exact same action to confirm its result; editing stays locked.');
      } else {
        await clearOrderMutation(id, attempt.key); setRetry(loadOrderMutation(id));
        if (isStaleOrder(cause)) setStale(true);
        setMutationError(isStaleOrder(cause)
          ? 'This order changed or was deleted in another session. Reload the latest order and check it before deleting.'
          : describeError(cause, 'The order could not be deleted.'));
      }
    } finally { busyRef.current = false; setBusy(false); }
  }

  return <AdminLayout title={order?.number || 'Purchase order'}><div className="po-page">
    <div className="admin-page-head"><div><p className="admin-page-head__eyebrow">Inventory / Purchase orders / {editing ? 'Edit' : 'Detail'}</p><h1>{order?.number || 'Purchase order'}</h1><p className="admin-page-head__description">Saved server purchase order. No supplier submission, receipts, invoices or stock effects.</p></div>
      {!editing && <button type="button" className="admin-button admin-button--secondary" disabled={busy} onClick={() => navigate(BASE)}>All orders</button>}</div>
    {error ? <section className="admin-panel po-recovery" role="alert"><h2>{denied ? 'Access required' : 'Order unavailable'}</h2><p>{error}</p>{!denied && <button type="button" className="admin-button" onClick={reload}>Try again</button>}</section>
      : !order ? <p role="status">Loading saved purchase order…</p>
      : editing ? <Editor key={`${id}:${nonce}`} order={order} onCancel={() => setEditing(false)} onReload={reload} onSaved={(saved) => { setOrder(saved); setEditing(false); setRetry(loadOrderMutation(id)); setNotice('Purchase order changes saved.'); }} />
      : <section className="admin-panel">
        {notice && <p className="admin-feedback" role="status">{notice}</p>}
        {blocked && <p className="admin-feedback admin-feedback--error" role="alert">{blocked}</p>}
        {mutationError && <p className="admin-feedback admin-feedback--error" role="alert">{mutationError}</p>}
        <div className="po-review">
          <p><strong>Status: {order.status}</strong> · Version {order.version}</p>
          <dl className="po-detail-grid">
            <div><dt>Vendor</dt><dd>{order.vendorName}</dd></div><div><dt>Storage location</dt><dd>{order.locationName}</dd></div>
            <div><dt>PO date</dt><dd>{date(order.poDate)}</dd></div><div><dt>Expected delivery</dt><dd>{date(order.expectedDate)}</dd></div>
            <div><dt>Created</dt><dd>{timestamp(order.createdAt, true)}</dd></div><div><dt>Last updated</dt><dd>{timestamp(order.updatedAt, true)}</dd></div>
            {order.deletedAt && <div><dt>Deleted</dt><dd>{timestamp(order.deletedAt, true)}</dd></div>}
          </dl>
        </div>
        <LineTable lines={order.lines} figures={order} />
        {deleting ? <div className="po-review" role="region" aria-label="Confirm purchase order deletion">
          <h2>Delete {order.number}?</h2><p>This removes {formatPaise(order.total)} from open order value. The record and audit history are retained. This does not change receipts or stock.</p>
          <div className="po-actions"><button type="button" className="admin-button admin-button--secondary" disabled={busy || Boolean(pending)} onClick={() => { setDeleting(false); setMutationError(''); }}>Cancel deletion</button>
            <button type="button" className="admin-button" disabled={busy || Boolean(blocked) || stale} onClick={remove} data-testid="button-confirm-delete-po">{busy ? 'Deleting…' : pending ? 'Retry deletion' : 'Confirm deletion'}</button></div>
        </div> : order.status === 'open' && <div className="po-form-footer"><span>Changes require a new server review.</span><div className="po-actions">
          <button type="button" className="admin-button" disabled={Boolean(blocked) || Boolean(pending)} onClick={() => { setRetry(loadOrderMutation(id)); setEditing(true); setNotice(''); }} data-testid="button-edit-po">Edit purchase order</button>
          <button type="button" className="admin-button admin-button--secondary" disabled={Boolean(blocked) || Boolean(pending)} onClick={() => { setDeleting(true); setNotice(''); }} data-testid="button-delete-po">Delete purchase order</button>
        </div></div>}
        <div className="po-review"><button type="button" className="admin-button admin-button--secondary" disabled={busy} onClick={reload}>Reload latest order</button></div>
      </section>}
  </div></AdminLayout>;
}
