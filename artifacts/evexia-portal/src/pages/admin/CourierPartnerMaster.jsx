import { useEffect, useRef, useState } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { useLocation } from 'wouter';
import { CirclePower, Download, Pencil, Plus, Search, Trash2, Truck, Upload } from 'lucide-react';
import AdminLayout from '../../components/admin/AdminLayout.jsx';
import { formatAdminTimestamp, useAdminPreferences } from '../../components/admin/adminPreferences.js';
import ConfirmationDialog from '../../components/admin/ConfirmationDialog.jsx';
import CourierPartnerForm from '../../components/admin/CourierPartnerForm.jsx';
import DataTable from '../../components/admin/DataTable.jsx';
import StatusBadge from '../../components/admin/StatusBadge.jsx';
import TablePagination from '../../components/admin/TablePagination.jsx';
import useCourierPartners from '../../hooks/useCourierPartners.js';
import { exportCouriers, downloadCourierFile } from '../../services/serverCouriers.js';
import { reportingIdentityGuard } from '../../auth/adminSession.js';

function details(by, at) {
  return <span className="admin-table__details"><strong>{by}</strong><small>{formatAdminTimestamp(at)}</small></span>;
}

export default function CourierPartnerMaster() {
  const { theme, appearance } = useAdminPreferences();
  const [, navigate] = useLocation();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const { records, total, filtered, loading, pending, error, feedback, clearFeedback, retry, add, edit, remove, changeStatus } = useCourierPartners(search, filter, page, pageSize);
  const [exporting, setExporting] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const exportBusy = useRef(false);
  const exportMounted = useRef(true);
  useEffect(() => { exportMounted.current = true; return () => { exportMounted.current = false; }; }, []);
  const [blocked, setBlocked] = useState(false);
  const [editing, setEditing] = useState(null);
  const [confirming, setConfirming] = useState(null);
  const [actionError, setActionError] = useState('');
  const [cardView, setCardView] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 900px)').matches);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 900px)');
    const sync = () => setCardView(media.matches);
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);
  const pageCount = Math.max(1, Math.ceil(filtered / pageSize));
  const pagination = { page, pageSize, pageCount, pageRows: records, startIndex: (page - 1) * pageSize,
    setPage, setPageSize: (size) => { setPageSize(size); setPage(1); }, resetPage: () => setPage(1) };
  useEffect(() => { if (!loading && !error && page > pageCount) setPage(pageCount); }, [loading, error, page, pageCount]);

  async function save(values, record) {
    const result = await (editing === 'new' ? add(values) : edit(record, values));
    if (result.success) setEditing(null);
    return result;
  }
  function requestAction(record, type) {
    clearFeedback();
    setActionError('');
    setBlocked(false);
    setConfirming({ record, type });
  }
  async function confirmAction() {
    const { record, type } = confirming;
    const result = await (type === 'delete' ? remove(record) : changeStatus(record, type === 'activate' ? 'active' : 'inactive'));
    if (result.success) { setConfirming(null); setActionError(''); }
    else { setActionError(result.error); setBlocked(result.code === 'courier_stale' || Boolean(result.ambiguous)); }
  }
  async function exportVisible(format) {
    if (error || loading || exportBusy.current) return;
    exportBusy.current = true;
    setActionError('');
    setExporting(true);
    const guard = reportingIdentityGuard();
    try {
      const blob = await exportCouriers({ query: search, status: filter }, format);
      guard();
      if (exportMounted.current) downloadCourierFile(blob, format);
    } catch (cause) {
      if (exportMounted.current) setActionError(`Export failed (${format === 'xlsx' ? 'Excel' : 'CSV'}). ${cause.message || 'Refresh records and try again.'}`);
    } finally {
      exportBusy.current = false;
      if (exportMounted.current) setExporting(false);
    }
  }
  function actions(record, mobile = false) {
    const toggle = record.status === 'active' ? 'Inactivate' : 'Activate';
    return <fieldset disabled={loading || pending} style={{ border: 0, margin: 0, padding: 0 }} className={mobile ? 'admin-zone-card__actions' : 'admin-table__actions'}>
      <button type="button" className={mobile ? 'admin-zone-card__action' : 'admin-icon-button'} aria-label={`Edit ${record.name}`} title="Edit" onClick={() => { clearFeedback(); setEditing(record); }} data-testid={`button-edit-courier-partner-${record.id}`}><Pencil size={mobile ? 14 : 16} aria-hidden="true" />{mobile && <span>Edit</span>}</button>
      <button type="button" className={mobile ? 'admin-zone-card__action' : 'admin-icon-button'} aria-label={`${toggle} ${record.name}`} title={toggle} onClick={() => requestAction(record, toggle.toLowerCase())} data-testid={`button-toggle-courier-partner-${record.id}`}><CirclePower size={mobile ? 14 : 17} aria-hidden="true" />{mobile && <span>{toggle}</span>}</button>
      <button type="button" className={mobile ? 'admin-zone-card__action admin-zone-card__action--danger' : 'admin-icon-button admin-icon-button--danger'} aria-label={`Delete ${record.name}`} title="Delete" onClick={() => requestAction(record, 'delete')} data-testid={`button-delete-courier-partner-${record.id}`}><Trash2 size={mobile ? 14 : 16} aria-hidden="true" />{mobile && <span>Delete</span>}</button>
    </fieldset>;
  }
  const columns = [
    { key: 'serial', label: 'Sr No', render: (_record, index) => <span className="admin-table__serial">{index + 1}</span> },
    { key: 'name', label: 'Courier partner name', render: (record) => <span className="admin-table__name" data-testid={`text-courier-partner-name-${record.id}`}>{record.name}</span> },
    { key: 'status', label: 'Status', render: (record) => <StatusBadge status={record.status} id={record.id} /> },
    { key: 'created', label: 'Created details', render: (record) => details(record.createdBy, record.createdAt) },
    { key: 'updated', label: 'Updated details', render: (record) => details(record.updatedBy, record.updatedAt) },
    { key: 'actions', label: 'Actions', render: (record) => actions(record) },
  ];
  const actionName = confirming?.type === 'delete' ? 'Delete' : confirming?.type === 'activate' ? 'Activate' : 'Inactivate';
  return <AdminLayout title="Courier Partner Master">
    <div className="admin-page-head">
      <div><p className="admin-page-head__eyebrow">Masters / Delivery</p><h1>Courier Partner Master</h1><p className="admin-page-head__description">Shared server records with authenticated audit history. Browser data clearing does not remove these courier partners.</p></div>
      <div className="admin-mr-head-actions">
        <button type="button" className="admin-button admin-button--secondary" onClick={() => navigate('/admin/masters/import/courier-partner')} data-testid="button-import-courier-partners"><Upload size={16} aria-hidden="true" /> Import data</button>
        <DropdownMenu.Root open={exportMenuOpen} onOpenChange={(open) => { if (!open || !exportBusy.current) setExportMenuOpen(open); }}>
          <DropdownMenu.Trigger asChild>
            {/* Keep the pending trigger focusable for menu close-focus return. */}
            <button type="button" className="admin-button admin-button--secondary" disabled={Boolean(error) || loading} aria-disabled={exporting || undefined} data-testid="button-export-courier-partners"><Download size={16} aria-hidden="true" />{exporting ? 'Exporting…' : 'Export data'}</button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content className="admin-profile__menu" data-admin-theme={theme} data-admin-appearance={appearance} align="end" sideOffset={6} collisionPadding={12} style={{ maxWidth: 'calc(100vw - 24px)' }} aria-label="Courier export format">
              <DropdownMenu.Item className="admin-profile__settings" disabled={exporting} onSelect={() => void exportVisible('csv')}>CSV</DropdownMenu.Item>
              <DropdownMenu.Item className="admin-profile__settings" disabled={exporting} onSelect={() => void exportVisible('xlsx')}>Excel (.xlsx)</DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
        <button type="button" className="admin-button" disabled={Boolean(error)} onClick={() => { clearFeedback(); setEditing('new'); }} data-testid="button-add-courier-partner"><Plus size={16} aria-hidden="true" /> Add courier partner</button>
      </div>
    </div>
    <p className="admin-page-head__description">Old browser records remain untouched and are not migrated or used as fallback. Explicitly import an existing CSV backup. Exports include all name/status matches, up to 5,000 records; larger results require narrower filters.</p>
    {feedback && <div className="admin-feedback" role="status" data-testid="status-courier-partner-feedback">{feedback}</div>}
    {actionError && !confirming && <div className="admin-feedback admin-feedback--error" role="alert" data-testid="status-courier-partner-action-error">{actionError}</div>}
    <section className="admin-panel" aria-label="Courier partner list">
      <div className="admin-toolbar"><button className="admin-button admin-button--secondary" disabled={loading} onClick={retry}>Refresh records</button><div className="admin-toolbar__fields">
        <label className="admin-search"><Search size={16} aria-hidden="true" /><span className="sr-only">Search courier partners by name</span><input maxLength={200} value={search} onChange={(event) => { setSearch(event.target.value); pagination.resetPage(); }} placeholder="Search by courier partner name" data-testid="input-search-courier-partners" /></label>
        <div className="admin-filter"><label htmlFor="courier-partner-filter">Status</label><select id="courier-partner-filter" className="admin-select" value={filter} onChange={(event) => { setFilter(event.target.value); pagination.resetPage(); }} data-testid="select-filter-courier-partners"><option value="all">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option></select></div>
      </div></div>
      {loading ? <p className="admin-empty" role="status">Loading shared courier partners…</p> : error ? <div className="admin-empty" role="alert"><span className="admin-empty__icon"><Truck size={21} /></span><strong>Courier partners could not be loaded</strong><p>{error}</p><button className="admin-button" style={{ marginTop: 16 }} type="button" onClick={retry} data-testid="button-retry-courier-partners">Try again</button></div> : <>
        {records.length ? (cardView ? <div className="admin-zone-cards" role="list" aria-label="Courier partner records">
          {pagination.pageRows.map((record, index) => <article className="admin-zone-card" role="listitem" key={record.id} data-testid={`card-courier-partner-${record.id}`}>
            <div className="admin-zone-card__heading"><div className="admin-zone-card__title"><span className="admin-zone-card__serial">#{pagination.startIndex + index + 1}</span><h2 data-testid={`text-courier-partner-name-${record.id}`}>{record.name}</h2></div><StatusBadge status={record.status} id={record.id} /></div>
            <dl className="admin-zone-card__meta"><div><dt>Created</dt><dd>{details(record.createdBy, record.createdAt)}</dd></div><div><dt>Updated</dt><dd>{details(record.updatedBy, record.updatedAt)}</dd></div></dl>
            {actions(record, true)}
          </article>)}
        </div> : <DataTable columns={columns} rows={pagination.pageRows} rowOffset={pagination.startIndex} rowKey={(record) => record.id} />) : <div className="admin-empty" data-testid="status-courier-partners-empty"><span className="admin-empty__icon"><Truck size={21} aria-hidden="true" /></span><strong>{total ? 'No matching courier partners' : 'No courier partners yet'}</strong><p>{total ? 'Try a different name or status filter.' : 'Add your first courier partner to get started.'}</p></div>}
        <TablePagination {...pagination} filtered={filtered} total={total} label={total === 1 ? 'courier partner' : 'courier partners'} onPageChange={pagination.setPage} onPageSizeChange={pagination.setPageSize} testId="text-courier-partner-count" />
      </>}
    </section>
    {editing && <CourierPartnerForm partner={editing === 'new' ? null : editing} onSave={save} onClose={() => setEditing(null)} />}
    {confirming && <ConfirmationDialog pending={pending} blocked={blocked} title={`${actionName} courier partner?`} description={`Are you sure you want to ${actionName.toLowerCase()} “${confirming.record.name}”?${confirming.type === 'delete' ? ' It will disappear from ordinary lists and exports. Server deletion history is retained; no restore is available here.' : ''}`} actionLabel={`${actionName} courier partner`} destructive={confirming.type === 'delete'} onConfirm={confirmAction} onClose={() => { setConfirming(null); retry(); }} error={actionError} />}
  </AdminLayout>;
}