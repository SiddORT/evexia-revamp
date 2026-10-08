import { useEffect, useRef, useState } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { useLocation } from 'wouter';
import { CirclePower, Download, Pencil, Plus, Search, Trash2, Upload } from 'lucide-react';
import AdminLayout from '../../components/admin/AdminLayout.jsx';
import { formatAdminTimestamp, useAdminPreferences } from '../../components/admin/adminPreferences.js';
import ConfirmationDialog from '../../components/admin/ConfirmationDialog.jsx';
import DataTable from '../../components/admin/DataTable.jsx';
import StatusBadge from '../../components/admin/StatusBadge.jsx';
import TablePagination from '../../components/admin/TablePagination.jsx';
import useServerProductCategories from '../../hooks/useServerProductCategories.js';
import { exportProductCategories, downloadProductCategoryFile } from '../../services/serverProductCategories.js';
import { reportingIdentityGuard } from '../../auth/adminSession.js';
import { useMasterActions } from '../../auth/useMasterActions.js';
import '../../mr.css';
import '../../category.css';

const LIST = '/admin/masters/product-categories';
function details(by, at) {
  return <span className="admin-table__details"><strong>{by}</strong><small>{formatAdminTimestamp(at)}</small></span>;
}

export default function ProductCategoryMaster() {
  const can = useMasterActions('product_category');
  const { theme, appearance } = useAdminPreferences();
  const [, navigate] = useLocation();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [minPrice, setMinPrice] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const { records, total, filtered, loading, pending, error, feedback, clearFeedback, retry, remove, changeStatus } = useServerProductCategories(search, filter, page, pageSize, minPrice, maxPrice);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const busy = useRef(false);
  const alive = useRef(true);
  const controller = useRef(null);
  const [blocked, setBlocked] = useState(false);
  const [confirming, setConfirming] = useState(null);
  const [actionError, setActionError] = useState('');
  const [cardView, setCardView] = useState(() => window.matchMedia('(max-width: 900px)').matches);
  useEffect(() => {
    alive.current = true;
    const media = window.matchMedia('(max-width: 900px)');
    const sync = () => setCardView(media.matches);
    media.addEventListener('change', sync);
    return () => { alive.current = false; controller.current?.abort(); media.removeEventListener('change', sync); };
  }, []);
  const pageCount = Math.max(1, Math.ceil(filtered / pageSize));
  useEffect(() => { if (!loading && !error && page > pageCount) setPage(pageCount); }, [loading, error, page, pageCount]);
  function requestAction(record, type) {
    clearFeedback(); setActionError(''); setBlocked(false); setConfirming({ record, type });
  }
  async function confirmAction() {
    const guard = reportingIdentityGuard();
    const { record, type } = confirming;
    const result = await (type === 'delete' ? remove(record) : changeStatus(record, type === 'activate' ? 'active' : 'inactive'));
    try { guard(); } catch { return; }
    if (!alive.current) return;
    if (result.success) { setConfirming(null); setActionError(''); }
    else { setActionError(result.error); setBlocked(result.code === 'product_category_stale' || Boolean(result.ambiguous) || result.code === 'not_found'); }
  }
  async function exportVisible(format) {
    if (error || loading || busy.current) return;
    busy.current = true; setActionError(''); setExporting(true);
    const guard = reportingIdentityGuard();
    controller.current = new AbortController();
    try {
      const blob = await exportProductCategories({ query: search, status: filter, min_price: minPrice, max_price: maxPrice }, format, controller.current.signal);
      guard();
      if (alive.current) downloadProductCategoryFile(blob, format);
    } catch (cause) {
      try { guard(); } catch { return; }
      if (alive.current) setActionError(`Export failed (${format === 'xlsx' ? 'Excel' : 'CSV'}). ${cause.message}`);
    } finally { busy.current = false; if (alive.current) setExporting(false); }
  }
  function actions(record, mobile = false) {
    const toggle = record.status === 'active' ? 'Inactivate' : 'Activate';
    return <fieldset disabled={loading || pending} style={{ border: 0, margin: 0, padding: 0 }} className={mobile ? 'admin-zone-card__actions' : 'admin-table__actions'}>
      {can.edit && <button type="button" className={mobile ? 'admin-zone-card__action' : 'admin-icon-button'} aria-label={`Edit ${record.name}`} onClick={() => navigate(`${LIST}/${record.id}`)}><Pencil size={16} />{mobile && 'Edit'}</button>}
      {can.edit && <button type="button" className={mobile ? 'admin-zone-card__action' : 'admin-icon-button'} aria-label={`${toggle} ${record.name}`} onClick={() => requestAction(record, toggle.toLowerCase())}><CirclePower size={16} />{mobile && toggle}</button>}
      {can.delete && <button type="button" className={mobile ? 'admin-zone-card__action admin-zone-card__action--danger' : 'admin-icon-button admin-icon-button--danger'} aria-label={`Delete ${record.name}`} onClick={() => requestAction(record, 'delete')}><Trash2 size={16} />{mobile && 'Delete'}</button>}
    </fieldset>;
  }
  const columns = [
    { key: 'serial', label: 'Sr No', render: (_record, index) => index + 1 },
    { key: 'name', label: 'Category name', render: (record) => <strong>{record.name}</strong> },
    { key: 'description', label: 'Description', render: (record) => <span className="admin-category-description">{record.description || '—'}</span> },
    { key: 'unit_price', label: 'Unit price', render: (record) => <span className="admin-category-price">{record.unit_price}</span> },
    { key: 'status', label: 'Status', render: (record) => <StatusBadge status={record.status} id={record.id} /> },
    { key: 'created', label: 'Created details', render: (record) => details(record.createdBy, record.createdAt) },
    { key: 'updated', label: 'Updated details', render: (record) => details(record.updatedBy, record.updatedAt) },
    { key: 'actions', label: 'Actions', render: (record) => actions(record) },
  ];
  const actionName = confirming?.type === 'delete' ? 'Delete' : confirming?.type === 'activate' ? 'Activate' : 'Inactivate';
  return <AdminLayout title="Product Category Master">
    <div className="admin-page-head"><div><p className="admin-page-head__eyebrow">Masters / Directory</p><h1>Product Category Master</h1><p className="admin-page-head__description">Shared server records with authenticated audit history. Clearing browser data does not remove categories.</p></div>
      <div className="admin-mr-head-actions">
        {can.import && <button className="admin-button admin-button--secondary" onClick={() => navigate('/admin/masters/import/product-category')}><Upload size={16} /> Import data</button>}
        {can.export && <DropdownMenu.Root open={exportMenuOpen} onOpenChange={(open) => { if (!open || !busy.current) setExportMenuOpen(open); }}>
          <DropdownMenu.Trigger asChild>
            {/* Pending stays focusable for close-focus return. The synchronous
                guard and controlled menu prevent reopening or duplicate downloads. */}
            <button type="button" className="admin-button admin-button--secondary" disabled={loading || Boolean(error)} aria-disabled={exporting || undefined} data-testid="button-export-categories"><Download size={16} aria-hidden="true" />{exporting ? 'Exporting…' : 'Export data'}</button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content className="admin-dropdown__menu admin-zone-export__menu" data-admin-theme={theme} data-admin-appearance={appearance} align="end" sideOffset={6} collisionPadding={12} style={{ maxWidth: 'calc(100vw - 24px)' }} aria-label="Product category export format">
              <DropdownMenu.Item className="admin-dropdown__item" disabled={exporting} onSelect={() => void exportVisible('csv')}>CSV</DropdownMenu.Item>
              <DropdownMenu.Item className="admin-dropdown__item" disabled={exporting} onSelect={() => void exportVisible('xlsx')}>Excel (.xlsx)</DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>}
        {can.add && <button className="admin-button" onClick={() => navigate(`${LIST}/new`)}><Plus size={16} /> Add category</button>}
      </div>
    </div>
    <p className="admin-page-head__description">Allergen and procurement keep their separate browser-local category IDs and data. Live changes do not affect demo inventory. Exports include every name/description/price/status match, up to 5,000 records.</p>
    {feedback && <div className="admin-feedback" role="status">{feedback}</div>}
    {actionError && !confirming && <div className="admin-feedback admin-feedback--error" role="alert">{actionError}</div>}
    <section className="admin-panel" aria-label="Product category list">
      <div className="admin-toolbar"><button className="admin-button admin-button--secondary" disabled={loading} onClick={retry}>Refresh records</button><div className="admin-toolbar__fields">
        <label className="admin-search"><Search size={16} /><span className="sr-only">Search categories by name, description or price</span><input maxLength={200} value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Search category, description or price" /></label>
        <div className="admin-filter"><label htmlFor="hq-filter">Status</label><select id="hq-filter" className="admin-select" value={filter} onChange={(event) => { setFilter(event.target.value); setPage(1); }}><option value="all">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option></select></div>
      </div><label className="admin-filter">Minimum price<input className="admin-select" inputMode="decimal" value={minPrice} onChange={(event) => { setMinPrice(event.target.value); setPage(1); }} /></label><label className="admin-filter">Maximum price<input className="admin-select" inputMode="decimal" value={maxPrice} onChange={(event) => { setMaxPrice(event.target.value); setPage(1); }} /></label></div>
      {loading ? <p className="admin-empty" role="status">Loading shared categories…</p> : error ? <div className="admin-empty" role="alert"><strong>ProductCategories could not be loaded</strong><p>{error}</p><button className="admin-button" onClick={retry}>Try again</button></div> : <>
        {records.length ? cardView ? <div className="admin-zone-cards" role="list" aria-label="Product category records">{records.map((record, index) => <article className="admin-zone-card" role="listitem" key={record.id}>
          <div className="admin-zone-card__heading"><div className="admin-zone-card__title"><span className="admin-zone-card__serial">#{(page - 1) * pageSize + index + 1}</span><h2>{record.name}</h2></div><StatusBadge status={record.status} id={record.id} /></div>
          <p>{record.description || 'No description'}</p><p>Unit price: <strong>{record.unit_price}</strong></p><dl className="admin-zone-card__meta"><div><dt>Created</dt><dd>{details(record.createdBy, record.createdAt)}</dd></div><div><dt>Updated</dt><dd>{details(record.updatedBy, record.updatedAt)}</dd></div></dl>{actions(record, true)}
        </article>)}</div> : <DataTable columns={columns} rows={records} rowOffset={(page - 1) * pageSize} rowKey={(record) => record.id} /> : <div className="admin-empty"><strong>{total ? 'No matching categories' : 'No categories yet'}</strong><p>{total ? 'Try another name, description, price or status filter.' : 'Add your first shared category.'}</p></div>}
        <TablePagination page={page} pageSize={pageSize} pageCount={pageCount} filtered={filtered} total={total} label="categories" onPageChange={setPage} onPageSizeChange={(size) => { setPageSize(size); setPage(1); }} testId="text-category-count" />
      </>}
    </section>
    {confirming && <ConfirmationDialog pending={pending} blocked={blocked} title={`${actionName} category?`} description={`Are you sure you want to ${actionName.toLowerCase()} “${confirming.record.name}”?${confirming.type === 'delete' ? ' It disappears from ordinary lists and exports. Server deletion history is retained; no restore is available here.' : ''}`} actionLabel={`${actionName} category`} destructive={confirming.type === 'delete'} onConfirm={confirmAction} onClose={() => { setConfirming(null); retry(); }} error={actionError} />}
  </AdminLayout>;
}
