import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { Eye, Plus, Search } from 'lucide-react';
import AdminLayout from '../../components/admin/AdminLayout.jsx';
import DataTable from '../../components/admin/DataTable.jsx';
import TablePagination from '../../components/admin/TablePagination.jsx';
import InHousePendingBanner from '../../components/admin/InHousePendingBanner.jsx';
import InHouseStockDialog from '../../components/admin/InHouseStockDialog.jsx';
import { useAdminDateFormatters } from '../../components/admin/adminPreferences.js';
import { useAdminSession } from '../../auth/AdminBoundary.jsx';
import { isSuperAdminIdentity } from '../../auth/capabilities.js';
import { listInHouseStock, RESERVE_NOTE } from '../../services/inHouseStock.js';
import InHouseAccessDenied from './InHouseAccessDenied.jsx';
import '../../mr.css';
import '../../inventoryServer.css';
import '../../openingStock.css';

const BASE = '/admin/inventory/in-house-stock';

export default function InHouseStockList() {
  const { user } = useAdminSession();
  return isSuperAdminIdentity(user) ? <InHouseStockListInner /> : <InHouseAccessDenied />;
}

function InHouseStockListInner() {
  const [, navigate] = useLocation();
  const { date, timestamp } = useAdminDateFormatters();
  const [search, setSearch] = useState('');
  const [applied, setApplied] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [viewing, setViewing] = useState(null);
  const [tick, setTick] = useState(0);
  const seq = useRef(0);
  useEffect(() => { const t = setTimeout(() => { setApplied(search.trim()); setPage(1); }, 300); return () => clearTimeout(t); }, [search]);
  const load = useCallback(() => setTick((t) => t + 1), []);
  useEffect(() => {
    const id = ++seq.current; const c = new AbortController();
    setLoading(true); setError('');
    listInHouseStock({ query: applied, offset: (page - 1) * pageSize, limit: pageSize }, c.signal)
      .then((d) => { if (id === seq.current) { setData(d); setLoading(false); } })
      .catch((e) => { if (id === seq.current && !c.signal.aborted) { setError(e.message || 'In-house stock could not be loaded.'); setLoading(false); } });
    return () => c.abort();
  }, [applied, page, pageSize, tick]);
  const items = data?.items || [];
  const filtered = data?.filtered ?? 0;
  const pageCount = Math.max(1, Math.ceil(filtered / pageSize));
  useEffect(() => { if (!loading && !error && page > pageCount) setPage(pageCount); }, [loading, error, page, pageCount]);

  const columns = [
    { key: 'sr', label: 'Sr No', render: (_r, i) => i + 1 },
    { key: 'allergen', label: 'Allergen', render: (r) => <><strong className="admin-table__name">{r.allergenName}</strong><span className="stock-sub">{r.categoryName || 'Uncategorised'}</span></> },
    { key: 'conc', label: 'Concentration', render: (r) => r.concentration },
    { key: 'qty', label: 'Quantity', render: (r) => <span className="inv-mono">{r.quantity} {r.unit}</span> },
    { key: 'exp', label: 'Expiry', render: (r) => <>{date(r.expiryDate)}<span className="stock-sub" data-testid={`status-in-house-expiry-${r.id}`}>{r.expired ? 'Expired' : 'In date'}</span></> },
    { key: 'loc', label: 'Location', render: (r) => <>{r.locationName}{r.batch && <span className="stock-sub">Batch {r.batch}</span>}</> },
    { key: 'rec', label: 'Recorded', render: (r) => <>{timestamp(r.createdAt)}<span className="stock-sub">{r.actor}</span></> },
    { key: 'act', label: 'Actions', render: (r) => <div className="admin-table__actions">
      <button type="button" className="admin-icon-button" aria-label={`View details, ${r.allergenName}`} title="Details" onClick={() => setViewing(r)} data-testid={`button-view-in-house-${r.id}`}><Eye size={16} /></button></div> },
  ];
  return <AdminLayout title="In-house stock"><div className="opening-stock-master">
    <div className="admin-page-head"><div><p className="admin-page-head__eyebrow">Inventory / Reserve</p><h1>In-house stock</h1><p className="admin-page-head__description">{RESERVE_NOTE} Entries are append-only; no pricing, vendors or dilution.</p></div>
      <div className="admin-mr-head-actions"><button type="button" className="admin-button" onClick={() => navigate(`${BASE}/new`)} data-testid="button-add-in-house"><Plus size={16} /> Add in-house stock</button></div></div>
    <InHousePendingBanner onResolved={() => load()} />
    <section className="admin-panel" aria-label="In-house stock list">
      <div className="admin-toolbar">
        <button type="button" className="admin-button admin-button--secondary" disabled={loading} onClick={load} data-testid="button-refresh-in-house">Refresh</button>
        <label className="admin-search"><Search size={16} aria-hidden="true" /><span className="sr-only">Search in-house stock</span><input type="search" maxLength={200} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search allergen, batch or location" data-testid="input-search-in-house" /></label>
      </div>
      {error ? <div className="admin-empty" role="alert"><strong>In-house stock could not be loaded</strong><p>{error}</p><button type="button" className="admin-button" onClick={load} data-testid="button-retry-in-house">Try again</button></div> : <>
        <DataTable columns={columns} rows={items} rowOffset={(page - 1) * pageSize} rowKey={(r) => r.id} label="In-house stock" testIdPrefix="in-house" loading={loading}
          empty={<div className="admin-empty"><strong>{applied ? 'No in-house stock matches' : 'No in-house stock yet'}</strong><p>{applied ? 'Clear the search.' : 'Record reserve stock held in-house. It stays reserve only and is not order-ready.'}</p></div>} />
        <TablePagination page={page} pageSize={pageSize} pageCount={pageCount} filtered={filtered} total={data?.total ?? 0} label="in-house stock records" onPageChange={setPage} onPageSizeChange={(n) => { setPageSize(n); setPage(1); }} testId="text-in-house-count" /></>}
    </section>
    {viewing && <InHouseStockDialog id={viewing.id} initial={viewing} onClose={() => setViewing(null)} />}
  </div></AdminLayout>;
}
