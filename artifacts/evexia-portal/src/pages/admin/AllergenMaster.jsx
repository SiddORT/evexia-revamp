import { useEffect, useRef, useState } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { useLocation } from 'wouter';
import { CirclePower, Download, Pencil, Plus, Search, Trash2, Upload } from 'lucide-react';
import AdminLayout from '../../components/admin/AdminLayout.jsx';
import AllergenRefPicker from '../../components/admin/AllergenRefPicker.jsx';
import { formatAdminTimestamp, useAdminPreferences } from '../../components/admin/adminPreferences.js';
import ConfirmationDialog from '../../components/admin/ConfirmationDialog.jsx';
import DataTable from '../../components/admin/DataTable.jsx';
import StatusBadge from '../../components/admin/StatusBadge.jsx';
import TablePagination from '../../components/admin/TablePagination.jsx';
import useServerAllergens from '../../hooks/useServerAllergens.js';
import { exportAllergens, downloadAllergenFile, validatePriceBounds } from '../../services/serverAllergens.js';
import { reportingIdentityGuard } from '../../auth/adminSession.js';
import '../../mr.css';
import '../../allergen.css';

const LIST_PATH = '/admin/masters/allergens';
const audit = (name, value) => <span className="admin-allergen-audit"><strong>{name || '—'}</strong><time dateTime={value}>{formatAdminTimestamp(value, undefined, true)}</time></span>;
const refName = (name, status) => <span className="admin-allergen-reference">{name}{status && status !== 'active' ? <small className="admin-allergen-secondary"> ({status})</small> : null}</span>;
const dash = (value) => value === null || value === undefined || value === '' ? '—' : value;

export default function AllergenMaster() {
  const { theme, appearance } = useAdminPreferences();
  const [, navigate] = useLocation();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [categoryId, setCategoryId] = useState('');
  const [locationId, setLocationId] = useState('');
  const [mix, setMix] = useState('all');
  const [minPrice, setMinPrice] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const priceErrors = validatePriceBounds(minPrice.trim(), maxPrice.trim());
  const invalid = Boolean(priceErrors.min || priceErrors.max);
  const filters = { query: search.trim(), status, categoryId, locationId, mix, minPrice: minPrice.trim(), maxPrice: maxPrice.trim(), invalid };
  const { records, total, filtered, loading, pending, error, feedback, clearFeedback, retry, remove, changeStatus } = useServerAllergens(filters, page, pageSize);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const busy = useRef(false);
  const alive = useRef(true);
  const controller = useRef(null);
  const [blocked, setBlocked] = useState(false);
  const [confirming, setConfirming] = useState(null);
  const [actionError, setActionError] = useState('');
  const hasFilters = Boolean(search || status !== 'all' || categoryId || locationId || mix !== 'all' || minPrice || maxPrice);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; controller.current?.abort(); };
  }, []);
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('saved')) window.history.replaceState(null, '', LIST_PATH);
  }, []);
  const pageCount = Math.max(1, Math.ceil(filtered / pageSize));
  useEffect(() => { if (!loading && !error && !invalid && page > pageCount) setPage(pageCount); }, [loading, error, invalid, page, pageCount]);
  const reset = (setter) => (event) => { setter(event.target.value); setPage(1); };
  function clearFilters() { setSearch(''); setStatus('all'); setCategoryId(''); setLocationId(''); setMix('all'); setMinPrice(''); setMaxPrice(''); setPage(1); }
  function requestAction(record, type) { clearFeedback(); setActionError(''); setBlocked(false); setConfirming({ record, type }); }
  async function confirmAction() {
    const guard = reportingIdentityGuard();
    const { record, type } = confirming;
    const result = await (type === 'delete' ? remove(record) : changeStatus(record, type === 'activate' ? 'active' : 'inactive'));
    try { guard(); } catch { return; }
    if (!alive.current) return;
    if (result.success) { setConfirming(null); setActionError(''); }
    else { setActionError(result.error); setBlocked(/stale|conflict/.test(result.code || '') || Boolean(result.ambiguous) || result.code === 'not_found'); }
  }
  async function exportVisible(format) {
    if (error || loading || invalid || busy.current) return;
    busy.current = true; setActionError(''); setExporting(true);
    const guard = reportingIdentityGuard();
    controller.current = new AbortController();
    const params = { query: filters.query, status, mix };
    if (categoryId) params.category_id = categoryId;
    if (locationId) params.storage_location_id = locationId;
    if (filters.minPrice) params.min_price = filters.minPrice;
    if (filters.maxPrice) params.max_price = filters.maxPrice;
    try {
      const blob = await exportAllergens(params, format, controller.current.signal);
      guard();
      if (alive.current) downloadAllergenFile(blob, format);
    } catch (cause) {
      try { guard(); } catch { return; }
      if (alive.current) setActionError(`Export failed (${format === 'xlsx' ? 'Excel' : 'CSV'}). ${cause.message}`);
    } finally { busy.current = false; if (alive.current) setExporting(false); }
  }
  function actions(record, mobile = false) {
    const toggle = record.status === 'active' ? 'Inactivate' : 'Activate';
    const cls = mobile ? 'admin-zone-card__action' : 'admin-icon-button';
    return <fieldset disabled={loading || pending} style={{ border: 0, margin: 0, padding: 0 }} className={mobile ? 'admin-zone-card__actions' : 'admin-table__actions'}>
      <button type="button" className={cls} aria-label={`Edit ${record.name}`} onClick={() => navigate(`${LIST_PATH}/${record.id}`)} data-testid={`button-edit-allergen-${record.id}`}><Pencil size={16} />{mobile && 'Edit'}</button>
      <button type="button" className={cls} aria-label={`${toggle} ${record.name}`} onClick={() => requestAction(record, toggle.toLowerCase())} data-testid={`button-status-allergen-${record.id}`}><CirclePower size={16} />{mobile && toggle}</button>
      <button type="button" className={mobile ? `${cls} admin-zone-card__action--danger` : `${cls} admin-icon-button--danger`} aria-label={`Delete ${record.name}`} onClick={() => requestAction(record, 'delete')} data-testid={`button-delete-allergen-${record.id}`}><Trash2 size={16} />{mobile && 'Delete'}</button>
    </fieldset>;
  }
  const columns = [
    { key: 'serial', label: 'Sr No', render: (_r, index) => index + 1 },
    { key: 'name', label: 'Product name', render: (r) => <strong className="admin-allergen-name" data-testid={`text-allergen-name-${r.id}`}>{r.name}</strong> },
    { key: 'category', label: 'Category', render: (r) => refName(r.category_name, r.category_status) },
    { key: 'price', label: 'Selling price', render: (r) => <span className="admin-allergen-number">{dash(r.selling_price)}</span> },
    { key: 'gst', label: 'GST (%)', render: (r) => <span className="admin-allergen-number">{r.gst}</span> },
    { key: 'location', label: 'Storage location', render: (r) => refName(r.storage_location_name, r.storage_location_status) },
    { key: 'concentration', label: 'Concentration', render: (r) => r.concentration },
    { key: 'threshold', label: 'Threshold limit', render: (r) => <span className="admin-allergen-number">{dash(r.threshold_limit)}</span> },
    { key: 'mix', label: 'Mix / No Mix', render: (r) => r.mix ? 'Mix' : 'No Mix' },
    { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} id={r.id} kind="allergen" /> },
    { key: 'created', label: 'Created details', render: (r) => audit(r.createdBy, r.createdAt) },
    { key: 'updated', label: 'Updated details', render: (r) => audit(r.updatedBy, r.updatedAt) },
    { key: 'actions', label: 'Actions', render: (r) => actions(r) },
  ];
  const actionName = confirming?.type === 'delete' ? 'Delete' : confirming?.type === 'activate' ? 'Activate' : 'Inactivate';
  return <AdminLayout title="Allergen Master">
    <div className="admin-page-head"><div><p className="admin-page-head__eyebrow">Masters / Inventory</p><h1>Allergen Master</h1><p className="admin-page-head__description">Shared server records with authenticated audit history. Mix / No Mix is catalogue metadata only. Clearing browser data does not remove products.</p></div>
      <div className="admin-mr-head-actions admin-allergen-head-actions">
        <button type="button" className="admin-button admin-button--secondary" onClick={() => navigate('/admin/masters/import/allergen')} data-testid="button-import-allergens"><Upload size={16} aria-hidden="true" /> Import data</button>
        <DropdownMenu.Root open={exportMenuOpen} onOpenChange={(open) => { if (!open || !busy.current) setExportMenuOpen(open); }}>
          <DropdownMenu.Trigger asChild>
            <button type="button" className="admin-button admin-button--secondary" disabled={loading || Boolean(error) || invalid} aria-disabled={exporting || undefined} data-testid="button-export-allergens"><Download size={16} aria-hidden="true" />{exporting ? 'Exporting…' : 'Export data'}</button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content className="admin-dropdown__menu admin-zone-export__menu" data-admin-theme={theme} data-admin-appearance={appearance} align="end" sideOffset={6} collisionPadding={12} style={{ maxWidth: 'calc(100vw - 24px)' }} aria-label="Allergen export format">
              <DropdownMenu.Item className="admin-dropdown__item" disabled={exporting} onSelect={() => void exportVisible('csv')}>CSV</DropdownMenu.Item>
              <DropdownMenu.Item className="admin-dropdown__item" disabled={exporting} onSelect={() => void exportVisible('xlsx')}>Excel (.xlsx)</DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
        <button type="button" className="admin-button" onClick={() => navigate(`${LIST_PATH}/new`)} data-testid="button-add-allergen"><Plus size={16} aria-hidden="true" /> Add product</button>
      </div>
    </div>
    <p className="admin-page-head__description">Exports include every record matching the current filters, up to 5,000 records. Local browser allergen data and procurement demos are separate and unaffected.</p>
    {feedback && <div className="admin-feedback" role="status">{feedback}</div>}
    {actionError && !confirming && <div className="admin-feedback admin-feedback--error" role="alert">{actionError}</div>}
    <section className="admin-panel" aria-label="Allergen list">
      <div className="admin-toolbar"><button type="button" className="admin-button admin-button--secondary" disabled={loading} onClick={retry}>Refresh records</button>
        <div className="admin-toolbar__fields">
          <label className="admin-search"><Search size={16} aria-hidden="true" /><span className="sr-only">Search products by name, category, storage location or concentration</span><input maxLength={200} value={search} onChange={reset(setSearch)} placeholder="Search product, category, location or concentration" data-testid="input-search-allergens" /></label>
          <div className="admin-filter"><label htmlFor="allergen-filter-status">Status</label><select id="allergen-filter-status" className="admin-select" value={status} onChange={reset(setStatus)} data-testid="select-filter-status"><option value="all">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option></select></div>
          <div className="admin-filter"><label htmlFor="allergen-filter-mix">Mix / No Mix</label><select id="allergen-filter-mix" className="admin-select" value={mix} onChange={reset(setMix)} data-testid="select-filter-mix"><option value="all">All</option><option value="mix">Mix</option><option value="no_mix">No Mix</option></select></div>
        </div>
      </div>
      <div className="admin-allergen-filters">
        <div className="admin-filter"><label htmlFor="allergen-filter-category">Product category</label><AllergenRefPicker id="allergen-filter-category" kind="categories" label="Product category" value={categoryId} includeUnusable allLabel="All categories" className="admin-select" testId="select-filter-category" onChange={(id) => { setCategoryId(id); setPage(1); }} /></div>
        <div className="admin-filter"><label htmlFor="allergen-filter-location">Storage location</label><AllergenRefPicker id="allergen-filter-location" kind="locations" label="Storage location" value={locationId} includeUnusable allLabel="All locations" className="admin-select" testId="select-filter-location" onChange={(id) => { setLocationId(id); setPage(1); }} /></div>
        <div className="admin-filter"><label htmlFor="allergen-min-price">Minimum price</label><input id="allergen-min-price" className="admin-select" inputMode="decimal" value={minPrice} onChange={reset(setMinPrice)} aria-invalid={Boolean(priceErrors.min)} data-testid="input-min-price" />{priceErrors.min && <p className="admin-allergen-filter-error" role="alert">{priceErrors.min}</p>}</div>
        <div className="admin-filter"><label htmlFor="allergen-max-price">Maximum price</label><input id="allergen-max-price" className="admin-select" inputMode="decimal" value={maxPrice} onChange={reset(setMaxPrice)} aria-invalid={Boolean(priceErrors.max)} data-testid="input-max-price" />{priceErrors.max && <p className="admin-allergen-filter-error" role="alert">{priceErrors.max}</p>}</div>
        <button type="button" className="admin-button admin-button--secondary" disabled={!hasFilters} onClick={clearFilters} data-testid="button-clear-filters">Clear filters</button>
      </div>
      {invalid ? <div className="admin-empty" role="status"><strong>Fix the price bounds</strong><p>Results are not loaded until minimum and maximum price are valid.</p></div>
        : loading ? <p className="admin-empty" role="status">Loading shared allergen products…</p>
        : error ? <div className="admin-empty" role="alert"><strong>Allergen products could not be loaded</strong><p>{error}</p><button type="button" className="admin-button" onClick={retry}>Try again</button></div> : <>
          {records.length ? <>
            <div className="admin-allergen-desktop"><DataTable columns={columns} rows={records} rowOffset={(page - 1) * pageSize} rowKey={(r) => r.id} label="Allergen records" /></div>
            <div className="admin-allergen-mobile" role="list" aria-label="Allergen records">{records.map((r, index) => <article className="admin-zone-card" role="listitem" key={r.id} data-testid={`card-allergen-${r.id}`}>
              <div className="admin-zone-card__heading"><div className="admin-zone-card__title"><span className="admin-zone-card__serial">#{(page - 1) * pageSize + index + 1}</span><h2 data-testid={`text-allergen-name-${r.id}`}>{r.name}</h2></div><StatusBadge status={r.status} id={`m-${r.id}`} kind="allergen" /></div>
              <p>{refName(r.category_name, r.category_status)} · {refName(r.storage_location_name, r.storage_location_status)}</p>
              <p>Price {dash(r.selling_price)} · GST {r.gst}% · {r.concentration} · Threshold {dash(r.threshold_limit)} · <strong>{r.mix ? 'Mix' : 'No Mix'}</strong></p>
              <dl className="admin-zone-card__meta"><div><dt>Created</dt><dd>{audit(r.createdBy, r.createdAt)}</dd></div><div><dt>Updated</dt><dd>{audit(r.updatedBy, r.updatedAt)}</dd></div></dl>{actions(r, true)}
            </article>)}</div></>
            : <div className="admin-empty"><strong>{total ? 'No matching products' : 'No allergen products yet'}</strong><p>{total ? 'Try other search text or clear a filter.' : 'Add your first shared product.'}</p>{total > 0 && hasFilters && <button type="button" className="admin-button admin-button--secondary" onClick={clearFilters}>Clear filters</button>}</div>}
          <TablePagination page={page} pageSize={pageSize} pageCount={pageCount} filtered={filtered} total={total} label="products" onPageChange={setPage} onPageSizeChange={(size) => { setPageSize(size); setPage(1); }} testId="text-allergen-count" />
        </>}
    </section>
    {confirming && <ConfirmationDialog pending={pending} blocked={blocked} title={`${actionName} product?`} description={`Are you sure you want to ${actionName.toLowerCase()} “${confirming.record.name}”?${confirming.type === 'delete' ? ' It disappears from ordinary lists and exports. Server deletion history is retained; no restore is available here.' : ''}`} actionLabel={`${actionName} product`} destructive={confirming.type === 'delete'} onConfirm={confirmAction} onClose={() => { setConfirming(null); retry(); }} error={actionError} />}
  </AdminLayout>;
}
