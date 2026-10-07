import { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { CirclePower, Download, Pencil, Plus, Search, Trash2, MapPin, Upload } from 'lucide-react';
import StorageLocationImportDialog from '../../components/admin/StorageLocationImportDialog.jsx';
import AdminLayout from '../../components/admin/AdminLayout.jsx';
import { formatAdminTimestamp, useAdminPreferences } from '../../components/admin/adminPreferences.js';
import ConfirmationDialog from '../../components/admin/ConfirmationDialog.jsx';
import DataTable from '../../components/admin/DataTable.jsx';
import StatusBadge from '../../components/admin/StatusBadge.jsx';
import TablePagination from '../../components/admin/TablePagination.jsx';
import useServerLocations from '../../hooks/useServerLocations.js';
import { exportLocations, downloadLocationFile } from '../../services/serverLocations.js';
import { reportingIdentityGuard } from '../../auth/adminSession.js';

function details(by, at) {
  return <span className="admin-table__details"><strong>{by}</strong><small>{formatAdminTimestamp(at)}</small></span>;
}

export default function StorageLocationMaster() {
  useAdminPreferences();
  const [, navigate] = useLocation();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const { records, total, filtered, loading, pending, error, feedback, clearFeedback, retry, add, edit, remove, changeStatus } = useServerLocations(search, filter, page, pageSize);
  const [exportFormat, setExportFormat] = useState('csv');
  const [exporting, setExporting] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [importing, setImporting] = useState(false);
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
    else { setActionError(result.error); setBlocked(result.code === 'location_stale' || Boolean(result.ambiguous)); }
  }
  async function exportVisible() {
    if (error || exporting) return;
    setActionError('');
    setExporting(true);
    const guard = reportingIdentityGuard();
    const format = exportFormat;
    try {
      const blob = await exportLocations({ query: search, status: filter }, format);
      guard();
      downloadLocationFile(blob, format);
    } catch (cause) {
      setActionError(cause.message || 'CSV export failed. Refresh records and try again.');
    } finally { setExporting(false); }
  }
  function actions(record, mobile = false) {
    const toggle = record.status === 'active' ? 'Inactivate' : 'Activate';
    return <fieldset disabled={loading || pending} style={{ border: 0, margin: 0, padding: 0 }} className={mobile ? 'admin-zone-card__actions' : 'admin-table__actions'}>
      <button type="button" className={mobile ? 'admin-zone-card__action' : 'admin-icon-button'} aria-label={`Edit ${record.name}`} title="Edit" onClick={() => { clearFeedback(); navigate(`/admin/masters/storage-locations/${record.id}`); }} data-testid={`button-edit-storage-location-${record.id}`}><Pencil size={mobile ? 14 : 16} aria-hidden="true" />{mobile && <span>Edit</span>}</button>
      <button type="button" className={mobile ? 'admin-zone-card__action' : 'admin-icon-button'} aria-label={`${toggle} ${record.name}`} title={toggle} onClick={() => requestAction(record, toggle.toLowerCase())} data-testid={`button-toggle-storage-location-${record.id}`}><CirclePower size={mobile ? 14 : 17} aria-hidden="true" />{mobile && <span>{toggle}</span>}</button>
      <button type="button" className={mobile ? 'admin-zone-card__action admin-zone-card__action--danger' : 'admin-icon-button admin-icon-button--danger'} aria-label={`Delete ${record.name}`} title="Delete" onClick={() => requestAction(record, 'delete')} data-testid={`button-delete-storage-location-${record.id}`}><Trash2 size={mobile ? 14 : 16} aria-hidden="true" />{mobile && <span>Delete</span>}</button>
    </fieldset>;
  }
  const columns = [
    { key: 'serial', label: 'Sr No', render: (_record, index) => <span className="admin-table__serial">{index + 1}</span> },
    { key: 'name', label: 'Storage location name', render: (record) => <span className="admin-table__name" data-testid={`text-storage-location-name-${record.id}`}>{record.name}</span> },
    { key: 'address', label: 'Address', render: (record) => record.address },
    { key: 'status', label: 'Status', render: (record) => <StatusBadge status={record.status} id={record.id} /> },
    { key: 'created', label: 'Created details', render: (record) => details(record.createdBy, record.createdAt) },
    { key: 'updated', label: 'Updated details', render: (record) => details(record.updatedBy, record.updatedAt) },
    { key: 'actions', label: 'Actions', render: (record) => actions(record) },
  ];
  const actionName = confirming?.type === 'delete' ? 'Delete' : confirming?.type === 'activate' ? 'Activate' : 'Inactivate';
  return <AdminLayout title="Storage Location Master">
    <div className="admin-page-head">
      <div><p className="admin-page-head__eyebrow">Masters / Inventory</p><h1>Storage Location Master</h1><p className="admin-page-head__description">Shared server records with authenticated audit history. Browser data clearing does not remove these storage locations.</p></div>
      <div className="admin-mr-head-actions">
        <button type="button" className="admin-button admin-button--secondary" onClick={() => setImporting(true)} data-testid="button-import-storage-locations"><Upload size={16} aria-hidden="true" /> Import data</button>
        <select aria-label="Location export format" className="admin-select" value={exportFormat} onChange={(event) => setExportFormat(event.target.value)}><option value="csv">CSV</option><option value="xlsx">Excel (.xlsx)</option></select>
        <button type="button" className="admin-button admin-button--secondary" disabled={Boolean(error) || loading || exporting} onClick={exportVisible} data-testid="button-export-storage-locations"><Download size={16} aria-hidden="true" />{exporting ? 'Exporting…' : 'Export data'}</button>
        <button type="button" className="admin-button" disabled={Boolean(error)} onClick={() => { clearFeedback(); navigate('/admin/masters/storage-locations/new'); }} data-testid="button-add-storage-location"><Plus size={16} aria-hidden="true" /> Add storage location</button>
      </div>
    </div>
    <p className="admin-page-head__description">Old browser records remain untouched and are not migrated or used as fallback. Explicitly import an existing CSV backup. Exports include all name/address/status matches, up to 5,000 records; larger results require narrower filters.</p>
    <p className="admin-page-head__description">Allergen, Purchase Order and Purchase Received continue using separate browser-local locations and IDs. Edits here do not change those workflows or inventory.</p>
    {feedback && <div className="admin-feedback" role="status" data-testid="status-storage-location-feedback">{feedback}</div>}
    {actionError && !confirming && <div className="admin-feedback admin-feedback--error" role="alert" data-testid="status-storage-location-action-error">{actionError}</div>}
    <section className="admin-panel" aria-label="Storage location list">
      <div className="admin-toolbar"><button className="admin-button admin-button--secondary" disabled={loading} onClick={retry}>Refresh records</button><div className="admin-toolbar__fields">
        <label className="admin-search"><Search size={16} aria-hidden="true" /><span className="sr-only">Search storage locations by name or address</span><input maxLength={200} value={search} onChange={(event) => { setSearch(event.target.value); pagination.resetPage(); }} placeholder="Search by location name or address" data-testid="input-search-storage-locations" /></label>
        <div className="admin-filter"><label htmlFor="storage-location-filter">Status</label><select id="storage-location-filter" className="admin-select" value={filter} onChange={(event) => { setFilter(event.target.value); pagination.resetPage(); }} data-testid="select-filter-storage-locations"><option value="all">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option></select></div>
      </div></div>
      {loading ? <p className="admin-empty" role="status">Loading shared storage locations…</p> : error ? <div className="admin-empty" role="alert"><span className="admin-empty__icon"><MapPin size={21} /></span><strong>Storage locations could not be loaded</strong><p>{error}</p><button className="admin-button" style={{ marginTop: 16 }} type="button" onClick={retry} data-testid="button-retry-storage-locations">Try again</button></div> : <>
        {records.length ? (cardView ? <div className="admin-zone-cards" role="list" aria-label="Storage location records">
          {pagination.pageRows.map((record, index) => <article className="admin-zone-card" role="listitem" key={record.id} data-testid={`card-storage-location-${record.id}`}>
            <div className="admin-zone-card__heading"><div className="admin-zone-card__title"><span className="admin-zone-card__serial">#{pagination.startIndex + index + 1}</span><h2 data-testid={`text-storage-location-name-${record.id}`}>{record.name}</h2></div><StatusBadge status={record.status} id={record.id} /></div>
            <p>{record.address}</p><dl className="admin-zone-card__meta"><div><dt>Created</dt><dd>{details(record.createdBy, record.createdAt)}</dd></div><div><dt>Updated</dt><dd>{details(record.updatedBy, record.updatedAt)}</dd></div></dl>
            {actions(record, true)}
          </article>)}
        </div> : <DataTable columns={columns} rows={pagination.pageRows} rowOffset={pagination.startIndex} rowKey={(record) => record.id} />) : <div className="admin-empty" data-testid="status-storage-locations-empty"><span className="admin-empty__icon"><MapPin size={21} aria-hidden="true" /></span><strong>{total ? 'No matching storage locations' : 'No storage locations yet'}</strong><p>{total ? 'Try a different name or status filter.' : 'Add your first storage location to get started.'}</p></div>}
        <TablePagination {...pagination} filtered={filtered} total={total} label={total === 1 ? 'storage location' : 'storage locations'} onPageChange={pagination.setPage} onPageSizeChange={pagination.setPageSize} testId="text-storage-location-count" />
      </>}
    </section>
    {importing && <StorageLocationImportDialog onClose={() => setImporting(false)} onSaved={retry} />}
    {confirming && <ConfirmationDialog pending={pending} blocked={blocked} title={`${actionName} storage location?`} description={`Are you sure you want to ${actionName.toLowerCase()} “${confirming.record.name}”?${confirming.type === 'delete' ? ' It will disappear from ordinary lists and exports. Server deletion history is retained; no restore is available here.' : ''}`} actionLabel={`${actionName} storage location`} destructive={confirming.type === 'delete'} onConfirm={confirmAction} onClose={() => { setConfirming(null); retry(); }} error={actionError} />}
  </AdminLayout>;
}