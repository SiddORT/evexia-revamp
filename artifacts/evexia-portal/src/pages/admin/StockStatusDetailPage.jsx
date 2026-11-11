import { useEffect, useRef, useState } from 'react';
import { Link } from 'wouter';
import { useHistoryState } from 'wouter/use-browser-location';
import { ArrowLeft, BookOpen, RefreshCw } from 'lucide-react';
import AdminLayout from '../../components/admin/AdminLayout.jsx';
import StockStatusDetail from '../../components/admin/StockStatusDetail.jsx';
import StockLedger from '../../components/admin/StockLedger.jsx';
import { useAdminSession } from '../../auth/AdminBoundary.jsx';
import { useResourceActions } from '../../auth/useMasterActions.js';
import { listStock } from '../../services/serverInventory.js';
import { STOCK_PRODUCT_ID, STOCK_STATUS_PATH, stockListContext } from '../../services/stockStatusNavigation.js';
import '../../stockStatus.css';
import '../../inventoryServer.css';

export default function StockStatusDetailPage({ id }) {
  const can = useResourceActions('stock_status');
  const { user } = useAdminSession();
  const historyState = useHistoryState();
  const context = stockListContext(historyState, user?.id);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState({ loading: true, data: null, error: '', status: 0 });
  const [ledger, setLedger] = useState(false);
  const ledgerButton = useRef(null);
  const heading = useRef(null);
  const valid = STOCK_PRODUCT_ID.test(id);

  useEffect(() => { heading.current?.focus(); }, [id]);
  useEffect(() => {
    if (!valid || !can.read) return undefined;
    const controller = new AbortController();
    setLedger(false);
    setState({ loading: true, data: null, error: '', status: 0 });
    // A normal, identity-filtered read does not require export permission.
    listStock({ product_ids: [id], stock_status: 'all', offset: 0, limit: 1 }, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setState({ loading: false, data, error: '', status: 0 });
      })
      .catch((error) => {
        if (!controller.signal.aborted) setState({ loading: false, data: null, error: error.message || 'Stock details could not be loaded.', status: error.status });
      });
    return () => controller.abort();
  }, [id, valid, can.read, attempt]);

  const data = state.data;
  const complete = data?.coverage?.complete === true;
  const items = Array.isArray(data?.items) ? data.items : null;
  const row = complete && items?.length === 1 && typeof items[0]?.productId === 'string' && items[0].productId.toLowerCase() === id.toLowerCase() ? items[0] : null;
  const missing = complete && items?.length === 0 && data.filtered === 0;
  const detailsAvailable = row && data.asOf && row.quantity != null && row.quantity !== '' && Array.isArray(row.lots);
  const canLedger = can.read && can.protected && detailsAvailable && row.itemKind === 'allergen';
  const retry = <button type="button" className="admin-button admin-button--secondary" onClick={() => setAttempt((value) => value + 1)}>Retry</button>;
  return <AdminLayout title="Stock details"><div className="stock-page stock-detail-page">
    <div className="admin-page-head">
      <div><p className="admin-page-head__eyebrow">Inventory / Stock Status / Details</p>
        <h1 ref={heading} tabIndex={-1}>{row?.name || 'Stock details'}</h1>
        {row && <p className="admin-page-head__description">{[row.itemKind === 'combo' ? 'Assembled combo' : 'Individual allergen', row.concentration, row.category].filter(Boolean).join(' · ')}</p>}
      </div>
      <div className="stock-actions">
        <Link href={STOCK_STATUS_PATH} state={context ? { stockStatusList: context } : null} className="admin-button admin-button--secondary" data-testid="link-back-stock-status"><ArrowLeft size={15} aria-hidden="true" /> Back to Stock Status</Link>
        {canLedger && <button ref={ledgerButton} type="button" className="admin-button" onClick={() => setLedger(true)} data-testid={`button-ledger-stock-${row.productId}`}><BookOpen size={15} aria-hidden="true" /> Ledger</button>}
        {valid && can.read && <button type="button" className="admin-button admin-button--secondary" disabled={state.loading} onClick={() => setAttempt((value) => value + 1)}><RefreshCw size={15} aria-hidden="true" /> Refresh</button>}
      </div>
    </div>
    {!can.read ? <div className="admin-feedback admin-feedback--error" role="alert">Permission denied. Your saved role does not allow Stock Status access.</div>
      : !valid ? <div className="admin-feedback admin-feedback--error" role="alert">Invalid product reference. Open a product from Stock Status.</div>
      : state.loading ? <div className="admin-panel admin-empty" role="status">Loading product stock…</div>
      : state.error ? <div className="admin-feedback admin-feedback--error inv-banner" role="alert"><p>{state.status === 403 ? 'Permission denied. Your saved role does not allow this stock read.' : state.error}</p>{retry}</div>
      : !complete ? <div className="admin-feedback admin-feedback--error inv-banner" role="alert"><p><strong>Inventory coverage is incomplete or unavailable.</strong> Stock quantities and product availability cannot be confirmed. No quantity is shown; unavailable data is not zero stock.</p>{data?.coverage?.pendingReceipts > 0 && <p>{data.coverage.pendingReceipts} receipt(s) await inventory initialization. Retrying does not initialize receipts.</p>}{retry}</div>
      : missing ? <div className="admin-panel admin-empty" role="status"><strong>Product not found</strong><p>This product is not in the current authorized stock view. It may no longer be available.</p></div>
      : !detailsAvailable ? <div className="admin-feedback admin-feedback--error inv-banner" role="alert"><p>Stock details are incomplete. Quantity is unavailable; no zero balance has been inferred.</p>{retry}</div>
      : <StockStatusDetail key={`${id}/${attempt}`} row={row} asOf={data.asOf} coverage={data.coverage} />}
    {ledger && canLedger && <StockLedger key={row.productId} row={row} returnFocusRef={ledgerButton} onClose={() => setLedger(false)} />}
  </div></AdminLayout>;
}
