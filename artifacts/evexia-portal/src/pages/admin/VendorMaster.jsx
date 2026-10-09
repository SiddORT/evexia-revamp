import { useEffect, useRef, useState } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { useLocation } from 'wouter';
import { CirclePower, Download, Pencil, Plus, Search, Trash2, UsersRound, Upload } from 'lucide-react';
import AdminLayout from '../../components/admin/AdminLayout.jsx';
import { formatAdminTimestamp, useAdminPreferences } from '../../components/admin/adminPreferences.js';
import ConfirmationDialog from '../../components/admin/ConfirmationDialog.jsx';
import DataTable from '../../components/admin/DataTable.jsx';
import StatusBadge from '../../components/admin/StatusBadge.jsx';
import TablePagination from '../../components/admin/TablePagination.jsx';
import VendorForm from '../../components/admin/VendorForm.jsx';
import useVendors from '../../hooks/useVendors.js';
import { exportVendors, downloadVendorFile } from '../../services/serverVendors.js';
import { VENDOR_COLUMNS, vendorPhone, vendorTel } from '../../services/vendorFields.js';
import { reportingIdentityGuard } from '../../auth/adminSession.js';
import { useAdminSession } from '../../auth/AdminBoundary.jsx';
import '../../vendor.css';

const audit = (by, at) => <span className="admin-vendor-audit"><strong>{by || '—'}</strong><time dateTime={at}>{formatAdminTimestamp(at)}</time></span>;

export default function VendorMaster() {
  const session = useAdminSession();
  return <VendorWorkspace key={session.user?.id || 'signed-out'} />;
}

function VendorWorkspace() {
  const { theme, appearance } = useAdminPreferences();
  const [, navigate] = useLocation();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const { records, total, filtered, loading, pending, error, feedback, clearFeedback, retry, add, edit, remove, changeStatus } = useVendors(search, filter, page, pageSize);
  const [exporting, setExporting] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const exportBusy = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [blocked, setBlocked] = useState(false);
  const [editing, setEditing] = useState(null);
  const [confirming, setConfirming] = useState(null);
  const [actionError, setActionError] = useState('');
  const pageCount = Math.max(1, Math.ceil(filtered / pageSize));
  const pagination = { page, pageSize, pageCount, pageRows: records, startIndex: (page - 1) * pageSize, setPage, setPageSize: (size) => { setPageSize(size); setPage(1); }, resetPage: () => setPage(1) };
  useEffect(() => { if (!loading && !error && page > pageCount) setPage(pageCount); }, [loading, error, page, pageCount]);

  async function save(values, record) {
    const result = await (editing === 'new' ? add(values) : edit(record, values));
    if (result.success) setEditing(null);
    return result;
  }
  function requestAction(record, type) { clearFeedback(); setActionError(''); setBlocked(false); setConfirming({ record, type }); }
  async function confirmAction() {
    const { record, type } = confirming;
    const result = await (type === 'delete' ? remove(record) : changeStatus(record, type === 'activate' ? 'active' : 'inactive'));
    if (result.success) { setConfirming(null); setActionError(''); }
    else { setActionError(result.error); setBlocked(/_stale$/.test(result.code || '') || Boolean(result.ambiguous)); }
  }
  async function exportVisible(format) {
    if (error || loading || exportBusy.current) return;
    exportBusy.current = true;
    setActionError('');
    setExporting(true);
    const guard = reportingIdentityGuard();
    try {
      const blob = await exportVendors({ query: search, status: filter }, format);
      guard();
      if (mounted.current) downloadVendorFile(blob, format);
    } catch (cause) {
      if (mounted.current) setActionError(`Export failed (${format === 'xlsx' ? 'Excel' : 'CSV'}). ${cause.message || 'Refresh records and try again.'}`);
    } finally { exportBusy.current = false; if (mounted.current) setExporting(false); }
  }
  function actions(record, mobile = false) {
    const toggle = record.status === 'active' ? 'Inactivate' : 'Activate';
    const cls = mobile ? 'admin-vendor-card__action' : 'admin-icon-button';
    return <fieldset disabled={loading || pending} style={{ border: 0, margin: 0, padding: 0 }} className={mobile ? 'admin-zone-card__actions' : 'admin-table__actions'}>
      <button type="button" className={cls} aria-label={`Edit ${record.vendorName}`} title="Edit" onClick={() => { clearFeedback(); setEditing(record); }} data-testid={`button-edit-vendor-${mobile ? 'mobile-' : ''}${record.id}`}><Pencil size={16} aria-hidden="true" />{mobile && <span>Edit</span>}</button>
      <button type="button" className={cls} aria-label={`${toggle} ${record.vendorName}`} title={toggle} onClick={() => requestAction(record, toggle.toLowerCase())} data-testid={`button-toggle-vendor-${mobile ? 'mobile-' : ''}${record.id}`}><CirclePower size={16} aria-hidden="true" />{mobile && <span>{toggle}</span>}</button>
      <button type="button" className={mobile ? `${cls} admin-zone-card__action--danger` : `${cls} admin-icon-button--danger`} aria-label={`Delete ${record.vendorName}`} title="Delete" onClick={() => requestAction(record, 'delete')} data-testid={`button-delete-vendor-${mobile ? 'mobile-' : ''}${record.id}`}><Trash2 size={16} aria-hidden="true" />{mobile && <span>Delete</span>}</button>
    </fieldset>;
  }
  const email = (r, t = '') => <a className="admin-vendor-link" href={`mailto:${r.emailId}`} data-testid={`link-vendor-${t}email-${r.id}`}>{r.emailId}</a>;
  const phone = (r, t = '') => <a className="admin-vendor-link" href={`tel:${vendorTel(r)}`} data-testid={`link-vendor-${t}phone-${r.id}`}>{vendorPhone(r)}</a>;
  const columns = [
    { key: 'serial', label: 'Sr No.', render: (_, index) => <span className="admin-table__serial">{index + 1}</span> },
    { key: 'vendorName', label: 'Vendor Name', render: (r) => <strong className="admin-vendor-name" data-testid={`text-vendor-name-${r.id}`}>{r.vendorName}</strong> },
    { key: 'gstNo', label: 'GST No.', render: (r) => r.gstNo },
    { key: 'registeredAddress', label: 'Registered Address', render: (r) => <span className="admin-vendor-address">{r.registeredAddress}</span> },
    { key: 'contactPersonName', label: 'Contact Person Name', render: (r) => r.contactPersonName },
    { key: 'emailId', label: 'Email ID', render: (r) => email(r) },
    { key: 'phoneNo', label: 'Phone No.', render: (r) => phone(r) },
    { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} id={r.id} /> },
    { key: 'created', label: 'Created details', render: (r) => audit(r.createdBy, r.createdAt) },
    { key: 'updated', label: 'Updated details', render: (r) => audit(r.updatedBy, r.updatedAt) },
    { key: 'actions', label: 'Actions', render: (r) => actions(r) },
  ];
  const actionName = confirming?.type === 'delete' ? 'Delete' : confirming?.type === 'activate' ? 'Activate' : 'Inactivate';
  return <AdminLayout title="Vendor Master">
    <div className="admin-page-head">
      <div><p className="admin-page-head__eyebrow">Masters / Contacts</p><h1>Vendor Master</h1></div>
      <div className="admin-vendor-actions">
        <button type="button" className="admin-button admin-button--secondary" onClick={() => navigate('/admin/masters/import/vendor')} data-testid="button-import-vendors"><Upload size={16} aria-hidden="true" /> Import data</button>
        <DropdownMenu.Root open={exportMenuOpen} onOpenChange={(open) => { if (!open || !exportBusy.current) setExportMenuOpen(open); }}>
          <DropdownMenu.Trigger asChild>
            <button type="button" className="admin-button admin-button--secondary" disabled={Boolean(error) || loading} aria-disabled={exporting || undefined} data-testid="button-export-vendors"><Download size={16} aria-hidden="true" />{exporting ? 'Exporting…' : 'Export data'}</button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content className="admin-dropdown__menu admin-courier-export__menu" data-admin-theme={theme} data-admin-appearance={appearance} align="end" sideOffset={6} collisionPadding={12} style={{ maxWidth: 'calc(100vw - 24px)' }} aria-label="Vendor export format">
              <DropdownMenu.Item className="admin-dropdown__item" disabled={exporting} onSelect={() => void exportVisible('csv')}>CSV</DropdownMenu.Item>
              <DropdownMenu.Item className="admin-dropdown__item" disabled={exporting} onSelect={() => void exportVisible('xlsx')}>Excel (.xlsx)</DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
        <button type="button" className="admin-button" disabled={Boolean(error)} onClick={() => { clearFeedback(); setEditing('new'); }} data-testid="button-add-vendor"><Plus size={16} aria-hidden="true" /> Add vendor</button>
      </div>
    </div>
    {feedback && <div className="admin-feedback" role="status" data-testid="status-vendor-feedback">{feedback}</div>}
    {actionError && !confirming && <div className="admin-feedback admin-feedback--error" role="alert" data-testid="status-vendor-action-error">{actionError}</div>}
    <section className="admin-panel" aria-label="Vendor list">
      <div className="admin-toolbar"><button type="button" className="admin-button admin-button--secondary" disabled={loading} onClick={retry} data-testid="button-refresh-vendors">Refresh records</button><div className="admin-toolbar__fields">
        <label className="admin-search"><Search size={16} aria-hidden="true" /><span className="sr-only">Search vendors</span><input maxLength={200} value={search} onChange={(event) => { setSearch(event.target.value); pagination.resetPage(); }} placeholder="Search vendor, GST, contact, email or phone" data-testid="input-search-vendors" /></label>
        <div className="admin-filter"><label htmlFor="vendor-filter">Status</label><select id="vendor-filter" className="admin-select" value={filter} onChange={(event) => { setFilter(event.target.value); pagination.resetPage(); }} data-testid="select-filter-vendors"><option value="all">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option></select></div>
        {(search || filter !== 'all') && <button type="button" className="admin-button admin-button--secondary" onClick={() => { setSearch(''); setFilter('all'); setPage(1); }} data-testid="button-clear-vendor-filters">Clear filters</button>}
      </div></div>
      {loading ? <p className="admin-empty" role="status">Loading shared vendors…</p> : error ? <div className="admin-empty" role="alert"><span className="admin-empty__icon"><UsersRound size={21} aria-hidden="true" /></span><strong>Vendors could not be loaded</strong><p>{error}</p><button type="button" className="admin-button" style={{ marginTop: 16 }} onClick={retry} data-testid="button-retry-vendors">Try again</button></div> : <>
        {records.length ? <>
          <div className="admin-vendor-desktop"><DataTable columns={columns} rows={records} rowOffset={pagination.startIndex} rowKey={(r) => r.id} label="Vendor records" testIdPrefix="vendor" /></div>
          <div className="admin-vendor-mobile" role="list" aria-label="Vendor records">{records.map((record, index) => <article className="admin-vendor-card" role="listitem" key={record.id} data-testid={`card-vendor-${record.id}`}>
            <div className="admin-vendor-card__head"><div><small>#{pagination.startIndex + index + 1} · {record.gstNo}</small><h2>{record.vendorName}</h2></div><StatusBadge status={record.status} id={`mobile-${record.id}`} /></div>
            <dl className="admin-vendor-card__meta">{VENDOR_COLUMNS.slice(2).map(([key, label]) => <div key={key}><dt>{label}</dt><dd className={key === 'registeredAddress' ? 'admin-vendor-address' : undefined}>{key === 'emailId' ? email(record, 'mobile-') : key === 'phoneNo' ? phone(record, 'mobile-') : record[key]}</dd></div>)}<div><dt>Created details</dt><dd>{audit(record.createdBy, record.createdAt)}</dd></div><div><dt>Updated details</dt><dd>{audit(record.updatedBy, record.updatedAt)}</dd></div></dl>
            {actions(record, true)}
          </article>)}</div>
        </> : <div className="admin-empty" data-testid="status-vendors-empty"><span className="admin-empty__icon"><UsersRound size={21} aria-hidden="true" /></span><strong>{total ? 'No matching vendors' : 'No vendors yet'}</strong><p>{total ? 'Try a different search term or status filter.' : 'Add a vendor or import a CSV or Excel file to start the shared vendor list.'}</p></div>}
        <TablePagination {...pagination} filtered={filtered} total={total} label={total === 1 ? 'vendor' : 'vendors'} onPageChange={pagination.setPage} onPageSizeChange={pagination.setPageSize} testId="text-vendor-count" />
      </>}
    </section>
    {editing && <VendorForm vendor={editing === 'new' ? null : editing} onSave={save} onClose={() => setEditing(null)} />}
    {confirming && <ConfirmationDialog pending={pending} blocked={blocked} title={`${actionName} vendor?`} description={`Are you sure you want to ${actionName.toLowerCase()} “${confirming.record.vendorName}”?${confirming.type === 'delete' ? ' It will disappear from ordinary lists and exports. Server deletion history is retained; no restore is available here.' : ''}`} actionLabel={`${actionName} vendor`} destructive={confirming.type === 'delete'} onConfirm={confirmAction} onClose={() => { setConfirming(null); retry(); }} error={actionError} />}
  </AdminLayout>;
}
