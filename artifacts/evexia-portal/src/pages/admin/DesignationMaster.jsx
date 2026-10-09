import { useEffect, useRef, useState } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { useLocation } from 'wouter';
import { CirclePower, Download, Pencil, Plus, Search, Trash2, BriefcaseBusiness, Upload } from 'lucide-react';
import AdminLayout from '../../components/admin/AdminLayout.jsx';
import { formatAdminTimestamp, useAdminPreferences } from '../../components/admin/adminPreferences.js';
import ConfirmationDialog from '../../components/admin/ConfirmationDialog.jsx';
import DataTable from '../../components/admin/DataTable.jsx';
import StatusBadge from '../../components/admin/StatusBadge.jsx';
import TablePagination from '../../components/admin/TablePagination.jsx';
import useServerDesignations from '../../hooks/useDesignations.js';
import { exportDesignations, downloadDesignationFile } from '../../services/serverDesignations.js';
import { reportingIdentityGuard } from '../../auth/adminSession.js';
import '../../designation.css';

function details(by, at) {
  return <span className="admin-table__details"><strong>{by}</strong><small>{formatAdminTimestamp(at)}</small></span>;
}

export default function DesignationMaster() {
  const { theme, appearance } = useAdminPreferences();
  const [, navigate] = useLocation();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const { records, total, filtered, loading, pending, error, feedback, clearFeedback, retry, add, edit, remove, changeStatus } = useServerDesignations(search, filter, page, pageSize);
  const [exporting, setExporting] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const exportBusy = useRef(false);
  const exportMounted = useRef(true);
  const exportController = useRef(null);
  useEffect(() => {
    exportMounted.current = true;
    return () => { exportMounted.current = false; exportController.current?.abort(); };
  }, []);
  const [blocked, setBlocked] = useState(false);
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
    else { setActionError(result.error); setBlocked(result.code === 'designation_stale' || Boolean(result.ambiguous)); }
  }
  async function exportVisible(format) {
    if (error || loading || exportBusy.current) return;
    exportBusy.current = true;
    setActionError('');
    setExporting(true);
    const guard = reportingIdentityGuard();
    const controller = new AbortController();
    exportController.current = controller;
    try {
      const blob = await exportDesignations({ query: search, status: filter }, format, controller.signal);
      guard();
      if (exportMounted.current) downloadDesignationFile(blob, format);
    } catch (cause) {
      // Do not let a response from a previous login update this screen.
      try { guard(); } catch { return; }
      if (exportMounted.current) setActionError(`Export failed (${format === 'xlsx' ? 'Excel' : 'CSV'}). ${cause.message || 'Refresh records and try again.'}`);
    } finally {
      exportBusy.current = false;
      if (exportMounted.current) setExporting(false);
    }
  }
  function actions(record, mobile = false) {
    const toggle = record.status === 'active' ? 'Inactivate' : 'Activate';
    return <fieldset disabled={loading || pending} style={{ border: 0, margin: 0, padding: 0 }} className={mobile ? 'admin-zone-card__actions' : 'admin-table__actions'}>
      <button type="button" className={mobile ? 'admin-zone-card__action' : 'admin-icon-button'} aria-label={`Edit ${record.name}`} title="Edit" onClick={() => { clearFeedback(); navigate(`/admin/masters/designations/${record.id}`); }} data-testid={`button-edit-designation-${record.id}`}><Pencil size={mobile ? 14 : 16} aria-hidden="true" />{mobile && <span>Edit</span>}</button>
      <button type="button" className={mobile ? 'admin-zone-card__action' : 'admin-icon-button'} aria-label={`${toggle} ${record.name}`} title={toggle} onClick={() => requestAction(record, toggle.toLowerCase())} data-testid={`button-toggle-designation-${record.id}`}><CirclePower size={mobile ? 14 : 17} aria-hidden="true" />{mobile && <span>{toggle}</span>}</button>
      <button type="button" className={mobile ? 'admin-zone-card__action admin-zone-card__action--danger' : 'admin-icon-button admin-icon-button--danger'} aria-label={`Delete ${record.name}`} title="Delete" onClick={() => requestAction(record, 'delete')} data-testid={`button-delete-designation-${record.id}`}><Trash2 size={mobile ? 14 : 16} aria-hidden="true" />{mobile && <span>Delete</span>}</button>
    </fieldset>;
  }
  const columns = [
    { key: 'serial', label: 'Sr No', render: (_record, index) => <span className="admin-table__serial">{index + 1}</span> },
    { key: 'name', label: 'Designation name', render: (record) => <span className="admin-table__name" data-testid={`text-designation-name-${record.id}`}>{record.name}</span> },
    { key: 'shortName', label: 'Short Name', render: (record) => record.shortName },
    { key: 'level', label: 'Level', render: (record) => record.level },
    { key: 'status', label: 'Status', render: (record) => <StatusBadge status={record.status} id={record.id} /> },
    { key: 'created', label: 'Created details', render: (record) => details(record.createdBy, record.createdAt) },
    { key: 'updated', label: 'Updated details', render: (record) => details(record.updatedBy, record.updatedAt) },
    { key: 'actions', label: 'Actions', render: (record) => actions(record) },
  ];
  const actionName = confirming?.type === 'delete' ? 'Delete' : confirming?.type === 'activate' ? 'Activate' : 'Inactivate';
  return <AdminLayout title="Designation Master">
    <div className="admin-page-head">
      <div><p className="admin-page-head__eyebrow">User Management</p><h1>Designation Master</h1><p className="admin-page-head__description">Designation labels do not grant staff permissions or change payroll.</p></div>
      <div className="admin-mr-head-actions">
        <button type="button" className="admin-button admin-button--secondary" onClick={() => navigate('/admin/masters/import/designation')} data-testid="button-import-designations"><Upload size={16} aria-hidden="true" /> Import data</button>
        <DropdownMenu.Root open={exportMenuOpen} onOpenChange={(open) => { if (!open || !exportBusy.current) setExportMenuOpen(open); }}>
          <DropdownMenu.Trigger asChild>
            {/* Remain focusable while pending so closing the menu can return focus. */}
            <button type="button" className="admin-button admin-button--secondary" disabled={Boolean(error) || loading} aria-disabled={exporting || undefined} data-testid="button-export-designations"><Download size={16} aria-hidden="true" />{exporting ? 'Exporting…' : 'Export data'}</button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content className="admin-profile__menu admin-zone-export__menu" data-admin-theme={theme} data-admin-appearance={appearance} align="end" sideOffset={6} collisionPadding={12} style={{ maxWidth: 'calc(100vw - 24px)' }} aria-label="Designation export format">
              <DropdownMenu.Item className="admin-profile__settings" disabled={exporting} onSelect={() => void exportVisible('csv')}>CSV</DropdownMenu.Item>
              <DropdownMenu.Item className="admin-profile__settings" disabled={exporting} onSelect={() => void exportVisible('xlsx')}>Excel (.xlsx)</DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
        <button type="button" className="admin-button" disabled={Boolean(error)} onClick={() => { clearFeedback(); navigate('/admin/masters/designations/new'); }} data-testid="button-add-designation"><Plus size={16} aria-hidden="true" /> Add designation</button>
      </div>
    </div>
    {feedback && <div className="admin-feedback" role="status" data-testid="status-designation-feedback">{feedback}</div>}
    {actionError && !confirming && <div className="admin-feedback admin-feedback--error" role="alert" data-testid="status-designation-action-error">{actionError}</div>}
    <section className="admin-panel" aria-label="Designation list">
      <div className="admin-toolbar"><button className="admin-button admin-button--secondary" disabled={loading} onClick={retry}>Refresh records</button><div className="admin-toolbar__fields">
        <label className="admin-search"><Search size={16} aria-hidden="true" /><span className="sr-only">Search designations by name, short name or level</span><input maxLength={200} value={search} onChange={(event) => { setSearch(event.target.value); pagination.resetPage(); }} placeholder="Search designation, short name or level" data-testid="input-search-designations" /></label>
        <div className="admin-filter"><label htmlFor="designation-filter">Status</label><select id="designation-filter" className="admin-select" value={filter} onChange={(event) => { setFilter(event.target.value); pagination.resetPage(); }} data-testid="select-filter-designations"><option value="all">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option></select></div>
      </div></div>
      {loading ? <p className="admin-empty" role="status">Loading shared designations…</p> : error ? <div className="admin-empty" role="alert"><span className="admin-empty__icon"><BriefcaseBusiness size={21} /></span><strong>Designations could not be loaded</strong><p>{error}</p><button className="admin-button" style={{ marginTop: 16 }} type="button" onClick={retry} data-testid="button-retry-designations">Try again</button></div> : <>
        {records.length ? (cardView ? <div className="admin-zone-cards" role="list" aria-label="Designation records">
          {pagination.pageRows.map((record, index) => <article className="admin-zone-card" role="listitem" key={record.id} data-testid={`card-designation-${record.id}`}>
            <div className="admin-zone-card__heading"><div className="admin-zone-card__title"><span className="admin-zone-card__serial">#{pagination.startIndex + index + 1}</span><h2 data-testid={`text-designation-name-${record.id}`}>{record.name}</h2></div><StatusBadge status={record.status} id={record.id} /></div>
            <p>{record.shortName} · Level {record.level}</p><dl className="admin-zone-card__meta"><div><dt>Created details</dt><dd>{details(record.createdBy, record.createdAt)}</dd></div><div><dt>Updated details</dt><dd>{details(record.updatedBy, record.updatedAt)}</dd></div></dl>
            {actions(record, true)}
          </article>)}
        </div> : <DataTable columns={columns} rows={pagination.pageRows} rowOffset={pagination.startIndex} rowKey={(record) => record.id} />) : <div className="admin-empty" data-testid="status-designations-empty"><span className="admin-empty__icon"><BriefcaseBusiness size={21} aria-hidden="true" /></span><strong>{total ? 'No matching designations' : 'No designations yet'}</strong><p>{total ? 'Try a different name or status filter.' : 'Add your first designation to get started.'}</p></div>}
        <TablePagination {...pagination} filtered={filtered} total={total} label={total === 1 ? 'designation' : 'designations'} onPageChange={pagination.setPage} onPageSizeChange={pagination.setPageSize} testId="text-designation-count" />
      </>}
    </section>
    {confirming && <ConfirmationDialog pending={pending} blocked={blocked} title={`${actionName} designation?`} description={`Are you sure you want to ${actionName.toLowerCase()} “${confirming.record.name}”?${confirming.type === 'delete' ? ' It will disappear from ordinary lists and exports. Server deletion history is retained; no restore is available here.' : ''}`} actionLabel={`${actionName} designation`} destructive={confirming.type === 'delete'} onConfirm={confirmAction} onClose={() => { setConfirming(null); retry(); }} error={actionError} />}
  </AdminLayout>;
}