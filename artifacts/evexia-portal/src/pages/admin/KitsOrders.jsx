import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Link } from 'wouter';
import { Eye, PackageOpen, Plus, Search } from 'lucide-react';
import AdminLayout from '../../components/admin/AdminLayout.jsx';
import { useAdminDateFormatters } from '../../components/admin/adminPreferences.js';
import DataTable from '../../components/admin/DataTable.jsx';
import TablePagination from '../../components/admin/TablePagination.jsx';
import OrderListingFilters from '../../components/admin/OrderListingFilters.jsx';
import OrderTransfers from '../../components/admin/OrderTransfers.jsx';
import useTablePagination from '../../hooks/useTablePagination.js';
import { DOCTORS, MRS, PAYMENT_STATUSES, STATUSES, demoStore, filterOrders, productSummary } from '../../services/kitsOrdersDemo.js';
import '../../kitsOrders.css';

const BASE = '/admin/orders/kits-consumables';
const EMPTY = { search: '', from: '', to: '', doctorId: '', statuses: [], paymentStatus: '' };

export default function KitsOrders() {
  const { date } = useAdminDateFormatters();
  const snap = useSyncExternalStore(demoStore.subscribe, demoStore.getSnapshot, demoStore.getSnapshot);
  const [draft, setDraft] = useState(EMPTY);
  const [applied, setApplied] = useState(EMPTY);
  const rows = useMemo(() => filterOrders(snap.orders, applied), [snap.orders, applied]);
  const pager = useTablePagination(rows);
  const { resetPage } = pager;
  useEffect(() => { resetPage(); }, [applied]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (patch) => setDraft((d) => ({ ...d, ...patch }));
  const reset = () => { setDraft(EMPTY); setApplied(EMPTY); resetPage(); };
  const apply = (e) => { e?.preventDefault(); setApplied({ ...draft }); };

  const columns = [
    { key: 'sr', label: 'Sr. No.', render: (o) => rows.indexOf(o) + 1 },
    { key: 'number', label: 'Order', render: (o) => <><strong>{o.number}</strong><span className="kits-sub">{date(o.date)}</span></> },
    { key: 'items', label: 'Order details', render: (o) => productSummary(o) },
    { key: 'who', label: 'Doctor / MR', render: (o) => <>{DOCTORS.find((d) => d.id === o.doctorId)?.name || '-'}<span className="kits-sub">{o.orderFor === 'mr' ? 'MR order' : 'Doctor order'}</span>{o.mrId && <span className="kits-sub">MR: {MRS.find((m) => m.id === o.mrId)?.name || '-'}</span>}</> },
    { key: 'status', label: 'Status', render: (o) => <span className="kits-pill">{o.status}</span> },
    { key: 'pay', label: 'Payment status', render: (o) => <span className="kits-pill">{o.paymentStatus}</span> },
    { key: 'act', label: 'Action', render: (o) => <Link href={`${BASE}/${o.id}`} className="admin-icon-button" aria-label={`View ${o.number}`} data-testid={`kits-view-${o.id}`}><Eye size={16} aria-hidden="true" /></Link> },
  ];

  return <AdminLayout title="KITS & CONSUMABLES"><div className="kits">
    <div className="admin-page-head">
      <div><p className="admin-page-head__eyebrow">Orders</p><h1>Kits &amp; Consumables</h1>
        <p className="admin-page-head__description">Skin prick kits, lancets, applicators and trays ordered for doctors and MRs.</p></div>
      <div className="kits-actions-top">
        <Link href={`${BASE}/new`} className="admin-button" data-testid="kits-add"><Plus size={16} aria-hidden="true" />Add Order</Link>
      </div>
    </div>
    {snap.notice && <div className="kits-notice" role="status" data-testid="kits-notice"><span>{snap.notice}</span><button type="button" className="kits-link" onClick={() => demoStore.setNotice('')} data-testid="kits-notice-dismiss">Dismiss</button></div>}
    <OrderTransfers kind="kits" rows={rows} snapshot={snap} store={demoStore} />
    <section className="admin-panel kits-panel" aria-label="Kits and consumables orders" style={{ padding: 0 }}>
      <OrderListingFilters onRefresh={() => demoStore.refresh()} onReset={reset} resetTestId="kits-reset" onApply={apply} applyTestId="kits-apply" search={
        <label className="kits-field" style={{ flex: '2 1 220px' }}>Search
          <span style={{ position: 'relative', display: 'block' }}><Search size={15} aria-hidden="true" style={{ position: 'absolute', left: 12, top: 12, color: 'var(--admin-muted)' }} />
            <input style={{ paddingLeft: 34, width: '100%' }} value={draft.search} onChange={(e) => set({ search: e.target.value })} placeholder="Order, doctor, MR or product" data-testid="kits-filter-search" /></span></label>
      }>
        <label className="kits-field">From<input type="date" value={draft.from} max={draft.to || undefined} onChange={(e) => set({ from: e.target.value })} data-testid="kits-filter-from" /></label>
        <label className="kits-field">To<input type="date" value={draft.to} min={draft.from || undefined} onChange={(e) => set({ to: e.target.value })} data-testid="kits-filter-to" /></label>
        <label className="kits-field">Doctor<select value={draft.doctorId} onChange={(e) => set({ doctorId: e.target.value })} data-testid="kits-filter-doctor"><option value="">All</option>{DOCTORS.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
        <label className="kits-field">Payment status<select value={draft.paymentStatus} onChange={(e) => set({ paymentStatus: e.target.value })} data-testid="kits-filter-payment"><option value="">All</option>{PAYMENT_STATUSES.map((s) => <option key={s}>{s}</option>)}</select></label>
        <label className="kits-field">Order status<select value={draft.statuses[0] || ''} onChange={(e) => set({ statuses: e.target.value ? [e.target.value] : [] })} data-testid="kits-filter-status"><option value="">All</option>{STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}</select></label>
      </OrderListingFilters>
      <DataTable columns={columns} rows={pager.pageRows} rowKey={(o) => o.id} label="Kits and consumables orders (scrolls horizontally)" testIdPrefix="kits"
        empty={<div className="kits-empty" data-testid="kits-empty"><PackageOpen size={28} aria-hidden="true" /><strong>{snap.orders.length ? 'No orders match' : 'No orders yet'}</strong><p>{snap.orders.length ? 'Adjust the filters and apply again.' : 'Add a demo order to begin.'}</p>{snap.orders.length ? <button type="button" className="admin-button admin-button--secondary" onClick={reset}>Reset filters</button> : null}</div>} />
      <TablePagination page={pager.page} pageCount={pager.pageCount} pageSize={pager.pageSize} filtered={rows.length} total={snap.orders.length} label="orders" testId="kits-count" onPageChange={pager.setPage} onPageSizeChange={pager.setPageSize} />
    </section>
  </div></AdminLayout>;
}
