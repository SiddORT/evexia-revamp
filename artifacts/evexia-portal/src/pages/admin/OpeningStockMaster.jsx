import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { Download, Eye, FileUp, Plus } from 'lucide-react';
import AdminLayout from '../../components/admin/AdminLayout.jsx';
import DataTable from '../../components/admin/DataTable.jsx';
import TablePagination from '../../components/admin/TablePagination.jsx';
import OpeningDrawer from '../../components/admin/OpeningDrawer.jsx';
import OpeningPendingBanner from '../../components/admin/OpeningPendingBanner.jsx';
import { useAdminDateFormatters } from '../../components/admin/adminPreferences.js';
import { downloadExport, listOpenings, money, valueMoney, locationLabel } from '../../services/openingStock.js';
import { recordLocalAction } from '../../services/localActivity.js';
import { downloadServerBlob } from '../../services/downloads.js';
import '../../mr.css';
import '../../inventoryServer.css';

const BASE = '/admin/masters/opening-stock';

export default function OpeningStockMaster() {
  const [, navigate] = useLocation();
  const { date } = useAdminDateFormatters();
  const [search, setSearch] = useState('');
  const [applied, setApplied] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [viewing, setViewing] = useState(null);
  const [tick, setTick] = useState(0);
  const [exporting, setExporting] = useState('');
  const [exportMsg, setExportMsg] = useState('');
  const seq = useRef(0);
  useEffect(() => { const t = setTimeout(() => { setApplied(search.trim()); setPage(1); }, 300); return () => clearTimeout(t); }, [search]);
  const load = useCallback(() => setTick((t) => t + 1), []);
  useEffect(() => {
    const refresh = () => { if (!document.hidden) load(); };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    const interval = setInterval(refresh, 60000);
    return () => { window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); clearInterval(interval); };
  }, [load]);
  useEffect(() => {
    const id = ++seq.current; const c = new AbortController();
    setLoading(true); setError('');
    listOpenings({ query: applied, offset: (page - 1) * pageSize, limit: pageSize }, c.signal)
      .then((d) => { if (id === seq.current) { setData(d); setLoading(false); } })
      .catch((e) => { if (id === seq.current && !c.signal.aborted) { setError(e.message || 'Opening stock could not be loaded.'); setLoading(false); } });
    return () => c.abort();
  }, [applied, page, pageSize, tick]);
  const items = data?.items || [];
  const filtered = data?.filtered ?? 0;
  const pageCount = Math.max(1, Math.ceil(filtered / pageSize));
  useEffect(() => { if (!loading && !error && page > pageCount) setPage(pageCount); }, [loading, error, page, pageCount]);

  async function exportAll(format) {
    setExporting(format); setExportMsg('');
    try { const blob = await downloadExport(applied, format); downloadServerBlob(blob, `opening-stock.${format}`); recordLocalAction('opening_stock', 'exported'); setExportMsg(`Opening stock ${format.toUpperCase()} export prepared for all ${filtered} matching records.`); }
    catch (e) { setExportMsg(e.message || 'Export failed. Retry.'); }
    finally { setExporting(''); }
  }
  const columns = [
    { key: 'sr', label: 'Sr No', render: (_r, i) => i + 1 },
    { key: 'item', label: 'Item', render: (r) => <><strong className="admin-table__name">{r.productName}</strong><span className="stock-sub">{r.itemKind === 'combo' ? 'Product' : 'Allergen'}</span></> },
    { key: 'qty', label: 'Quantity', render: (r) => <span className="inv-mono">{r.quantity} {r.unit}</span> },
    { key: 'rate', label: 'Unit rate', render: (r) => <span className="inv-mono">{money(r.unitRate)}</span> },
    { key: 'val', label: 'Opening value', render: (r) => <span className="inv-mono">{valueMoney(r.openingValue)}</span> },
    { key: 'loc', label: 'Location', render: (r) => locationLabel(r.location) },
    { key: 'date', label: 'Recorded', render: (r) => <>{date(r.recordedDate)}<span className="stock-sub">{r.actor}</span></> },
    { key: 'act', label: 'Actions', render: (r) => <div className="admin-table__actions">
      <button type="button" className="admin-icon-button" aria-label={`View details, ${r.productName}`} title="Details, activity and totals" onClick={() => { setViewing(r.id); recordLocalAction('opening_stock', 'page_view'); }} data-testid={`button-view-opening-${r.id}`}><Eye size={16} /></button></div> },
  ];
  const sum = data?.summary;
  return <AdminLayout title="Opening Stock"><div>
    <div className="admin-page-head"><div><p className="admin-page-head__eyebrow">Masters / Products & Supply</p><h1>Opening Stock</h1><p className="admin-page-head__description">Pre-system physical stock for allergens and products. Records are append-only stock initialization; a blank location means Unallocated, not zero stock.</p></div>
      <div className="admin-mr-head-actions">
        <button type="button" className="admin-button admin-button--secondary" onClick={() => navigate(`${BASE}/import`)} data-testid="button-import-opening"><FileUp size={16} /> Import</button>
        <button type="button" className="admin-button admin-button--secondary" disabled={Boolean(exporting) || loading || Boolean(error) || search.trim() !== applied || !filtered} onClick={() => exportAll('csv')} data-testid="button-export-opening-csv"><Download size={16} /> {exporting === 'csv' ? 'Preparing…' : 'Export CSV'}</button>
        <button type="button" className="admin-button admin-button--secondary" disabled={Boolean(exporting) || loading || Boolean(error) || search.trim() !== applied || !filtered} onClick={() => exportAll('xlsx')} data-testid="button-export-opening-xlsx"><Download size={16} /> {exporting === 'xlsx' ? 'Preparing…' : 'Export XLSX'}</button>
        <button type="button" className="admin-button" onClick={() => navigate(`${BASE}/new`)} data-testid="button-add-opening"><Plus size={16} /> Add opening stock</button></div></div>
    <OpeningPendingBanner onResolved={() => load()} />
    {exportMsg && <div className="admin-feedback" role="status">{exportMsg}</div>}
    {sum && <div className="admin-feedback" role="status" data-testid="status-opening-summary">{sum.records} matching record{sum.records === 1 ? '' : 's'}, {sum.imports} from import. {sum.breakdown?.length ? sum.breakdown.map((b) => `${b.productName} ${b.quantity} ${b.unit} (value ${valueMoney(b.openingValue)}) at ${b.locationId ? b.locationName : 'Unallocated'}`).join('; ') : 'No stock breakdown.'} {sum.scope}</div>}
    <section className="admin-panel" aria-label="Opening stock list">
      <div className="admin-toolbar">
        <div className="admin-filter"><label htmlFor="opening-search">Search opening stock</label><input id="opening-search" type="search" className="admin-input" maxLength={200} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Item name" data-testid="input-search-opening" /></div>
        <button type="button" className="admin-button admin-button--secondary" disabled={loading} onClick={load}>Refresh</button>
      </div>
      {error ? <div className="admin-empty" role="alert"><strong>Opening stock could not be loaded</strong><p>{error}</p><button type="button" className="admin-button" onClick={load}>Try again</button></div> : <>
        <DataTable columns={columns} rows={items} rowOffset={(page - 1) * pageSize} rowKey={(r) => r.id} label="Opening stock" testIdPrefix="opening" loading={loading}
          empty={<div className="admin-empty"><strong>{applied ? 'No opening stock matches' : 'No opening stock yet'}</strong><p>{applied ? 'Clear the search.' : 'Add opening stock for an existing allergen or product, or import a filled sample.'}</p></div>} />
        <TablePagination page={page} pageSize={pageSize} pageCount={pageCount} filtered={filtered} total={data?.total ?? 0} label="opening stock records" onPageChange={setPage} onPageSizeChange={(n) => { setPageSize(n); setPage(1); }} testId="text-opening-count" /></>}
    </section>
    {viewing && <OpeningDrawer id={viewing} onClose={() => setViewing(null)} />}
  </div></AdminLayout>;
}
