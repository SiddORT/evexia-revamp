import { captureExportPreferences } from '../../services/exportPreferences.js';
import { downloadBlob } from '../../services/downloads.js';
import { useAdminDateFormatters } from '../../components/admin/adminPreferences.js';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, SlidersHorizontal, ChevronDown, Eye, FileDown, FileText, Filter, RefreshCw, Search } from 'lucide-react';
import AdminLayout from '../../components/admin/AdminLayout.jsx';
import { useResourceActions } from '../../auth/useMasterActions.js';
import DataTable from '../../components/admin/DataTable.jsx';
import TablePagination from '../../components/admin/TablePagination.jsx';
import StockAllergenSelect from '../../components/admin/StockAllergenSelect.jsx';
import StockStatusDetail from '../../components/admin/StockStatusDetail.jsx';
import StockLedger from '../../components/admin/StockLedger.jsx';
import StockAdjustment from '../../components/admin/StockAdjustment.jsx';
import StockStatusReport from '../../components/admin/StockStatusReport.jsx';
import MasterFilterReset from '../../components/admin/MasterFilterReset.jsx';
import useTablePagination from '../../hooks/useTablePagination.js';
import { exportStockCSV, formatPrice, isSuperAdmin, listStock, STOCK_STATUSES } from '../../services/serverInventory.js';
import '../../stockStatus.css';
import '../../inventoryServer.css';

const POLL_MS = 60000;

export default function StockStatus() {
  const can = useResourceActions('stock_status');
  const { timestamp } = useAdminDateFormatters();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [stockStatus, setStockStatus] = useState('all');
  const [productIds, setProductIds] = useState([]);
  const [appliedSearch, setAppliedSearch] = useState('');
  const [snap, setSnap] = useState(null);
  const [base, setBase] = useState(null);
  const [loading, setLoading] = useState(true);
  const [silent, setSilent] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [detail, setDetail] = useState(null);
  const [ledger, setLedger] = useState(null);
  const [adjust, setAdjust] = useState(null);
  const [report, setReport] = useState(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const seq = useRef(0);
  const filtersRef = useRef({});
  const filters = useMemo(() => ({ query: appliedSearch, stock_status: stockStatus, category_id: category, product_ids: productIds }), [appliedSearch, stockStatus, category, productIds]);
  filtersRef.current = filters;
  const activeFilters = [search.trim() && 'search', stockStatus !== 'all' && 'stock status', category && 'category', productIds.length > 0 && 'allergens'].filter(Boolean);
  const hasFilters = Boolean(search || stockStatus !== 'all' || category || productIds.length);

  useEffect(() => { const t = setTimeout(() => setAppliedSearch(search.trim()), 300); return () => clearTimeout(t); }, [search]);

  const load = useCallback(async ({ silent = false, signal } = {}) => {
    const id = ++seq.current;
    const f = filtersRef.current;
    if (!silent) { setLoading(true); setLoadError(''); } else setSilent(true);
    try {
      const data = await listStock({ ...f, snapshot: true, offset: 0, limit: 25 }, signal);
      if (id !== seq.current || f !== filtersRef.current || signal?.aborted) return;
      setSnap({ rows: data.snapshot || data.items || [], asOf: data.asOf, coverage: data.coverage, filtered: data.filtered, total: data.total, filters: f });
      if (data.coverage?.complete) setBase(data.filterOptions);
      setLoadError(''); setLoading(false); setSilent(false);
    } catch (e) {
      if (id !== seq.current || f !== filtersRef.current || signal?.aborted) return;
      setSilent(false);
      if (!silent) { setLoadError(e.message || 'Stock could not be loaded.'); setLoading(false); }
    }
  }, []);

  useEffect(() => { const c = new AbortController(); load({ signal: c.signal }); return () => { c.abort(); seq.current++; }; }, [filters, load]);
  useEffect(() => {
    const fresh = () => { if (document.visibilityState === 'visible') load({ silent: true }); };
    const timer = setInterval(fresh, POLL_MS);
    window.addEventListener('focus', fresh); document.addEventListener('visibilitychange', fresh);
    return () => { clearInterval(timer); window.removeEventListener('focus', fresh); document.removeEventListener('visibilitychange', fresh); };
  }, [load]);

  async function refresh() {
    setNotice(''); setError('');
    await load();
  }

  const options = useMemo(() => {
    const cats = new Map(); const allergens = [];
    (base || []).forEach((r) => {
      if (r.categoryId) cats.set(r.categoryId, r.category);
      allergens.push({ value: r.productId, label: `${r.name} - ${r.concentration}` });
    });
    return { categories: [...cats].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label)), allergens };
  }, [base]);
  const rows = useMemo(() => snap?.rows || [], [snap]);
  const unavailable = snap && snap.coverage && !snap.coverage.complete;
  const pg = useTablePagination(rows);
  function changeFilter(setter, value) { setter(value); pg.resetPage(); setNotice(''); setError(''); }
  function resetFilters() {
    setSearch(''); setAppliedSearch(''); setStockStatus('all'); setCategory(''); setProductIds([]);
    pg.resetPage(); setNotice(''); setError('');
  }

  async function exportCsv() {
    const preferences = captureExportPreferences();
    setNotice(''); setError('');
    if (disabled || !rows.length) { setError('There are no rows to export. Change the filters and try again.'); return; }
    try {
      const blob = new Blob([exportStockCSV(rows, { asOf: snap.asOf, coverage: snap.coverage }, preferences)], { type: 'text/csv;charset=utf-8' });
      await downloadBlob(blob, `stock-status-${snap.asOf.slice(0, 10)}.csv`, { source: 'stock_status', kind: 'export', format: 'CSV' });
      setNotice(`Initiated download of ${rows.length} row${rows.length === 1 ? '' : 's'} from the snapshot as of ${timestamp(snap.asOf)}.`);
    } catch (e) { setError(e.message || 'The CSV could not be downloaded.'); }
  }
  function openReport() {
    setNotice(''); setError('');
    if (disabled) return;
    const f = snap.filters;
    setReport({ rows: [...snap.rows], asOf: snap.asOf, coverage: snap.coverage, search: f.query, stockStatus: f.stock_status, category: options.categories.find((c) => c.value === f.category_id)?.label || '',
      allergenLabels: options.allergens.filter((o) => f.product_ids.includes(o.value)).map((o) => o.label), generatedAt: new Date() });
  }
  const columns = [
    { key: 'sr', label: 'Sr No', render: (_row, index) => index + 1 },
    { key: 'p', label: 'Product', render: (r) => <><strong className="admin-table__name">{r.name}</strong><span className="stock-sub">{r.itemKind === 'combo' ? 'Assembled combo' : 'Allergen'} · {r.productId}</span></> },
    { key: 'c', label: 'Concentration', render: (r) => r.concentration },
    { key: 'k', label: 'Category', render: (r) => r.category },
    { key: 's', label: 'Selling Price', render: (r) => formatPrice(r.sellingPrice) },
    { key: 'q', label: 'Quantity', render: (r) => <><strong className="inv-mono">{r.quantity} {r.unit}</strong>{r.state === 'catalogue_zero' && <span className="stock-sub">No stock on hand</span>}{Number(r.unallocatedQuantity) > 0 && <span className="stock-sub">Unallocated: {r.unallocatedQuantity} {r.unit}</span>}{r.state === 'retained_product' && <span className="stock-sub">Retained product</span>}</> },
    { key: 'v', label: 'Actions', render: (r) => <div className="stock-row-actions"><button type="button" className="admin-button admin-button--secondary stock-view" onClick={() => setDetail({ row: r, asOf: snap.asOf })} aria-label={`View ${r.name} ${r.concentration}`} data-testid={`button-view-stock-${r.productId}`}><Eye size={14} /> View</button>
      {can.protected && r.itemKind !== 'combo' && <button type="button" className="admin-button admin-button--secondary stock-view" onClick={() => setLedger(r)} aria-label={`Ledger for ${r.name} ${r.concentration}`} data-testid={`button-ledger-stock-${r.productId}`}><BookOpen size={14} /> Ledger</button>}
      {r.itemKind !== 'combo' && isSuperAdmin() && <button type="button" className="admin-button admin-button--secondary stock-view" onClick={() => setAdjust(r)} aria-label={`Manual adjustment for ${r.name} ${r.concentration}`} data-testid={`button-adjust-stock-${r.productId}`}><SlidersHorizontal size={14} /> Manual adjustment</button>}</div> },
  ];
  const filtersCurrent = Boolean(snap) && search.trim() === appliedSearch && snap.filters === filters;
  const disabled = loading || silent || Boolean(loadError) || !snap || unavailable || !filtersCurrent;
  return <AdminLayout title="Stock Status"><div className="stock-page">
    <div className="admin-page-head"><div><p className="admin-page-head__eyebrow">Inventory / Stock</p><h1>Stock status</h1><p className="admin-page-head__description">Current stock from accepted receipts, assemblies, opening stock and committed transfers. Unallocated opening stock is shown separately.</p></div>
      <div className="stock-actions">
        <button type="button" className="admin-button admin-button--secondary" onClick={exportCsv} disabled={!can.export || disabled} data-testid="button-export-stock"><FileDown size={15} /> Export</button>
        <button type="button" className="admin-button" onClick={openReport} disabled={!can.export || disabled} data-testid="button-inventory-report"><FileText size={15} /> Inventory Report</button>
      </div></div>
    {notice && <div className="admin-feedback" role="status" data-testid="status-stock-notice">{notice}</div>}
    {error && <div className="admin-feedback admin-feedback--error" role="alert" data-testid="status-stock-error">{error}</div>}
    {loadError && <div className="admin-feedback admin-feedback--error inv-banner" role="alert"><p>{loadError}</p><button type="button" className="admin-button admin-button--secondary" onClick={() => load()}>Retry</button></div>}
    {unavailable && <div className="admin-feedback admin-feedback--error" role="alert" data-testid="status-stock-unavailable"><strong>Inventory unavailable.</strong> {snap.coverage.pendingReceipts} server receipt{snap.coverage.pendingReceipts === 1 ? ' has' : 's have'} not been initialized into inventory. No quantity is shown, because zero would be misleading.</div>}
    <section className="admin-panel stock-panel">
      <div className="stock-toolbar">
        <div className="master-filter-toolbar">
          <div className="stock-search-group">
            <button type="button" className="admin-button admin-button--secondary" onClick={refresh} disabled={loading || silent} data-testid="button-refresh-stock"><RefreshCw size={15} aria-hidden="true" /> Refresh</button>
            <div className="admin-filter stock-search"><div className="admin-search"><Search size={16} aria-hidden="true" />
              <input id="stock-search" type="search" aria-label="Search stock" maxLength={200} value={search} placeholder="Name, concentration, ID or category"
                onChange={(event) => changeFilter(setSearch, event.target.value)} /></div></div>
          </div>
          <MasterFilterReset disabled={!hasFilters} onClick={resetFilters} testId="button-reset-stock-filters" />
        </div>
        <details className="stock-filter-disclosure">
          <summary><Filter size={15} aria-hidden="true" /> Filter records{activeFilters.length > 0 && ` · ${activeFilters.length} active`}<ChevronDown size={15} aria-hidden="true" /></summary>
          <div className="stock-filters">
        <div className="admin-filter"><label htmlFor="stock-status">Stock Status</label>
          <select id="stock-status" className="admin-select" value={stockStatus} onChange={(event) => changeFilter(setStockStatus, event.target.value)}>
            {STOCK_STATUSES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></div>
        <div className="admin-filter"><label htmlFor="stock-category">Product Category</label>
          <select id="stock-category" className="admin-select" value={category} onChange={(event) => changeFilter(setCategory, event.target.value)}>
            <option value="">All categories</option>{options.categories.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></div>
        <div className="admin-filter stock-product"><label htmlFor="stock-product">Allergens</label>
          <StockAllergenSelect values={productIds} options={options.allergens} onChange={(values) => changeFilter(setProductIds, values)} /></div>
          </div>
        </details>
      </div>
      {snap && !unavailable && <div className="stock-scope" id="stock-snapshot-context" data-testid="text-stock-scope">
        <p><strong>Server snapshot</strong> · As of {timestamp(snap.asOf)}</p>
        <p>Current lifetime stock. Filters and the history period never change on-hand quantity; exports and reports use this same snapshot.</p>
      </div>}
      {loading ? <div role="status" aria-live="polite" className="admin-empty"><strong>Loading stock snapshot…</strong></div>
        : unavailable || loadError ? null
        : rows.length ? <div className="stock-list-table" aria-describedby="stock-snapshot-context"><DataTable columns={columns} rows={pg.pageRows} rowOffset={pg.startIndex} rowKey={(r) => r.productId} label="Stock status" testIdPrefix="stock" /></div>
        : <div className="admin-empty" role="status"><strong>No products match these filters</strong><p>Change the search, stock status, category or selected allergens. All filters apply together.</p>
          <button type="button" className="admin-button admin-button--secondary" onClick={resetFilters}>Reset filters</button></div>}
      {!unavailable && !loadError && snap && <TablePagination {...pg} filtered={rows.length} total={snap.total ?? rows.length} label={rows.length === 1 ? 'product' : 'products'} onPageChange={pg.setPage} onPageSizeChange={pg.setPageSize} testId="text-stock-count" />}
    </section>
    {detail && <StockStatusDetail row={detail.row} asOf={detail.asOf} onClose={() => setDetail(null)} />}
    {ledger && <StockLedger row={ledger} onClose={() => setLedger(null)} />}
    {adjust && <StockAdjustment row={adjust} onClose={() => setAdjust(null)} onCommitted={() => { setDetail(null); setLedger(null); setNotice('Adjustment recorded. Reloading current stock.'); load(); }} />}
    {report && <StockStatusReport {...report} onClose={() => setReport(null)} />}
  </div></AdminLayout>;
}
