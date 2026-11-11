import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import { RefreshCw } from 'lucide-react';
import AdminLayout from '../../components/admin/AdminLayout.jsx';
import DataTable from '../../components/admin/DataTable.jsx';
import TablePagination from '../../components/admin/TablePagination.jsx';
import { useResourceActions } from '../../auth/useMasterActions.js';
import { useAdminDateFormatters } from '../../components/admin/adminPreferences.js';
import { listLowStock } from '../../services/serverLowStock.js';
import '../../stockStatus.css';

export default function LowStockAlerts() {
  const can = useResourceActions('stock_status');
  const po = useResourceActions('purchase_order');
  const { timestamp } = useAdminDateFormatters();
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [refresh, setRefresh] = useState(0);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => { setQuery(search.trim()); setPage(1); }, 300);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    const controller = new AbortController();
    setData(null); setLoading(true); setError('');
    if (!can.read) { setLoading(false); return () => controller.abort(); }
    listLowStock({ query, offset: (page - 1) * pageSize, limit: pageSize }, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        const last = Math.max(1, Math.ceil(result.filtered / pageSize));
        if (page > last) { setPage(last); return; }
        setData(result); setLoading(false);
      }).catch((cause) => { if (!controller.signal.aborted) { setError(cause.message || 'Low-stock inventory is unavailable.'); setLoading(false); } });
    return () => controller.abort();
  }, [can.read, query, page, pageSize, refresh]);
  const columns = [
    { key: 'name', label: 'Material', render: (r) => <><strong>{r.name}</strong><span className="stock-sub">{r.productId}</span></> },
    { key: 'category', label: 'Category', render: (r) => r.category },
    { key: 'quantity', label: 'Usable stock', render: (r) => <>{r.quantity} {r.unit}</> },
    { key: 'thresholdLimit', label: 'Configured threshold', render: (r) => r.thresholdLimit === null ? 'Not set' : `${r.thresholdLimit} ${r.unit}` },
    { key: 'reason', label: 'Alert reason', render: (r) => r.reason },
    { key: 'action', label: 'Action', render: (r) => po.add
      ? <Link className="admin-button admin-button--secondary" aria-label={`Create PO for ${r.name}`} href={`/admin/inventory/purchase-orders/new?material=${encodeURIComponent(r.productId)}`}>Create PO</Link>
      : <span>PO add permission required</span> },
  ];
  return <AdminLayout title="Low Stock Alerts"><div className="stock-page">
    <div className="admin-page-head"><div><p className="admin-page-head__eyebrow">Inventory</p><h1>Low Stock Alerts</h1>
      <p className="admin-page-head__description">Purchasable active materials with no usable stock, or usable stock at or below their saved threshold. Reserve-only stock and assembled combos are excluded. Creating a PO does not change stock.</p></div></div>
    {!can.read ? <p role="alert">Stock access is required to view low-stock alerts.</p> : <section className="admin-panel stock-panel" aria-busy={loading}>
      <div className="stock-toolbar"><button type="button" className="admin-button admin-button--secondary" disabled={loading} onClick={() => setRefresh((n) => n + 1)}><RefreshCw size={16} aria-hidden="true" /> Refresh</button>
        <div className="admin-filter"><label htmlFor="low-stock-search">Search materials</label><input id="low-stock-search" className="admin-input" type="search" maxLength={200} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Material, category or ID" /></div></div>
      {loading ? <p className="admin-empty" role="status">Loading authoritative usable inventory…</p>
        : error ? <div className="admin-feedback admin-feedback--error" role="alert"><p>{error}</p><p>No stock quantities or empty alert result have been inferred.</p><button type="button" className="admin-button" onClick={() => setRefresh((n) => n + 1)}>Retry</button></div>
        : data && <><p className="stock-scope" role="status">Snapshot as of {timestamp(data.asOf)}. Refresh for current stock.</p>
          {data.items.length ? <DataTable columns={columns} rows={data.items} rowKey={(r) => r.productId} rowOffset={(page - 1) * pageSize} label="Low stock alerts" testIdPrefix="low-stock" />
            : <div className="admin-empty" role="status"><strong>{query ? 'No alerts match this search' : 'No current low-stock alerts'}</strong>{query && <button type="button" className="admin-button admin-button--secondary" onClick={() => setSearch('')}>Clear search</button>}</div>}
          <TablePagination page={page} pageCount={Math.max(1, Math.ceil(data.filtered / pageSize))} pageSize={pageSize} filtered={data.filtered} total={data.total} label="materials" onPageChange={setPage} onPageSizeChange={(size) => { setPageSize(size); setPage(1); }} />
        </>}
    </section>}
  </div></AdminLayout>;
}
