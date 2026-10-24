import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useSearch } from 'wouter';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { ChevronDown, CirclePower, Download, Eye, Filter, Layers, Pencil, Plus, Search, Trash2, Upload } from 'lucide-react';
import MasterFilterReset from '../../components/admin/MasterFilterReset.jsx';
import ReferenceSelect from '../../components/admin/ReferenceSelect.jsx';
import { useAdminPreferences } from '../../components/admin/adminPreferences.js';
import { reportingIdentityGuard } from '../../auth/adminSession.js';
import AdminLayout from '../../components/admin/AdminLayout.jsx';
import { useResourceActions } from '../../auth/useMasterActions.js';
import ConfirmationDialog from '../../components/admin/ConfirmationDialog.jsx';
import DataTable from '../../components/admin/DataTable.jsx';
import StatusBadge from '../../components/admin/StatusBadge.jsx';
import TablePagination from '../../components/admin/TablePagination.jsx';
import ProductDrawer from '../../components/admin/ProductDrawer.jsx';
import ProductPendingBanner from '../../components/admin/ProductPendingBanner.jsx';
import { deleteProduct, downloadProductFile, exportProducts, journaled, listProducts, listProductFilterReferences, newKey, setProductStatus } from '../../services/productMaster.js';
import { formatPrice } from '../../services/serverInventory.js';
import '../../mr.css';
import '../../inventoryServer.css';
import '../../allergen.css';
import '../../productMaster.css';

const BASE = '/admin/masters/products';

export default function ProductMaster() {
  const can = useResourceActions('product');
  const { theme, appearance } = useAdminPreferences();
  const [, navigate] = useLocation();
  const queryString = useSearch();
  const [search, setSearch] = useState('');
  const [applied, setApplied] = useState('');
  const [status, setStatus] = useState('all');
  const [category, setCategory] = useState(null);
  const [allergens, setAllergens] = useState([]);
  const activeFilters = Number(status !== 'all') + Number(Boolean(category)) + Number(allergens.length > 0);
  const filterParams = { query: applied, status, category_id: category?.value, allergen_ids: allergens.map((o) => o.value) };
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [viewing, setViewing] = useState(null);
  const [confirming, setConfirming] = useState(null);
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState('');
  const [tick, setTick] = useState(0);
  const keyRef = useRef(null);
  const seq = useRef(0);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const exportBusy = useRef(false);
  const alive = useRef(true);
  const exportController = useRef(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; exportController.current?.abort(); }; }, []);
  async function exportMatching(format) {
    if (loading || error || exportBusy.current) return;
    exportBusy.current = true; setExporting(true); setActionError('');
    const guard = reportingIdentityGuard();
    exportController.current = new AbortController();
    try {
      const blob = await exportProducts(filterParams, format, exportController.current.signal);
      guard();
      if (alive.current) downloadProductFile(blob, format);
    } catch (cause) {
      try { guard(); } catch { return; }
      if (alive.current) setActionError(`Export failed. ${cause.message}`);
    } finally { exportBusy.current = false; if (alive.current) setExporting(false); }
  }
  useEffect(() => {
    const details = new URLSearchParams(queryString).get('details');
    if (/^[0-9a-f-]{36}$/i.test(details || '')) setViewing(details);
  }, [queryString]);
  useEffect(() => { const t = setTimeout(() => { setApplied(search.trim()); setPage(1); }, 300); return () => clearTimeout(t); }, [search]);
  const load = useCallback(() => setTick((t) => t + 1), []);
  useEffect(() => {
    const id = ++seq.current; const c = new AbortController();
    setLoading(true); setError('');
    listProducts({ query: applied, status, category_id: category?.value, allergen_ids: allergens.map((o) => o.value), offset: (page - 1) * pageSize, limit: pageSize }, c.signal)
      .then((d) => { if (id === seq.current) { setData(d); setLoading(false); } })
      .catch((e) => { if (id === seq.current && !c.signal.aborted) { setError(e.message || 'Products could not be loaded.'); setLoading(false); } });
    return () => c.abort();
  }, [applied, status, category, allergens, page, pageSize, tick]);

  const items = data?.items || [];
  const filtered = data?.filtered ?? 0;
  const pageCount = Math.max(1, Math.ceil(filtered / pageSize));
  useEffect(() => { if (!loading && !error && page > pageCount) setPage(pageCount); }, [loading, error, page, pageCount]);

  function request(record, type) { keyRef.current = newKey(); setActionError(''); setConfirming({ record, type }); }
  async function confirm() {
    const { record, type } = confirming;
    setPending(true); setActionError('');
    const key = keyRef.current;
    try {
      await journaled(key, () => type === 'delete'
        ? deleteProduct(record.id, { idempotencyKey: key, expected_version: record.version })
        : setProductStatus(record.id, { idempotencyKey: key, expected_version: record.version, status: type === 'activate' ? 'active' : 'inactive' }));
      keyRef.current = null; setConfirming(null); load();
    } catch (e) {
      setActionError(e.uncertain ? `${e.message} Retry sends the same request identity, or use Check save outcome above.` : e.message);
      if (!e.uncertain) keyRef.current = null;
    } finally { setPending(false); }
  }
  const columns = [
    { key: 'sr', label: 'Sr No', render: (_r, i) => i + 1 },
    { key: 'name', label: 'Combo name', render: (r) => <strong className="admin-table__name">{r.name}</strong> },
    { key: 'members', label: 'Allergens', render: (r) => <>{r.members.length} members<span className="stock-sub">{r.members.map((m) => m.name).join(', ')}</span></> },
    { key: 'mrp', label: 'MRP', render: (r) => formatPrice(r.mrp) },
    { key: 'sp', label: 'Selling price', render: (r) => formatPrice(r.sellingPrice) },
    { key: 'st', label: 'Status', render: (r) => <StatusBadge status={r.status} id={r.id} kind="product" /> },
    { key: 'act', label: 'Actions', render: (r) => { const t = r.status === 'active' ? 'Inactivate' : 'Activate'; return <div className="admin-table__actions">
      <button type="button" className="admin-icon-button" aria-label={`View details, ${r.name}`} title="Details, activity and analytics" onClick={() => setViewing(r.id)} data-testid={`button-view-product-${r.id}`}><Eye size={16} /></button>
      <button type="button" disabled={!can.edit} className="admin-icon-button" aria-label={`Edit ${r.name}`} onClick={() => navigate(`${BASE}/${r.id}`)} data-testid={`button-edit-product-${r.id}`}><Pencil size={16} /></button>
      {can.protected && <button type="button" className="admin-icon-button" aria-label={`Assemble ${r.name}`} title="Assemble combos" disabled={r.status !== 'active'} onClick={() => navigate(`${BASE}/assemble?product=${r.id}`)} data-testid={`button-assemble-product-${r.id}`}><Layers size={16} /></button>}
      <button type="button" disabled={!can.edit} className="admin-icon-button" aria-label={`${t} ${r.name}`} onClick={() => request(r, t.toLowerCase())} data-testid={`button-status-product-${r.id}`}><CirclePower size={16} /></button>
      <button type="button" disabled={!can.delete} className="admin-icon-button admin-icon-button--danger" aria-label={`Delete ${r.name}`} onClick={() => request(r, 'delete')} data-testid={`button-delete-product-${r.id}`}><Trash2 size={16} /></button>
    </div>; } },
  ];
  const name = confirming?.type === 'delete' ? 'Delete' : confirming?.type === 'activate' ? 'Activate' : 'Inactivate';
  return <AdminLayout title="Product Master"><div className="product-master-page">
    <div className="admin-page-head"><div><p className="admin-page-head__eyebrow">Masters / Products & Supply</p><h1>Product Master</h1><p className="admin-page-head__description">Named combos of existing allergens with their own MRP and selling price. Saving a combo never creates stock.</p></div>
      <div className="admin-mr-head-actions">
        <button type="button" disabled={!can.import} className="admin-button admin-button--secondary" onClick={() => navigate('/admin/masters/import/product')} data-testid="button-import-products"><Upload size={16} aria-hidden="true" /> Import data</button>
        <DropdownMenu.Root open={exportMenuOpen} onOpenChange={(open) => { if (!open || !exportBusy.current) setExportMenuOpen(open); }}>
          <DropdownMenu.Trigger asChild><button type="button" className="admin-button admin-button--secondary" disabled={!can.export || loading || Boolean(error) || search.trim() !== applied} aria-disabled={exporting || undefined}><Download size={16} aria-hidden="true" />{exporting ? 'Exporting…' : 'Export data'}</button></DropdownMenu.Trigger>
          <DropdownMenu.Portal><DropdownMenu.Content className="admin-dropdown__menu admin-zone-export__menu" data-admin-theme={theme} data-admin-appearance={appearance} align="end" sideOffset={6} collisionPadding={12} aria-label="Product export format">
            <DropdownMenu.Item className="admin-dropdown__item" disabled={exporting} onSelect={() => void exportMatching('csv')}>CSV</DropdownMenu.Item>
            <DropdownMenu.Item className="admin-dropdown__item" disabled={exporting} onSelect={() => void exportMatching('xlsx')}>Excel (.xlsx)</DropdownMenu.Item>
          </DropdownMenu.Content></DropdownMenu.Portal>
        </DropdownMenu.Root>
        <button type="button" disabled={!can.add} className="admin-button" onClick={() => navigate(`${BASE}/new`)} data-testid="button-add-product"><Plus size={16} /> Add product</button></div></div>
    <ProductPendingBanner onResolved={(r) => { keyRef.current = null; if (r.state === 'committed') setConfirming(null); load(); }} />
    {actionError && !confirming && <div className="admin-feedback admin-feedback--error" role="alert">{actionError}</div>}
    <section className="admin-panel" aria-label="Product list">
      <div className="admin-allergen-toolbar">
        <div className="admin-allergen-toolbar__top master-filter-toolbar">
          <div className="admin-allergen-toolbar__search-group">
            <button type="button" className="admin-button admin-button--secondary" disabled={loading} onClick={load}>Refresh records</button>
            <div className="admin-filter admin-allergen-filters__search"><label className="admin-search"><Search size={16} aria-hidden="true" /><span className="sr-only">Search products by combo name</span><input id="product-search" type="search" maxLength={200} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search combo name" data-testid="input-search-products" /></label></div>
          </div>
          <MasterFilterReset disabled={!search && !activeFilters} onClick={() => { setSearch(''); setApplied(''); setStatus('all'); setCategory(null); setAllergens([]); setPage(1); }} />
        </div>
        <details className="admin-allergen-filter-disclosure"><summary><Filter size={15} aria-hidden="true" /> Filter records{activeFilters > 0 && ` · ${activeFilters} active`}<ChevronDown size={15} aria-hidden="true" /></summary>
          <div className="admin-allergen-filters product-master-filters">
            <div className="admin-filter"><label htmlFor="product-category">Category</label><ReferenceSelect id="product-category" label="Category" kind="categories" fetchPage={listProductFilterReferences} value={category?.value || ''} selected={category} onChange={(_v, option) => { setCategory(option || null); setPage(1); }} placeholder="All categories" /></div>
            <div className="admin-filter"><label htmlFor="product-allergens">Allergens</label><ReferenceSelect id="product-allergens" label="Allergens" kind="allergens" fetchPage={listProductFilterReferences} multiple selections={allergens} onChange={(options) => { setAllergens(options); setPage(1); }} placeholder="All allergens — search to select" /></div>
            <div className="admin-filter"><label htmlFor="product-status">Status</label><select id="product-status" className="admin-select" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} data-testid="select-product-status"><option value="all">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option></select></div>
          </div>
        </details>
      </div>
      {error ? <div className="admin-empty" role="alert"><strong>Products could not be loaded</strong><p>{error}</p><button type="button" className="admin-button" onClick={load}>Try again</button></div> : <>
        <DataTable columns={columns} rows={items} rowOffset={(page - 1) * pageSize} rowKey={(r) => r.id} label="Products" testIdPrefix="product" loading={loading}
          empty={<div className="admin-empty"><strong>{applied || activeFilters ? 'No products match' : 'No products yet'}</strong><p>{applied || activeFilters ? 'Clear the search, category, selected allergens or status filter. All filters apply together; category matches any current recipe member.' : 'Add your first combo of at least two allergens.'}</p></div>} />
        <TablePagination page={page} pageSize={pageSize} pageCount={pageCount} filtered={filtered} total={data?.total ?? 0} label="products" onPageChange={setPage} onPageSizeChange={(n) => { setPageSize(n); setPage(1); }} testId="text-product-count" /></>}
    </section>
    {viewing && <ProductDrawer id={viewing} onClose={() => setViewing(null)} />}
    {confirming && <ConfirmationDialog pending={pending} title={`${name} product?`} description={`Are you sure you want to ${name.toLowerCase()} “${confirming.record.name}”?${confirming.type !== 'activate' ? ' New assembly is blocked; retained stock and history stay viewable and transferable.' : ''}`} actionLabel={`${name} product`} destructive={confirming.type === 'delete'} onConfirm={confirm} onClose={() => { setConfirming(null); load(); }} error={actionError} />}
  </div></AdminLayout>;
}
