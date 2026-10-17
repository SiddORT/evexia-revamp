import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import AdminLayout from './AdminLayout.jsx';
import { useAdminDateFormatters } from './adminPreferences.js';
import { Editor, LineTable } from '../../pages/admin/PurchaseOrderFormPage.jsx';
import { TaxBasis } from './PurchaseOrderTaxSummary.jsx';
import PurchaseOrderDeleteDialog from './PurchaseOrderDeleteDialog.jsx';
import {
  describeError, getPurchaseOrder, isPermissionError, loadOrderMutation,
} from '../../services/serverPurchaseOrders.js';

const BASE = '/admin/inventory/purchase-orders';

export default function PurchaseOrderDetail({ id }) {
  const { date, timestamp } = useAdminDateFormatters();
  const [, navigate] = useLocation();
  const [order, setOrder] = useState(null);
  const [error, setError] = useState('');
  const [denied, setDenied] = useState(false);
  const [editing, setEditing] = useState(false);
  const enterEdit = useRef(new URLSearchParams(window.location.search).get('edit') === '1');
  const allOrdersButton = useRef(null);
  const [nonce, setNonce] = useState(0);
  const [retry, setRetry] = useState(() => loadOrderMutation(id));
  const [deleting, setDeleting] = useState(retry.pending?.operation === 'delete');
  const [notice, setNotice] = useState('');
  const pending = retry.status === 'found' ? retry.pending : null;
  const blocked = retry.status === 'blocked' ? retry.message : '';
  useEffect(() => {
    if (editing || deleting || pending || blocked) return undefined;
    const refresh = () => { if (!document.hidden) setNonce((n) => n + 1); };
    const timer = setInterval(refresh, 30000);
    window.addEventListener('focus', refresh);
    return () => { clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, [editing, deleting, pending, blocked]);

  useEffect(() => {
    const controller = new AbortController();
    setOrder(null); setError(''); setDenied(false);
    getPurchaseOrder(id, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      setOrder(result);
      // Reconcile an edit even if a later mutation changed/deleted the order.
      if (pending?.operation === 'edit') setEditing(true);
      else if (enterEdit.current && result.status === 'open' && !pending && !blocked) setEditing(true);
      enterEdit.current = false;
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
    setRetry(next); setEditing(false); setDeleting(next.pending?.operation === 'delete');
    setNonce((n) => n + 1);
  }

  return <AdminLayout title={order?.number || 'Purchase order'}><div className="po-page">
    <div className="admin-page-head"><div><p className="admin-page-head__eyebrow">Inventory / Purchase orders / {editing ? 'Edit' : 'Detail'}</p><h1>{order?.number || 'Purchase order'}</h1></div>
      {!editing && <button ref={allOrdersButton} type="button" className="admin-button admin-button--secondary" onClick={() => navigate(BASE)}>All orders</button>}</div>
    {error ? <section className="admin-panel po-recovery" role="alert"><h2>{denied ? 'Access required' : 'Order unavailable'}</h2><p>{error}</p>{!denied && <button type="button" className="admin-button" onClick={reload}>Try again</button>}</section>
      : !order ? <p role="status">Loading saved purchase order…</p>
      : editing ? <Editor key={`${id}:${nonce}`} order={order} onCancel={() => setEditing(false)} onReload={reload} onSaved={(saved) => { setOrder(saved); setEditing(false); setRetry(loadOrderMutation(id)); setNotice('Purchase order changes saved.'); }} />
      : <section className="admin-panel">
        {notice && <p className="admin-feedback" role="status">{notice}</p>}
        {blocked && <p className="admin-feedback admin-feedback--error" role="alert">{blocked}</p>}
        <div className="po-review">
          <p><strong>Status: {order.status}</strong> · Version {order.version}</p>
          <dl className="po-detail-grid">
            <div><dt>Vendor</dt><dd>{order.vendorName}</dd></div><div><dt>Storage location</dt><dd>{order.locationName}</dd></div>
            <div><dt>PO date</dt><dd>{date(order.poDate)}</dd></div><div><dt>Expected delivery</dt><dd>{date(order.expectedDate)}</dd></div>
            <div><dt>Created</dt><dd>{timestamp(order.createdAt, true)}</dd></div><div><dt>Last updated</dt><dd>{timestamp(order.updatedAt, true)}</dd></div>
            {order.deletedAt && <div><dt>Deleted</dt><dd>{timestamp(order.deletedAt, true)}</dd></div>}
          </dl>
          <TaxBasis basis={order.taxBasis} />
        </div>
        <LineTable lines={order.lines} figures={order} />
        {order.status === 'open' && <div className="po-form-footer"><div className="po-actions">
          <button type="button" className="admin-button" disabled={Boolean(blocked) || Boolean(pending)} onClick={() => { setRetry(loadOrderMutation(id)); setEditing(true); setNotice(''); }} data-testid="button-edit-po">Edit purchase order</button>
          <button type="button" className="admin-button admin-button--secondary" disabled={Boolean(blocked) || pending?.operation === 'edit'} onClick={() => { setDeleting(true); setNotice(''); }} data-testid="button-delete-po">{pending?.operation === 'delete' ? 'Reconcile deletion' : 'Delete purchase order'}</button>
        </div></div>}
        <div className="po-review"><button type="button" className="admin-button admin-button--secondary" onClick={reload}>Reload latest order</button></div>
      </section>}
    {deleting && order && <PurchaseOrderDeleteDialog key={id} order={order} onClose={() => { setDeleting(false); setRetry(loadOrderMutation(id)); }} onDeleted={(saved) => { setOrder(saved); setDeleting(false); setRetry(loadOrderMutation(id)); setNotice('Purchase order deleted.'); requestAnimationFrame(() => allOrdersButton.current?.focus()); }} />}
  </div></AdminLayout>;
}
