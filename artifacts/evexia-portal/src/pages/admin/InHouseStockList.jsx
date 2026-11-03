import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { AlertTriangle, CalendarClock, ChevronDown, Eye, FileDown, Filter, Plus, Search } from 'lucide-react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import AdminLayout from '../../components/admin/AdminLayout.jsx';
import DataTable from '../../components/admin/DataTable.jsx';
import TablePagination from '../../components/admin/TablePagination.jsx';
import InHousePendingBanner from '../../components/admin/InHousePendingBanner.jsx';
import InHouseStockDialog from '../../components/admin/InHouseStockDialog.jsx';
import ReferenceSelect from '../../components/admin/ReferenceSelect.jsx';
import MasterFilterReset from '../../components/admin/MasterFilterReset.jsx';
import { useAdminDateFormatters, useAdminPreferences } from '../../components/admin/adminPreferences.js';
import { useAdminSession } from '../../auth/AdminBoundary.jsx';
import { isSuperAdminIdentity } from '../../auth/capabilities.js';
import { exportInHouseStock, listFilterAllergens, listInHouseStock, RESERVE_NOTE } from '../../services/inHouseStock.js';
import InHouseAccessDenied from './InHouseAccessDenied.jsx';
import '../../mr.css';
import '../../inventoryServer.css';
import '../../openingStock.css';
import './InHouseStockList.css';

const BASE = '/admin/inventory/in-house-stock';

export default function InHouseStockList() {
  const { user } = useAdminSession();
  return isSuperAdminIdentity(user) ? <InHouseStockListInner /> : <InHouseAccessDenied />;
}

function InHouseStockListInner() {
  const [, navigate] = useLocation();
  const { date, timestamp } = useAdminDateFormatters();
  const { theme, appearance } = useAdminPreferences();
  const [search, setSearch] = useState('');
  const [applied, setApplied] = useState('');
  const [allergen, setAllergen] = useState(null);
  const [dates, setDates] = useState({ from_date: '', to_date: '', date_field: 'recorded' });
  const [exporting, setExporting] = useState('');
  const [exportMessage, setExportMessage] = useState(null);
  const dateError = dates.from_date && dates.to_date && dates.from_date > dates.to_date
    ? 'From date must be on or before To date.' : '';
  const filters = { query: applied, allergen_id: allergen?.value || '', ...dates };
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
    if (dateError) { setError(dateError); setLoading(false); return () => c.abort(); }
    setLoading(true); setError('');
    listInHouseStock({ query: applied, allergen_id: allergen?.value || '', ...dates, offset: (page - 1) * pageSize, limit: pageSize }, c.signal)
      .then((d) => { if (id === seq.current) { setData(d); setLoading(false); } })
      .catch((e) => { if (id === seq.current && !c.signal.aborted) { setError(e.message || 'In-house stock could not be loaded.'); setLoading(false); } });
    return () => c.abort();
  }, [applied, allergen, dates, dateError, page, pageSize, tick]);
  const items = data?.items || [];
  const filtered = data?.filtered ?? 0;
  const pageCount = Math.max(1, Math.ceil(filtered / pageSize));
  useEffect(() => { if (!loading && !error && page > pageCount) setPage(pageCount); }, [loading, error, page, pageCount]);
  const changeDate = (key, value) => { setDates((d) => ({ ...d, [key]: value })); setPage(1); setExportMessage(null); };
  const resetFilters = () => { setSearch(''); setApplied(''); setAllergen(null); setDates({ from_date: '', to_date: '', date_field: 'recorded' }); setPage(1); setExportMessage(null); };
  const hasFilters = Boolean(applied || allergen || dates.from_date || dates.to_date);
  const activeFilterCount = [allergen, dates.from_date, dates.to_date].filter(Boolean).length;
  async function runExport(format) {
    if (exporting || loading || error || dateError || applied !== search.trim()) return;
    setExporting(format); setExportMessage(null);
    try {
      const count = await exportInHouseStock(filters, format);
      setExportMessage({ ok: true, text: `${format.toUpperCase()} prepared with ${count} matching in-house stock records.` });
    } catch (e) { setExportMessage({ ok: false, text: e.message || 'Export failed. No file was released.' }); }
    finally { setExporting(''); }
  }

  const columns = [
    { key: 'sr', label: 'Sr No', render: (_r, i) => i + 1 },
    { key: 'allergen', label: 'Allergen', render: (r) => <><strong className="admin-table__name">{r.allergenName}</strong><span className="stock-sub">{r.categoryName || 'Uncategorised'}</span></> },
    { key: 'conc', label: 'Concentration', render: (r) => r.concentration || 'Unavailable' },
    { key: 'qty', label: 'Quantity (ml)', render: (r) => <><span className="inv-mono">{r.quantity} {r.unit}</span><span className="stock-sub">Original recorded quantity</span>{r.availableQuantity != null && <span className="stock-sub inv-mono" data-testid={`text-in-house-available-${r.id}`}>Available {r.availableQuantity} {r.unit || 'ml'}{r.locationBalances?.length ? ` · ${r.locationBalances.map((b) => `${b.locationName}: ${b.quantity}`).join(', ')}` : ''}</span>}</> },
    { key: 'exp', label: 'Expiry', render: (r) => <>{date(r.expiryDate)}<span className="stock-sub" data-testid={`status-in-house-expiry-${r.id}`}>{r.expired ? 'Expired' : 'In date'}</span></> },
    { key: 'loc', label: 'Location', render: (r) => <>{r.locationName}{r.batch && <span className="stock-sub">Batch {r.batch}</span>}</> },
    { key: 'rec', label: 'Recorded', render: (r) => <>{timestamp(r.createdAt)}<span className="stock-sub">{r.actor}</span></> },
    { key: 'act', label: 'Actions', render: (r) => <div className="admin-table__actions">
      <button type="button" className="admin-icon-button" aria-label={`View details, ${r.allergenName}`} title="Details" onClick={() => setViewing(r)} data-testid={`button-view-in-house-${r.id}`}><Eye size={16} /></button></div> },
  ];
  return <AdminLayout title="In-house stock"><div className="opening-stock-master">
    <div className="admin-page-head"><div><p className="admin-page-head__eyebrow">Inventory / Reserve</p><h1>In-house stock</h1><p className="admin-page-head__description">{RESERVE_NOTE} Entries are append-only; no pricing, vendors or dilution.</p></div>
      <div className="admin-mr-head-actions">
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild><button type="button" className="admin-button admin-button--secondary" disabled={Boolean(exporting) || loading || Boolean(error) || Boolean(dateError) || applied !== search.trim()} data-testid="button-export-in-house">
            <FileDown size={16} aria-hidden="true" />{exporting ? 'Preparing…' : 'Export'}<ChevronDown size={14} aria-hidden="true" />
          </button></DropdownMenu.Trigger>
          <DropdownMenu.Portal><DropdownMenu.Content className="admin-dropdown__menu in-house-export-menu" data-admin-theme={theme} data-admin-appearance={appearance} align="end" sideOffset={6} collisionPadding={12}>
            <DropdownMenu.Item className="in-house-export-menu__item" onSelect={() => runExport('csv')} data-testid="menu-in-house-export-csv">Download CSV</DropdownMenu.Item>
            <DropdownMenu.Item className="in-house-export-menu__item" onSelect={() => runExport('xlsx')} data-testid="menu-in-house-export-xlsx">Download XLSX</DropdownMenu.Item>
          </DropdownMenu.Content></DropdownMenu.Portal>
        </DropdownMenu.Root>
        <button type="button" className="admin-button admin-button--secondary" onClick={() => navigate('/admin/inventory/expiring')} data-testid="button-in-house-expiring"><CalendarClock size={16} /> Expiring soon</button>
        <button type="button" className="admin-button admin-button--secondary" onClick={() => navigate('/admin/inventory/expired')} data-testid="button-in-house-expired"><AlertTriangle size={16} /> Expired and disposal</button>
        <button type="button" className="admin-button" onClick={() => navigate(`${BASE}/new`)} data-testid="button-add-in-house"><Plus size={16} /> Add in-house stock</button></div></div>
    {exportMessage && <div className={`admin-feedback admin-feedback--${exportMessage.ok ? 'success' : 'error'}`} role={exportMessage.ok ? 'status' : 'alert'}>{exportMessage.text}</div>}
    <InHousePendingBanner onResolved={() => load()} />
    <section className="admin-panel" aria-label="In-house stock list">
      <div className="in-house-filter-toolbar">
      <div className="in-house-filter-toolbar__top master-filter-toolbar">
        <div className="in-house-filter-toolbar__search">
        <button type="button" className="admin-button admin-button--secondary" disabled={loading} onClick={load} data-testid="button-refresh-in-house">Refresh</button>
        <label className="admin-search"><Search size={16} aria-hidden="true" /><span className="sr-only">Search in-house stock</span><input type="search" maxLength={200} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search allergen, batch or location" data-testid="input-search-in-house" /></label>
        </div>
        <MasterFilterReset disabled={!search && !allergen && !dates.from_date && !dates.to_date && dates.date_field === 'recorded'} onClick={resetFilters} testId="button-reset-in-house-filters" />
      </div>
      <details className="in-house-filter-disclosure">
        <summary data-testid="button-toggle-in-house-filters"><Filter size={15} aria-hidden="true" />Filter records{activeFilterCount > 0 && ` · ${activeFilterCount} active`}<ChevronDown size={15} aria-hidden="true" /></summary>
      <div className="in-house-filters">
        <div className="ms-field"><label htmlFor="in-house-filter-allergen">Allergen</label>
          <ReferenceSelect id="in-house-filter-allergen" label="Filter by allergen" kind="in-house-filter-allergens"
            fetchPage={listFilterAllergens} value={allergen?.value || ''} selected={allergen} placeholder="All allergens" showResultHint={false}
            onChange={(_value, option) => { setAllergen(option ? { value: option.value, label: option.label } : null); setPage(1); setExportMessage(null); }} />
        </div>
        <label className="ms-field">Date range applies to<select className="mr-form__control" value={dates.date_field} onChange={(e) => changeDate('date_field', e.target.value)} data-testid="select-in-house-date-field">
          <option value="recorded">Recorded date (UTC)</option><option value="expiry">Expiry date</option>
        </select></label>
        <label className="ms-field">From date<input className="mr-form__control" type="date" value={dates.from_date} max={dates.to_date || undefined} onChange={(e) => changeDate('from_date', e.target.value)} aria-invalid={Boolean(dateError)} data-testid="input-in-house-from-date" /></label>
        <label className="ms-field">To date<input className="mr-form__control" type="date" value={dates.to_date} min={dates.from_date || undefined} onChange={(e) => changeDate('to_date', e.target.value)} aria-invalid={Boolean(dateError)} data-testid="input-in-house-to-date" /></label>
      </div>
      </details>
      </div>
      {error ? <div className="admin-empty" role="alert"><strong>In-house stock could not be loaded</strong><p>{error}</p><button type="button" className="admin-button" onClick={load} data-testid="button-retry-in-house">Try again</button></div> : <>
        <DataTable columns={columns} rows={items} rowOffset={(page - 1) * pageSize} rowKey={(r) => r.id} label="In-house stock" testIdPrefix="in-house" loading={loading}
          empty={<div className="admin-empty"><strong>{hasFilters ? 'No in-house stock matches' : 'No in-house stock yet'}</strong><p>{hasFilters ? 'Change or reset the filters.' : 'Record reserve stock held in-house. It stays reserve only and is not order-ready.'}</p></div>} />
        <TablePagination page={page} pageSize={pageSize} pageCount={pageCount} filtered={filtered} total={data?.total ?? 0} label="in-house stock records" onPageChange={setPage} onPageSizeChange={(n) => { setPageSize(n); setPage(1); }} testId="text-in-house-count" /></>}
    </section>
    {viewing && <InHouseStockDialog id={viewing.id} initial={viewing} onClose={() => setViewing(null)} />}
  </div></AdminLayout>;
}
