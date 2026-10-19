import { downloadBlob } from '../../services/downloads.js';
import { useAdminDateFormatters } from '../../components/admin/adminPreferences.js';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Eye, FileDown, FileText, Info, RefreshCw } from 'lucide-react';
import AdminLayout from '../../components/admin/AdminLayout.jsx';
import DataTable from '../../components/admin/DataTable.jsx';
import TablePagination from '../../components/admin/TablePagination.jsx';
import StockAllergenSelect from '../../components/admin/StockAllergenSelect.jsx';
import StockStatusDetail from '../../components/admin/StockStatusDetail.jsx';
import StockStatusReport from '../../components/admin/StockStatusReport.jsx';
import useTablePagination from '../../hooks/useTablePagination.js';
import { exportStockCSV, formatPrice, listStock } from '../../services/serverInventory.js';
import '../../stockStatus.css';
import '../../inventoryServer.css';

const POLL_MS = 60000;

export default function StockStatus() {
  const { timestamp } = useAdminDateFormatters();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [productIds, setProductIds] = useState([]);
  const [appliedSearch, setAppliedSearch] = useState('');
  const [snap, setSnap] = useState(null);
  const [base, setBase] = useState(null);
  const [loading, setLoading] = useState(true);
  const [silent, setSilent] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [detail, setDetail] = useState(null);
  const [report, setReport] = useState(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const seq = useRef(0);
  const filtersRef = useRef({});
  const filters = useMemo(() => ({ query: appliedSearch, category_id: category, product_ids: productIds }), [appliedSearch, category, productIds]);
  filtersRef.current = filters;
  const unfiltered = !appliedSearch && !category && !productIds.length;

  useEffect(() => { const t = setTimeout(() => setAppliedSearch(search.trim()), 300); return () => clearTimeout(t); }, [search]);

  const load = useCallback(async ({ silent = false, signal } = {}) => {
    const id = ++seq.current;
    const f = filtersRef.current;
    if (!silent) { setLoading(true); setLoadError(''); } else setSilent(true);
    try {
      const data = await listStock({ ...f, snapshot: true, offset: 0, limit: 25 }, signal);
      if (id !== seq.current) return;
      setSnap({ rows: data.snapshot || data.items || [], asOf: data.asOf, coverage: data.coverage, filtered: data.filtered, total: data.total, filters: f });
      if (!f.query && !f.category_id && !f.product_ids.length) setBase(data.snapshot || data.items || []);
      setLoadError(''); setLoading(false); setSilent(false);
    } catch (e) {
      if (id !== seq.current || signal?.aborted) return;
      setSilent(false);
      if (!silent) { setLoadError(e.message || 'Stock could not be loaded.'); setLoading(false); }
    }
  }, []);

  useEffect(() => { const c = new AbortController(); load({ signal: c.signal }); return () => c.abort(); }, [filters, load]);
  useEffect(() => {
    const fresh = () => { if (document.visibilityState === 'visible') load({ silent: true }); };
    const timer = setInterval(fresh, POLL_MS);
    window.addEventListener('focus', fresh); document.addEventListener('visibilitychange', fresh);
    return () => { clearInterval(timer); window.removeEventListener('focus', fresh); document.removeEventListener('visibilitychange', fresh); };
  }, [load]);

  async function refresh() {
    setNotice(''); setError('');
    if (!unfiltered) {
      try { const data = await listStock({ snapshot: true, offset: 0, limit: 25 }); setBase(data.snapshot || data.items || []); } catch { /* choices keep prior values */ }
    }
    await load();
  }

  const options = useMemo(() => {
    const cats = new Map(); const allergens = [];
    (base || []).forEach((r) => { cats.set(r.categoryId, r.category); allergens.push({ value: r.productId, label: `${r.name} - ${r.concentration}` }); });
    return { categories: [...cats].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label)), allergens };
  }, [base]);
  const rows = useMemo(() => snap?.rows || [], [snap]);
  const unavailable = snap && snap.coverage && !snap.coverage.complete;
  const pg = useTablePagination(rows);
  function changeFilter(setter, value) { setter(value); pg.resetPage(); setNotice(''); setError(''); }

  async function exportCsv() {
    setNotice(''); setError('');
    if (disabled || !rows.length) { setError('There are no rows to export. Change the filters and try again.'); return; }
    try {
      const blob = new Blob([exportStockCSV(rows, { asOf: snap.asOf, coverage: snap.coverage })], { type: 'text/csv;charset=utf-8' });
      await downloadBlob(blob, `stock-status-${snap.asOf.slice(0, 10)}.csv`, { source: 'stock_status', kind: 'export', format: 'CSV' });
      setNotice(`Initiated download of ${rows.length} row${rows.length === 1 ? '' : 's'} from the snapshot as of ${timestamp(snap.asOf)}.`);
    } catch (e) { setError(e.message || 'The CSV could not be downloaded.'); }
  }
  function openReport() {
    setNotice(''); setError('');
    if (disabled) return;
    const f = snap.filters;
    setReport({ rows: [...snap.rows], asOf: snap.asOf, coverage: snap.coverage, search: f.query, category: options.categories.find((c) => c.value === f.category_id)?.label || '',
      allergenLabels: options.allergens.filter((o) => f.product_ids.includes(o.value)).map((o) => o.label), generatedAt: new Date() });
  }
  const columns = [
    { key: 'sr', label: 'Sr No', render: (_row, index) => index + 1 },
    { key: 'p', label: 'Product', render: (r) => <><strong className="admin-table__name">{r.name}</strong><span className="stock-sub">{r.productId}</span></> },
    { key: 'c', label: 'Concentration', render: (r) => r.concentration },
    { key: 'k', label: 'Category', render: (r) => r.category },
    { key: 's', label: 'Selling Price', render: (r) => formatPrice(r.sellingPrice) },
    { key: 'q', label: 'Quantity', render: (r) => <><strong className="inv-mono">{r.quantity} {r.unit}</strong>{r.state === 'catalogue_zero' && <span className="stock-sub">No receipt-backed stock</span>}{r.state === 'retained_product' && <span className="stock-sub">Retained product</span>}</> },
    { key: 'v', label: 'View', render: (r) => <button type="button" className="admin-button admin-button--secondary stock-view" onClick={() => setDetail({ row: r, asOf: snap.asOf })} aria-label={`View ${r.name} ${r.concentration}`} data-testid={`button-view-stock-${r.productId}`}><Eye size={14} /> View</button> },
  ];
  const filtersCurrent = Boolean(snap) && search.trim() === appliedSearch && snap.filters === filters;
  const disabled = loading || silent || Boolean(loadError) || !snap || unavailable || !filtersCurrent;
  return <AdminLayout title="Stock Status"><div className="stock-page">
    <div className="admin-page-head"><div><p className="admin-page-head__eyebrow">Inventory / Stock</p><h1>Stock status</h1><p className="admin-page-head__description">Current receipt-backed stock from accepted purchase receipts and committed transfers.</p></div>
      <div className="stock-actions">
        <button type="button" className="admin-button admin-button--secondary" onClick={refresh} disabled={loading} data-testid="button-refresh-stock"><RefreshCw size={15} /> Refresh</button>
        <button type="button" className="admin-button admin-button--secondary" onClick={exportCsv} disabled={disabled} data-testid="button-export-stock"><FileDown size={15} /> Export</button>
        <button type="button" className="admin-button" onClick={openReport} disabled={disabled} data-testid="button-inventory-report"><FileText size={15} /> Inventory Report</button>
      </div></div>
    <div className="admin-feedback stock-disclaimer" role="note" data-testid="text-stock-disclaimer"><Info size={14} aria-hidden="true" /> Quantities are in procurement quantity units, exact to 0.001, and carry across financial years. No sales backend is connected: sales, reservations, in-transit shipping and pre-system openings are not included or inferred.</div>
    {notice && <div className="admin-feedback" role="status" data-testid="status-stock-notice">{notice}</div>}
    {error && <div className="admin-feedback admin-feedback--error" role="alert" data-testid="status-stock-error">{error}</div>}
    {loadError && <div className="admin-feedback admin-feedback--error inv-banner" role="alert"><p>{loadError}</p><button type="button" className="admin-button admin-button--secondary" onClick={() => load()}>Retry</button></div>}
    {unavailable && <div className="admin-feedback admin-feedback--error" role="alert" data-testid="status-stock-unavailable"><strong>Inventory unavailable.</strong> {snap.coverage.pendingReceipts} server receipt{snap.coverage.pendingReceipts === 1 ? ' has' : 's have'} not been initialized into inventory. No quantity is shown, because zero would be misleading.</div>}
    <section className="admin-panel stock-panel">
      <div className="admin-toolbar stock-toolbar">
        <div className="admin-filter"><label htmlFor="stock-search">Search stock</label>
          <input id="stock-search" type="search" className="admin-input" value={search} placeholder="Name, concentration, ID or category"
            onChange={(event) => changeFilter(setSearch, event.target.value)} /></div>
        <div className="admin-filter"><label htmlFor="stock-category">Product Category</label>
          <select id="stock-category" className="admin-select" value={category} onChange={(event) => changeFilter(setCategory, event.target.value)}>
            <option value="">All categories</option>{options.categories.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></div>
        <div className="admin-filter stock-product"><label htmlFor="stock-product">Allergens</label>
          <StockAllergenSelect values={productIds} options={options.allergens} onChange={(values) => changeFilter(setProductIds, values)} /></div>
      </div>
      {snap && !unavailable && <div className="stock-scope" id="stock-snapshot-context" data-testid="text-stock-scope">
        <p><strong>Server snapshot</strong> · As of {timestamp(snap.asOf)}</p>
        <p>Current lifetime stock. Filters and the history period never change on-hand quantity; exports and reports use this same snapshot.</p>
      </div>}
      {loading ? <div role="status" aria-live="polite" className="admin-empty"><strong>Loading stock snapshot…</strong></div>
        : unavailable || loadError ? null
        : rows.length ? <div className="stock-list-table" aria-describedby="stock-snapshot-context"><DataTable columns={columns} rows={pg.pageRows} rowOffset={pg.startIndex} rowKey={(r) => r.productId} label="Stock status" testIdPrefix="stock" /></div>
        : <div className="admin-empty" role="status"><strong>No products match these filters</strong><p>Clear the search, choose All categories or remove selected allergens. All filters apply together.</p>
          <button type="button" className="admin-button admin-button--secondary" onClick={() => { setSearch(''); setAppliedSearch(''); setCategory(''); changeFilter(setProductIds, []); }}>Clear all filters</button></div>}
      {!unavailable && !loadError && snap && <TablePagination {...pg} filtered={rows.length} total={snap.total ?? rows.length} label={rows.length === 1 ? 'product' : 'products'} onPageChange={pg.setPage} onPageSizeChange={pg.setPageSize} testId="text-stock-count" />}
    </section>
    {detail && <StockStatusDetail row={detail.row} asOf={detail.asOf} onClose={() => setDetail(null)} />}
    {report && <StockStatusReport {...report} onClose={() => setReport(null)} />}
  </div></AdminLayout>;
}
