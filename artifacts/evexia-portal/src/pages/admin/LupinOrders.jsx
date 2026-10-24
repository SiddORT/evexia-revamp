import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import { Eye, Plus, Search } from 'lucide-react';
import AdminLayout, { useOrderBase, useOrderPortal, useOrderActions } from '../../components/orders/OrderPortalContext.jsx';
import { useAdminDateFormatters } from '../../components/admin/adminPreferences.js';
import DataTable from '../../components/admin/DataTable.jsx';
import TablePagination from '../../components/admin/TablePagination.jsx';
import OrderListingFilters from '../../components/admin/OrderListingFilters.jsx';
import OrderTransfers from '../../components/admin/OrderTransfers.jsx';
import KitsReferenceSelect from '../../components/admin/KitsReferenceSelect.jsx';
import { request, STATUSES, PAYMENT_STATUSES, amountMoney } from '../../services/serverLupin.js';
import { createLupinTransferAdapter } from '../../services/lupinTransfers.js';
import '../../lupinOrders.css';
import '../../components/orders/orderListingLayout.css';

const EMPTY = { search: '', from_date: '', to_date: '', doctor_id: '', mr_id: '', patient_id: '', status: '', payment_status: '' };
export default function LupinOrders() {
  const can = useOrderActions('lupin');
  const BASE = useOrderBase('lupin');
  const { mr } = useOrderPortal();
  const { date } = useAdminDateFormatters();
  const [draft, setDraft] = useState(EMPTY), [applied, setApplied] = useState(EMPTY);
  const [result, setResult] = useState({ items: [], total: 0, filtered: null, nextCursor: null });
  const [page, setPage] = useState(1), [pageSize, setPageSize] = useState(25), [cursors, setCursors] = useState([null]);
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [revision, setRevision] = useState(0);
  const resetPage = () => { setPage(1); setCursors([null]); };
  const refresh = () => { resetPage(); setRevision((n) => n + 1); };
  const reset = () => { setDraft(EMPTY); setApplied(EMPTY); resetPage(); setRevision((n) => n + 1); };
  const set = (patch) => setDraft((v) => ({ ...v, ...patch }));
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    request('', { params: { ...applied, limit: pageSize, cursor: cursors[page - 1] }, signal: controller.signal })
      .then((data) => { if (!controller.signal.aborted) setResult(data); })
      .catch((e) => { if (!controller.signal.aborted) { setError(e.message); setResult((r) => ({ ...r, items: [], nextCursor: null })); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [applied, page, pageSize, revision]); // Cursors change together with page only.
  const changePage = (next) => {
    if (loading || next < 1) return;
    if (next === page + 1 && result.nextCursor) setCursors((current) => { const c = [...current]; c[page] = result.nextCursor; return c; });
    else if (next > 1 && !cursors[next - 1]) return;
    setPage(next);
  };
  const columns = [
    { key: 'sn', label: 'S.No', render: (_o, i) => i + 1 },
    { key: 'order', label: 'Order details', render: (o) => <><strong>{o.number}</strong><span className="lupin-sub">{date(o.date)}</span><span className="lupin-sub">{o.patientCount} patients, {amountMoney(o.total)}</span></> },
    { key: 'dm', label: 'Doctor / MR', render: (o) => <>{o.doctor.name}<span className="lupin-sub">{o.mr.name}</span></> },
    { key: 'status', label: 'Order status', render: (o) => <span className="lupin-pill">{o.status}</span> },
    { key: 'pay', label: 'Payment status', render: (o) => <span className={`lupin-pill${o.paymentStatus === 'Unpaid' ? ' lupin-pill--unpaid' : ''}`}>{o.paymentStatus}</span> },
    { key: 'act', label: 'Action', render: (o) => <Link href={`${BASE}/${o.id}`} className="admin-icon-button" aria-label={`View ${o.number}`} data-testid={`link-lupin-view-${o.id}`}><Eye size={16} aria-hidden="true" /></Link> },
  ];
  return <AdminLayout title="LUPIN"><div className="lupin lupin-listing">
    <OrderTransfers kind="lupin" rows={result.items} adapter={createLupinTransferAdapter(applied, refresh)} total={loading || error ? undefined : result.filtered ?? result.total}
      renderActions={(actions) => <div className="admin-page-head">
        <div><p className="admin-page-head__eyebrow">Orders</p><h1>Order Management – Lupin</h1><p className="admin-page-head__description">Review saved Lupin orders by Doctor, MR and status.</p></div>
        <div className="lupin-actions">{actions}{can.add && <Link href={`${BASE}/new`} className="admin-button" data-testid="link-lupin-add"><Plus size={16} aria-hidden="true" />Add Order</Link>}</div>
      </div>} />
    <section className="admin-panel" aria-label="Lupin orders">
      <OrderListingFilters masterDisclosure disclosureLabel="Additional filters" refreshLabel="Refresh saved orders" onRefresh={refresh} onReset={reset}
        resetTestId="button-lupin-reset" applyTestId="button-lupin-apply"
        onApply={(e) => { e.preventDefault(); setApplied({ ...draft }); resetPage(); }} search={
          <label className="lupin-field"><span className="lupin-search-control"><Search size={16} aria-hidden="true" /><input aria-label="Search" maxLength={200} value={draft.search} onChange={(e) => set({ search: e.target.value })} placeholder="Order, Doctor, MR, linked Patient or remarks" data-testid="input-lupin-search" /></span></label>
        }>
        <label className="lupin-field">From<input type="date" value={draft.from_date} max={draft.to_date || undefined} onChange={(e) => set({ from_date: e.target.value })} /></label>
        <label className="lupin-field">To<input type="date" value={draft.to_date} min={draft.from_date || undefined} onChange={(e) => set({ to_date: e.target.value })} /></label>
        {[['doctors', 'doctor_id', 'Doctor'], ...(!mr ? [['mrs', 'mr_id', 'MR']] : []), ['patients', 'patient_id', 'Linked Patient (optional)']].map(([kind, key, label]) => <KitsReferenceSelect key={key} id={`lupin-filter-${key}`} kind={kind} label={label} value={draft[key]} onChange={(id) => set({ [key]: id })} requester={request} fieldClass="lupin-field" />)}
        <label className="lupin-field">Order status<select value={draft.status} onChange={(e) => set({ status: e.target.value })}><option value="">All</option>{STATUSES.map((s) => <option key={s}>{s}</option>)}</select></label>
        <label className="lupin-field">Payment status<select value={draft.payment_status} onChange={(e) => set({ payment_status: e.target.value })}><option value="">All</option>{PAYMENT_STATUSES.map((s) => <option key={s}>{s}</option>)}</select></label>
      </OrderListingFilters>
      {loading ? <div className="lupin-empty" role="status"><strong>Loading saved orders…</strong></div>
        : error ? <div className="lupin-empty" role="alert"><strong>Orders unavailable</strong><p>{error}</p><button type="button" className="admin-button admin-button--secondary" onClick={refresh}>Retry loading orders</button></div>
          : <>
            <DataTable columns={columns} rows={result.items} rowOffset={(page - 1) * pageSize} rowKey={(o) => o.id} label="Lupin orders (scrolls horizontally)" testIdPrefix="lupin"
              empty={<div className="lupin-empty" data-testid="empty-lupin"><strong>{result.total === 0 ? 'No Lupin orders yet' : 'No matches in this section'}</strong><p>{result.nextCursor ? 'Continue to the next section or narrow your search.' : 'Adjust filters or add an order to begin.'}</p></div>} />
            <TablePagination cursorMode sectionCount={result.items.length} page={page} pageCount={page + (result.nextCursor ? 1 : 0)} pageSize={pageSize}
              filtered={result.filtered} total={result.total} label="orders" testId="text-lupin-count" onPageChange={changePage} onPageSizeChange={(size) => { setPageSize(size); resetPage(); }} />
          </>}
    </section>
  </div></AdminLayout>;
}
