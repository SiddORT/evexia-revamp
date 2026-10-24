import { useEffect, useState } from 'react';
import { reviewLabel } from '../../components/orders/OrderReviewStatus.jsx';
import { useOrderListFreshness } from '../../services/orderFreshness.js';
import { Link } from 'wouter';
import { Eye, Pencil, Plus, Search } from 'lucide-react';
import { useAuditColumns, withAuditColumns } from '../../components/orders/orderAuditColumns.jsx';
import AdminLayout, { useOrderBase, useOrderActions, useOrderPortal } from '../../components/orders/OrderPortalContext.jsx';
import { useAdminDateFormatters } from '../../components/admin/adminPreferences.js';
import DataTable from '../../components/admin/DataTable.jsx';
import TablePagination from '../../components/admin/TablePagination.jsx';
import OrderListingFilters from '../../components/admin/OrderListingFilters.jsx';
import OrderTransfers from '../../components/admin/OrderTransfers.jsx';
import OrderCountSummary from '../../components/orders/OrderCountSummary.jsx';
import KitsReferenceSelect from '../../components/admin/KitsReferenceSelect.jsx';
import { request, STATUSES, PAYMENT_STATUSES } from '../../services/serverKits.js';
import { createKitsTransferAdapter } from '../../services/kitsTransfers.js';
import '../../kitsOrders.css';

const EMPTY = { search: '', from_date: '', to_date: '', doctor_id: '', mr_id: '', patient_id: '', status: '', payment_status: '', order_for: '' };

function OrderItemDetails({ order }) {
  const kit = order.kit;
  const consumables = [['lancets', 'Lancets'], ['applicators', 'Applicators'], ['tray', 'Tray']]
    .filter(([key]) => order[key]);
  return <ul className="kits-listing__items" role="list">
    {kit?.product && <li className="kits-listing__kit">
      <strong>Stallergo Skin Prick Kit</strong>
      <dl className="kits-listing__kit-facts">
        <div><dt>Configuration:</dt><dd>{kit.product}
          {kit.product === 'Customized' && kit.custom && <span className="kits-listing__custom">{kit.custom}</span>}
        </dd></div>
        <div><dt>Volume:</dt><dd>{kit.volume} ml</dd></div>
        <div><dt>Qty:</dt><dd>{kit.quantity}</dd></div>
      </dl>
    </li>}
    {consumables.length > 0 && <li>
      <dl className="kits-listing__consumables">
        {consumables.map(([key, label]) => <div key={key}>
          <dt>{label} Qty:</dt><dd>{order[key]}</dd>
        </div>)}
      </dl>
    </li>}
  </ul>;
}

export default function KitsOrders() {
  const can = useOrderActions('kits');
  const BASE = useOrderBase('kits-consumables');
  const { date } = useAdminDateFormatters();
  const [draft, setDraft] = useState(EMPTY), [applied, setApplied] = useState(EMPTY);
  const [result, setResult] = useState({ items: [], total: 0, filtered: null, nextCursor: null });
  const [page, setPage] = useState(1), [pageSize, setPageSize] = useState(25), [cursors, setCursors] = useState([null]);
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [revision, setRevision] = useState(0);
  const resetPage = () => { setPage(1); setCursors([null]); };
  const refresh = () => { resetPage(); setRevision((n) => n + 1); };
  useOrderListFreshness('kits', refresh);
  const reset = () => { setDraft(EMPTY); setApplied(EMPTY); resetPage(); };
  const set = (patch) => setDraft((v) => ({ ...v, ...patch }));
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(''); setResult((r) => ({ ...r, counts: null }));
    request('', { params: { ...applied, limit: pageSize, cursor: cursors[page - 1] }, signal: controller.signal })
      .then((data) => { if (!controller.signal.aborted) setResult(data); })
      .catch((e) => { if (!controller.signal.aborted) { setError(e.message); setResult((r) => ({ ...r, items: [], nextCursor: null })); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [applied, page, pageSize, revision]); // Cursor changes accompany page changes only.
  const changePage = (next) => {
    if (loading || next < 1) return;
    if (next === page + 1 && result.nextCursor) setCursors((current) => { const c = [...current]; c[page] = result.nextCursor; return c; });
    else if (next > 1 && !cursors[next - 1]) return;
    setPage(next);
  };
  const { portal } = useOrderPortal();
  const audit = useAuditColumns(portal);
  const baseColumns = [
    { key: 'sr', label: 'Sr. No.', render: (_o, i) => i + 1 },
    { key: 'number', label: 'Order', render: (o) => <><strong>{o.number}</strong><span className="kits-sub">{date(o.date)}</span></> },
    { key: 'items', label: 'Order details', render: (o) => <OrderItemDetails order={o} /> },
    { key: 'who', label: 'Doctor / MR / Patient', render: (o) => <>{o.doctor.name}<span className="kits-sub">{o.orderFor === 'mr' ? 'MR order' : 'Doctor order'}</span><span className="kits-sub">MR: {o.mr?.name || 'Not selected'}</span><span className="kits-sub">Patient: {o.patient?.name || 'Not selected'}</span></> },
    { key: 'status', label: 'Status', render: (o) => <span className="kits-pill">{reviewLabel(o)}</span> },
    { key: 'pay', label: 'Payment status', render: (o) => <span className="kits-pill">{o.paymentStatus}</span> },
    { key: 'act', label: 'Action', render: (o) => <div className="kits-actions"><Link href={`${BASE}/${o.id}`} className="admin-icon-button order-view-action" aria-label={`View ${o.number}`}><Eye size={16} aria-hidden="true" /></Link>{(can.protected || (portal === 'mr' && can.edit && o.mrEditable)) && <Link href={`${BASE}/${o.id}/edit`} className="admin-icon-button order-view-action" aria-label={`Edit ${o.number}`}><Pencil size={16} aria-hidden="true" /></Link>}</div> },
  ];
  const columns = withAuditColumns(baseColumns, audit);

  return <AdminLayout title="KITS & CONSUMABLES"><div className="kits kits-listing">
    <OrderTransfers kind="kits" rows={result.items} adapter={createKitsTransferAdapter(applied, refresh)} total={result.filtered ?? result.total}
      renderActions={(actions) => <div className="admin-page-head">
        <div><p className="admin-page-head__eyebrow">Orders</p><h1>Kits &amp; Consumables</h1><p className="admin-page-head__description">Skin prick kits, lancets, applicators and trays ordered for doctors and MRs.</p></div>
        <div className="kits-actions-top">{actions}{can.add && <Link href={`${BASE}/new`} className="admin-button" data-testid="kits-add"><Plus size={16} aria-hidden="true" />Add Order</Link>}</div>
      </div>} />
    <OrderCountSummary statuses={STATUSES} total={result.total} counts={result.counts} loading={loading} />
    <section className="admin-panel kits-panel kits-listing__panel" aria-label="Kits and consumables orders">
      <OrderListingFilters masterDisclosure refreshLabel="Refresh saved orders" onRefresh={refresh} onReset={reset}
        onApply={(e) => { e.preventDefault(); setApplied({ ...draft }); resetPage(); }} search={
          <label className="kits-field"><span className="kits-listing__search-control"><Search size={16} aria-hidden="true" /><input aria-label="Search" maxLength={200} value={draft.search} onChange={(e) => set({ search: e.target.value })} placeholder="Order, person, product or remarks" /></span></label>
        }>
        <label className="kits-field">From<input type="date" value={draft.from_date} max={draft.to_date || undefined} onChange={(e) => set({ from_date: e.target.value })} /></label>
        <label className="kits-field">To<input type="date" value={draft.to_date} min={draft.from_date || undefined} onChange={(e) => set({ to_date: e.target.value })} /></label>
        {[['doctors', 'doctor_id', 'Doctor'], ['mrs', 'mr_id', 'MR'], ['patients', 'patient_id', 'Patient']].map(([kind, key, label]) => <KitsReferenceSelect key={key} id={`kits-filter-${key}`} kind={kind} label={label} value={draft[key]} onChange={(id) => set({ [key]: id })} />)}
        <label className="kits-field">Payment status<select value={draft.payment_status} onChange={(e) => set({ payment_status: e.target.value })}><option value="">All</option>{PAYMENT_STATUSES.map((s) => <option key={s}>{s}</option>)}</select></label>
        <label className="kits-field">Order status<select value={draft.status} onChange={(e) => set({ status: e.target.value })}><option value="">All</option>{STATUSES.map((s) => <option key={s}>{s}</option>)}</select></label>
        <label className="kits-field">Order for<select value={draft.order_for} onChange={(e) => set({ order_for: e.target.value })}><option value="">All</option><option value="doctor">Doctor</option><option value="mr">MR</option></select></label>
      </OrderListingFilters>
      {loading ? <div className="kits-listing__state" role="status"><strong>Loading saved orders…</strong><p>Fetching this server section using the applied filters.</p></div>
        : error ? <div className="kits-listing__state kits-listing__state--error" role="alert"><strong>Orders unavailable</strong><p>{error}</p><button type="button" className="admin-button admin-button--secondary" onClick={refresh}>Retry loading orders</button></div>
        : <>
          <DataTable columns={columns} rows={result.items} rowOffset={(page - 1) * pageSize} rowKey={(o) => o.id} label="Kits orders (scrolls horizontally)" testIdPrefix="kits"
            empty={<div className="kits-listing__state"><strong>{result.total === 0 ? 'No saved orders yet' : 'No matching orders in this section'}</strong><p>{result.nextCursor ? 'Continue to the next section to search more saved records, or adjust the filters.' : result.total === 0 ? 'Use Add Order to create a kits and consumables order.' : 'Try a different search or reset the filters to browse saved orders.'}</p></div>} />
          <TablePagination cursorMode sectionCount={result.items.length} page={page} pageCount={page + (result.nextCursor ? 1 : 0)} pageSize={pageSize}
            filtered={result.filtered} total={result.total} label="orders" testId="kits-count" onPageChange={changePage} onPageSizeChange={(size) => { setPageSize(size); resetPage(); }} />
        </>}
    </section>
  </div></AdminLayout>;
}
