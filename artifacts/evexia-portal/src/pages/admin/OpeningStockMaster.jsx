import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Download, Eye, FileUp, Plus, Search } from 'lucide-react';
import AdminLayout from '../../components/admin/AdminLayout.jsx';
import { useResourceActions } from '../../auth/useMasterActions.js';
import DataTable from '../../components/admin/DataTable.jsx';
import TablePagination from '../../components/admin/TablePagination.jsx';
import OpeningDrawer from '../../components/admin/OpeningDrawer.jsx';
import OpeningPendingBanner from '../../components/admin/OpeningPendingBanner.jsx';
import { useAdminDateFormatters, useAdminPreferences } from '../../components/admin/adminPreferences.js';
import { downloadExport, listOpenings, money, valueMoney, locationLabel } from '../../services/openingStock.js';
import { recordLocalAction } from '../../services/localActivity.js';
import { downloadServerBlob } from '../../services/downloads.js';
import '../../mr.css';
import '../../inventoryServer.css';
import '../../openingStock.css';

const BASE = '/admin/masters/opening-stock';

export default function OpeningStockMaster() {
  const can = useResourceActions('opening_stock');
  const [, navigate] = useLocation();
  const { date } = useAdminDateFormatters();
  const { theme, appearance } = useAdminPreferences();
  const [search, setSearch] = useState('');
  const [applied, setApplied] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [viewing, setViewing] = useState(null);
  const viewTrigger = useRef(null);
  const [tick, setTick] = useState(0);
  const [exporting, setExporting] = useState('');
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const exportBusy = useRef(false);
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
    if (exportBusy.current || loading || error || search.trim() !== applied || !filtered) return;
    exportBusy.current = true;
    setExporting(format); setExportMsg('');
    try { const blob = await downloadExport(applied, format); downloadServerBlob(blob, `opening-stock.${format}`); recordLocalAction('opening_stock', 'exported'); setExportMsg(`Opening stock ${format.toUpperCase()} export prepared for all ${filtered} matching records.`); }
    catch (e) { setExportMsg(e.message || 'Export failed. Retry.'); }
    finally { exportBusy.current = false; setExporting(''); }
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
      <button id={`opening-view-${r.id}`} type="button" className="admin-icon-button" aria-label={`View details, ${r.productName}`} title="Details, activity and totals" onClick={(event) => { viewTrigger.current = event.currentTarget; setViewing(r.id); recordLocalAction('opening_stock', 'page_view'); }} data-testid={`button-view-opening-${r.id}`}><Eye size={16} /></button></div> },
  ];
  return <AdminLayout title="Opening Stock"><div className="opening-stock-master">
    <div className="admin-page-head"><div><p className="admin-page-head__eyebrow">Masters / Products & Supply</p><h1>Opening Stock</h1><p className="admin-page-head__description">Pre-system physical stock for allergens and products. Records are append-only stock initialization; a blank location means Unallocated, not zero stock.</p></div>
      <div className="admin-mr-head-actions">
        <button type="button" disabled={!can.import} className="admin-button admin-button--secondary" onClick={() => navigate(`${BASE}/import`)} data-testid="button-import-opening"><FileUp size={16} /> Import</button>
        <DropdownMenu.Root open={exportMenuOpen} onOpenChange={(open) => { if (!open || !exportBusy.current) setExportMenuOpen(open); }}>
          <DropdownMenu.Trigger asChild><button type="button" className="admin-button admin-button--secondary" disabled={!can.export || loading || Boolean(error) || search.trim() !== applied || !filtered} aria-disabled={Boolean(exporting) || undefined} data-testid="button-export-opening"><Download size={16} aria-hidden="true" /> {exporting ? 'Preparing…' : 'Export data'}</button></DropdownMenu.Trigger>
          <DropdownMenu.Portal><DropdownMenu.Content className="admin-dropdown__menu admin-zone-export__menu admin-mr-export__menu" data-admin-theme={theme} data-admin-appearance={appearance} align="end" sideOffset={6} collisionPadding={12} aria-label="Opening stock export format">
            <DropdownMenu.Item className="admin-dropdown__item" disabled={Boolean(exporting)} onSelect={() => void exportAll('csv')} data-testid="button-export-opening-csv">CSV</DropdownMenu.Item>
            <DropdownMenu.Item className="admin-dropdown__item" disabled={Boolean(exporting)} onSelect={() => void exportAll('xlsx')} data-testid="button-export-opening-xlsx">Excel (.xlsx)</DropdownMenu.Item>
          </DropdownMenu.Content></DropdownMenu.Portal>
        </DropdownMenu.Root>
        <button type="button" disabled={!can.add} className="admin-button" onClick={() => navigate(`${BASE}/new`)} data-testid="button-add-opening"><Plus size={16} /> Add opening stock</button></div></div>
    <OpeningPendingBanner onResolved={() => load()} />
    {exportMsg && <div className="admin-feedback" role="status">{exportMsg}</div>}
    <section className="admin-panel" aria-label="Opening stock list">
      <div className="admin-toolbar">
        <button type="button" className="admin-button admin-button--secondary" disabled={loading} onClick={load}>Refresh</button>
        <label className="admin-search"><Search size={16} aria-hidden="true" /><span className="sr-only">Search opening stock by item name</span><input id="opening-search" type="search" maxLength={200} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search item name" data-testid="input-search-opening" /></label>
      </div>
      {error ? <div className="admin-empty" role="alert"><strong>Opening stock could not be loaded</strong><p>{error}</p><button type="button" className="admin-button" onClick={load}>Try again</button></div> : <>
        <DataTable columns={columns} rows={items} rowOffset={(page - 1) * pageSize} rowKey={(r) => r.id} label="Opening stock" testIdPrefix="opening" loading={loading}
          empty={<div className="admin-empty"><strong>{applied ? 'No opening stock matches' : 'No opening stock yet'}</strong><p>{applied ? 'Clear the search.' : 'Add opening stock for an existing allergen or product, or import a filled sample.'}</p></div>} />
        <TablePagination page={page} pageSize={pageSize} pageCount={pageCount} filtered={filtered} total={data?.total ?? 0} label="opening stock records" onPageChange={setPage} onPageSizeChange={(n) => { setPageSize(n); setPage(1); }} testId="text-opening-count" /></>}
    </section>
    {viewing && <OpeningDrawer id={viewing} returnFocusTo={viewTrigger.current} onClose={() => setViewing(null)} />}
  </div></AdminLayout>;
}
