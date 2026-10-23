import { useEffect, useRef, useState } from 'react';
import { Link } from 'wouter';
import { ClipboardList, Plus, Search } from 'lucide-react';
import AdminLayout, { useOrderBase, useOrderPortal } from '../../components/orders/OrderPortalContext.jsx';
import { useAdminDateFormatters } from '../../components/admin/adminPreferences.js';
import DataTable from '../../components/admin/DataTable.jsx';
import OrderListingFilters from '../../components/admin/OrderListingFilters.jsx';
import OrderTransfers from '../../components/admin/OrderTransfers.jsx';
import TablePagination from '../../components/admin/TablePagination.jsx';
import SptReferenceSelect from '../../components/admin/SptReferenceSelect.jsx';
import { request } from '../../services/serverSpt.js';
import { createSptTransferAdapter } from '../../services/sptTransfers.js';
import '../../sptOrders.css';

const EMPTY = { search: '', status: '', from_date: '', to_date: '', doctor_id: '', mr_id: '', patient_id: '' };

export default function SptOrders() {
  const BASE = useOrderBase('spt');
  const { mr } = useOrderPortal();
  const { date } = useAdminDateFormatters();
  const [draft, setDraft] = useState(EMPTY), [applied, setApplied] = useState(EMPTY);
  const [result, setResult] = useState({ items: [], total: 0, filtered: null, nextCursor: null });
  const [page, setPage] = useState(1), [pageSize, setPageSize] = useState(25), [cursors, setCursors] = useState([null]);
  const [offsets, setOffsets] = useState([0]);
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [revision, setRevision] = useState(0);
  const sequence = useRef(0);
  const resetPage = () => { setPage(1); setCursors([null]); setOffsets([0]); };
  const refresh = () => { resetPage(); setRevision((n) => n + 1); };
  const clear = () => { setDraft(EMPTY); setApplied(EMPTY); resetPage(); };
  const set = (patch) => setDraft((v) => ({ ...v, ...patch }));
  useEffect(() => {
    const token = ++sequence.current, controller = new AbortController();
    setLoading(true); setError('');
    request('', { params: { ...applied, limit: pageSize, cursor: cursors[page - 1] }, signal: controller.signal })
      .then((data) => { if (!controller.signal.aborted && token === sequence.current) setResult(data); })
      .catch((e) => { if (!controller.signal.aborted && token === sequence.current) { setError(e.message); setResult((r) => ({ ...r, items: [], nextCursor: null })); } })
      .finally(() => { if (!controller.signal.aborted && token === sequence.current) setLoading(false); });
    return () => { controller.abort(); sequence.current++; };
  }, [applied, page, pageSize, revision]); // Cursors change together with page.
  const changePage = (next) => {
    if (loading || next < 1) return;
    if (next === page + 1 && result.nextCursor) {
      setCursors((current) => { const copy = [...current]; copy[page] = result.nextCursor; return copy; });
      setOffsets((current) => { const copy = [...current]; copy[page] = current[page - 1] + result.items.length; return copy; });
    }
    else if (next > 1 && !cursors[next - 1]) return;
    setPage(next);
  };

  const columns = [
    { key: 'sr', label: 'Sr. No.', render: (_o, i) => i + 1 },
    { key: 'number', label: 'Order no.', render: (o) => <strong>{o.number}</strong> },
    { key: 'date', label: 'Date', render: (o) => date(o.date) },
    { key: 'doctor', label: 'Doctor', render: (o) => o.doctorName || 'Not chosen' },
    { key: 'mr', label: 'MR', render: (o) => o.mrName || 'Not chosen' },
    { key: 'count', label: 'Patients', render: (o) => o.patients.length },
    { key: 'total', label: 'Total (INR)', render: (o) => <span className="spt-num">{o.total}</span> },
    { key: 'status', label: 'Status', render: (o) => <span className={`admin-badge${o.status === 'Draft' ? ' admin-badge--inactive' : ''}`}>{o.status}</span> },
    { key: 'action', label: 'Action', render: (o) => <Link className="spt-link" href={`${BASE}/${o.id}`} data-testid={`link-spt-open-${o.id}`}>{o.status === 'Draft' ? 'Resume' : 'Review'}<span className="sr-only"> {o.number}</span></Link> },
  ];

  return (
    <AdminLayout title="SPT">
      <div className="spt spt-listing">
        <OrderTransfers kind="spt" rows={result.items} adapter={createSptTransferAdapter(applied, refresh)} total={result.filtered ?? result.total}
          renderActions={(actions) => <div className="admin-page-head">
          <div>
            <p className="admin-page-head__eyebrow">Orders</p>
            <h1>SPT</h1>
            <p className="admin-page-head__description">Review SPT orders by doctor, MR and status.</p>
          </div>
          <div className="spt-actions-top">{actions}<Link href={`${BASE}/new`} className="admin-button" data-testid="link-spt-add-order"><Plus size={16} aria-hidden="true" />Add Order</Link></div>
        </div>} />
        <section className="admin-panel" aria-label="SPT orders">
          <OrderListingFilters masterDisclosure disclosureLabel="Additional filters" refreshLabel="Refresh SPT orders" onRefresh={refresh} onReset={clear}
            onApply={(e) => { e.preventDefault(); setApplied({ ...draft }); resetPage(); }} search={
            <label className="spt-field spt-field--grow">
              <span className="spt-search">
                <Search size={15} aria-hidden="true" />
                <input aria-label="Search orders" className="spt-input" maxLength={200} value={draft.search} onChange={(e) => set({ search: e.target.value })} placeholder="Order, Doctor, MR, patient or remarks" data-testid="input-spt-search" />
              </span>
            </label>
          }>
            <label className="spt-field">From<input type="date" className="spt-input" value={draft.from_date} max={draft.to_date || undefined} onChange={(e) => set({ from_date: e.target.value })} /></label>
            <label className="spt-field">To<input type="date" className="spt-input" value={draft.to_date} min={draft.from_date || undefined} onChange={(e) => set({ to_date: e.target.value })} /></label>
            {[['doctors', 'doctor_id', 'Doctor'], ...(!mr ? [['mrs', 'mr_id', 'MR']] : []), ['patients', 'patient_id', 'Patient']].map(([kind, key, label]) => <SptReferenceSelect key={key} id={`spt-filter-${key}`} kind={kind} label={label} value={draft[key]} onChange={(id) => set({ [key]: id })} />)}
            <div className="spt-field"><label htmlFor="spt-filter-status">Status</label>
              <select id="spt-filter-status" value={draft.status} onChange={(e) => set({ status: e.target.value })} data-testid="select-spt-status">
                <option value="">All</option><option>Draft</option><option>Saved</option>
              </select>
            </div>
          </OrderListingFilters>
          {loading ? <div className="spt-empty" role="status">Loading SPT orders…</div>
            : error ? <div className="spt-empty" role="alert"><strong>Orders unavailable</strong><p>{error}</p><button type="button" className="admin-button" onClick={refresh}>Retry</button></div>
              : <>
                <DataTable columns={columns} rows={result.items} rowOffset={offsets[page - 1]} rowKey={(o) => o.id} label="SPT orders (scrolls horizontally)" testIdPrefix="spt"
                  empty={<div className="spt-empty" data-testid="empty-spt-orders"><ClipboardList size={28} aria-hidden="true" /><strong>{result.total ? 'No matching orders in this section' : 'No SPT orders yet'}</strong><p>{result.nextCursor ? 'Continue to the next section to search more saved records.' : result.total ? 'Try different applied filters.' : 'Use Add Order to create a persistent SPT order.'}</p><Link href={`${BASE}/new`} className="admin-button">Add Order</Link></div>} />
                <TablePagination cursorMode sectionCount={result.items.length} page={page} pageCount={page + (result.nextCursor ? 1 : 0)}
                  pageSize={pageSize} filtered={result.filtered} total={result.total} label="orders" testId="spt-count"
                  onPageChange={changePage} onPageSizeChange={(size) => { setPageSize(size); resetPage(); }} />
              </>}
        </section>
      </div>
    </AdminLayout>
  );
}
