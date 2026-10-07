import { useCallback, useEffect, useRef, useState } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { useLocation } from 'wouter';
import { CirclePower, Download, KeyRound, Pencil, Plus, Search, Trash2, Upload, UsersRound } from 'lucide-react';
import AdminLayout from '../../components/admin/AdminLayout.jsx';
import { formatAdminDate, formatAdminTimestamp, useAdminPreferences } from '../../components/admin/adminPreferences.js';
import ConfirmationDialog from '../../components/admin/ConfirmationDialog.jsx';
import ContactRequirementButton from '../../components/admin/ContactRequirementButton.jsx';
import CredentialReveal from '../../components/admin/CredentialReveal.jsx';
import MRListFilter from '../../components/admin/MRListFilter.jsx';
import Dialog from '../../components/admin/Dialog.jsx';
import DataTable from '../../components/admin/DataTable.jsx';
import RecordDetails from '../../components/admin/RecordDetails.jsx';
import StatusBadge from '../../components/admin/StatusBadge.jsx';
import TablePagination from '../../components/admin/TablePagination.jsx';
import { contactMR, deleteMR, downloadMRFile, exportMRs, listMRs, resetMRPassword, statusMR } from '../../services/serverMRs.js';
import { getSession, reportingIdentityGuard, subscribeSession } from '../../auth/adminSession.js';
import '../../mr.css';

const cleanPhone = (phone) => String(phone || '').replace(/[^+\d]/g, '');
const STATUS_OPTIONS = [{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }];
function auditDetails(name, value) {
  return <span className="admin-mr-audit"><strong>{name}</strong><time dateTime={value}>{formatAdminTimestamp(value)}</time></span>;
}

export default function MRMaster() {
  const { theme, appearance } = useAdminPreferences();
  const [, navigate] = useLocation();
  const [saveFeedback] = useState(() => {
    const saved = new URLSearchParams(window.location.search).get('saved');
    return saved === 'added' ? 'MR added with a login account.' : saved === 'updated' ? 'MR updated successfully.' : '';
  });
  useEffect(() => { if (saveFeedback) window.history.replaceState(window.history.state, '', '/admin/masters/mrs'); }, [saveFeedback]);
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [zoneFilter, setZoneFilter] = useState('');
  const [hqFilter, setHqFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [data, setData] = useState({ items: [], total: 0, filtered: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [feedback, setFeedback] = useState('');
  const [confirming, setConfirming] = useState(null);
  const [pending, setPending] = useState(false);
  const actionBusy = useRef(false);
  const [blocked, setBlocked] = useState(false);
  const [actionError, setActionError] = useState('');
  const [credentials, setCredentials] = useState(null);
  const [doctorView, setDoctorView] = useState(null);
  const [exporting, setExporting] = useState(false);
  const exportBusy = useRef(false);
  const mounted = useRef(true);
  const exportController = useRef(null);
  const retry = useCallback(() => setRevision((n) => n + 1), []);

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; exportController.current?.abort(); }; }, []);
  useEffect(() => { const t = setTimeout(() => { setDebounced(search.trim()); setPage(1); }, 250); return () => clearTimeout(t); }, [search]);
  useEffect(() => {
    const owner = getSession().user?.id;
    return subscribeSession(() => {
      if (getSession().user?.id !== owner) { setData({ items: [], total: 0, filtered: 0 }); setCredentials(null); setConfirming(null); }
    });
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    listMRs({ query: debounced, status: statusFilter, zone_id: zoneFilter, hq_id: hqFilter, limit: pageSize, offset: (page - 1) * pageSize }, controller.signal)
      .then((result) => { if (!controller.signal.aborted) { setData(result); setError(''); } })
      .catch((cause) => { if (!controller.signal.aborted) { setData({ items: [], total: 0, filtered: 0 }); setError(cause.message || 'MR records could not be loaded.'); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [debounced, statusFilter, zoneFilter, hqFilter, page, pageSize, revision]);
  const pageCount = Math.max(1, Math.ceil(data.filtered / pageSize));
  useEffect(() => { if (!loading && !error && page > pageCount) setPage(pageCount); }, [loading, error, page, pageCount]);
  const pagination = { page, pageSize, pageCount, pageRows: data.items, startIndex: (page - 1) * pageSize, setPage, setPageSize: (size) => { setPageSize(size); setPage(1); }, resetPage: () => setPage(1) };

  function request(record, type) { setFeedback(''); setActionError(''); setBlocked(false); setConfirming({ record, type }); }
  async function confirmAction() {
    if (actionBusy.current) return;
    actionBusy.current = true;
    const { record, type } = confirming;
    setPending(true);
    const owner = getSession().user?.id;
    try {
      let result = null;
      if (type === 'delete') await deleteMR(record);
      else if (type === 'reset') result = await resetMRPassword(record);
      else if (type === 'contact') await contactMR(record, record.contactRequirement === 'required' ? 'optional' : 'required');
      else await statusMR(record, record.status === 'active' ? 'inactive' : 'active');
      if (!mounted.current || getSession().user?.id !== owner) return;
      if (result?.credentials) setCredentials([result.credentials]);
      setConfirming(null);
      setFeedback({ delete: 'MR deleted. Login access is disabled and history is retained.', reset: 'Password reset. Existing sessions were revoked.', contact: 'Contact rule updated.' }[type] || 'MR status updated.');
      retry();
    } catch (cause) {
      if (!mounted.current) return;
      const stale = /stale|version|conflict/i.test(`${cause.code || ''}`) || cause.status === 409;
      setActionError(cause.message + (cause.ambiguous && type === 'reset' ? ' A lost reset password cannot be recovered; reset again after refreshing.' : ''));
      setBlocked(stale || Boolean(cause.ambiguous));
    } finally { actionBusy.current = false; if (mounted.current) setPending(false); }
  }
  async function exportFile(format) {
    if (error || loading || exportBusy.current) return;
    exportBusy.current = true; setExporting(true); setActionError('');
    const guard = reportingIdentityGuard();
    const controller = new AbortController();
    exportController.current = controller;
    try {
      const blob = await exportMRs({ query: debounced, status: statusFilter, zone_id: zoneFilter, hq_id: hqFilter }, format, controller.signal);
      guard();
      if (mounted.current) downloadMRFile(blob, format);
    } catch (cause) {
      try { guard(); } catch { return; }
      if (mounted.current) setActionError(`Export failed (${format === 'xlsx' ? 'Excel' : 'CSV'}). ${cause.message || 'Try again.'}`);
    } finally { exportBusy.current = false; if (mounted.current) setExporting(false); }
  }

  function actions(record, compact = false) {
    const cls = compact ? 'admin-mr-card__action' : 'admin-icon-button';
    return <fieldset disabled={pending} style={{ border: 0, margin: 0, padding: 0 }} className={compact ? 'admin-mr-card__actions' : 'admin-table__actions'}>
      <ContactRequirementButton record={record} kind="mr" compact={compact} onClick={() => request(record, 'contact')} />
      <button type="button" className={cls} aria-label={`View doctors for ${record.name}`} title="View doctors" onClick={() => setDoctorView(record)} data-testid={`button-doctors-mr-${record.id}`}><UsersRound size={16} aria-hidden="true" />{compact && 'Doctors'}</button>
      <button type="button" className={cls} aria-label={`Edit ${record.name}`} title="Edit" onClick={() => { setFeedback(''); navigate(`/admin/masters/mrs/${encodeURIComponent(record.id)}`); }} data-testid={`button-edit-mr-${record.id}`}><Pencil size={16} aria-hidden="true" />{compact && 'Edit'}</button>
      <button type="button" className={cls} aria-label={`${record.status === 'active' ? 'Inactivate' : 'Activate'} ${record.name}`} title={record.status === 'active' ? 'Inactivate' : 'Activate'} onClick={() => request(record, 'status')} data-testid={`button-toggle-mr-${record.id}`}><CirclePower size={16} aria-hidden="true" />{compact && (record.status === 'active' ? 'Inactivate' : 'Activate')}</button>
      <button type="button" className={cls} aria-label={`Reset password for ${record.name}`} title="Reset password" onClick={() => request(record, 'reset')} data-testid={`button-reset-mr-${record.id}`}><KeyRound size={16} aria-hidden="true" />{compact && 'Reset password'}</button>
      <button type="button" className={cls} aria-label={`Delete ${record.name}`} title="Delete" onClick={() => request(record, 'delete')} data-testid={`button-delete-mr-${record.id}`}><Trash2 size={16} aria-hidden="true" />{compact && 'Delete'}</button>
    </fieldset>;
  }
  function details(record, showName = true) {
    return <RecordDetails name={record.name} showName={showName} testId={`text-mr-details-${record.id}`} rows={[
      { label: 'User ID', icon: 'id', value: record.userId },
      { label: 'Employee code', icon: 'id', value: record.employeeCode },
      { label: 'Phone', icon: 'phone', value: record.phone, href: record.phone ? `tel:${cleanPhone(record.phone)}` : undefined, testId: `link-phone-mr-${record.id}` },
      { label: 'Email', icon: 'email', value: record.email, href: record.email ? `mailto:${record.email}` : undefined, testId: `link-email-mr-${record.id}` },
      { label: 'Date of joining', icon: 'date', value: formatAdminDate(record.dateOfJoining) },
    ]} />;
  }
  const address = (r) => <span className="admin-mr-address">{[r.addressLine1, r.addressLine2, r.landmark, `${r.city}, ${r.state} ${r.pincode}`, r.country].filter(Boolean).join(' · ')}</span>;
  const warn = (r) => (r.assignmentWarnings?.length ? <small className="admin-record-missing">{r.assignmentWarnings.map((w) => String(w?.message || w)).join(' ')}</small> : null);
  const columns = [
    { key: 'serial', label: 'Sr No.', render: (_, index) => (page - 1) * pageSize + index + 1 },
    { key: 'details', label: 'Employee details', render: (r) => details(r) },
    { key: 'address', label: 'Address', render: address },
    { key: 'designation', label: 'Designation', render: (r) => r.designation },
    { key: 'manager', label: 'Reporting manager', render: (r) => r.reportingManagerName || '—' },
    { key: 'zone', label: 'HQ / zone', render: (r) => <span>{r.hqName} / {r.zoneName}{warn(r)}</span> },
    { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} id={r.id} kind="mr" /> },
    { key: 'created', label: 'Created details', render: (r) => auditDetails(r.createdBy, r.createdAt) },
    { key: 'updated', label: 'Updated details', render: (r) => auditDetails(r.updatedBy, r.updatedAt) },
    { key: 'actions', label: 'Actions', render: (r) => actions(r) },
  ];
  const type = confirming?.type;
  const rec = confirming?.record;
  const copy = !rec ? {} : type === 'delete'
    ? { title: 'Delete MR?', description: `Delete “${rec.name}”? Their login is disabled and sessions end immediately. The record leaves lists; history is retained. Blocked while another MR reports to them.`, label: 'Delete MR' }
    : type === 'reset' ? { title: 'Reset password?', description: `Generate a new one-time password for “${rec.name}”? Their current password stops working and all sessions are revoked. The new password is shown once.`, label: 'Reset password' }
    : type === 'contact' ? { title: `Make phone and email ${rec.contactRequirement === 'required' ? 'optional' : 'required'}?`, description: `Change the contact rule for “${rec.name}”? ${rec.contactRequirement === 'optional' ? 'Both fields must be filled before they can be required.' : 'Supplied phone and email must still have valid formats.'}`, label: `Make both ${rec.contactRequirement === 'required' ? 'optional' : 'required'}` }
    : { title: `${rec.status === 'active' ? 'Inactivate' : 'Activate'} MR?`, description: `Change “${rec.name}” to ${rec.status === 'active' ? 'inactive' : 'active'}? ${rec.status === 'active' ? 'Their login is disabled and sessions end.' : 'Their login is enabled; previously revoked sessions stay revoked.'}`, label: `${rec.status === 'active' ? 'Inactivate' : 'Activate'} MR` };
  return <AdminLayout title="MR Master">
    <div className="admin-page-head">
      <div><p className="admin-page-head__eyebrow">Masters / Team</p><h1>MR Master</h1><p className="admin-page-head__description">Shared server records. Each MR has a login account using the User ID.</p></div>
      <div className="admin-mr-head-actions">
        <button type="button" className="admin-button admin-button--secondary" disabled={loading} onClick={() => { retry(); setActionError(''); }} data-testid="button-refresh-mrs">Refresh records</button>
        <button type="button" className="admin-button admin-button--secondary" onClick={() => navigate('/admin/masters/import/mr')} data-testid="button-import-mrs"><Upload size={16} aria-hidden="true" /> Import data</button>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild><button type="button" className="admin-button admin-button--secondary" disabled={Boolean(error) || loading} aria-disabled={exporting || undefined} data-testid="button-export-mrs"><Download size={16} aria-hidden="true" />{exporting ? 'Exporting…' : 'Export data'}</button></DropdownMenu.Trigger>
          <DropdownMenu.Portal><DropdownMenu.Content className="admin-dropdown__menu admin-zone-export__menu admin-mr-export__menu" data-admin-theme={theme} data-admin-appearance={appearance} align="end" sideOffset={6} collisionPadding={12} aria-label="MR export format">
            <DropdownMenu.Item className="admin-dropdown__item" disabled={exporting} onSelect={() => void exportFile('csv')}>CSV</DropdownMenu.Item>
            <DropdownMenu.Item className="admin-dropdown__item" disabled={exporting} onSelect={() => void exportFile('xlsx')}>Excel (.xlsx)</DropdownMenu.Item>
          </DropdownMenu.Content></DropdownMenu.Portal>
        </DropdownMenu.Root>
        <button type="button" className="admin-button" disabled={Boolean(error)} onClick={() => { setFeedback(''); navigate('/admin/masters/mrs/new'); }} data-testid="button-add-mr"><Plus size={16} aria-hidden="true" /> Add MR</button>
      </div>
    </div>
    {(feedback || saveFeedback) && <div className="admin-feedback" role="status" data-testid="status-mr-feedback">{feedback || saveFeedback}</div>}
    {actionError && !confirming && <div className="admin-feedback admin-feedback--error" role="alert">{actionError}</div>}
    <section className="admin-panel" aria-label="MR list">
      <div className="admin-toolbar admin-mr-toolbar"><div className="admin-toolbar__fields">
        <div className="admin-filter admin-mr-toolbar__search"><label htmlFor="mr-details-search">MR details</label><div className="admin-search"><Search size={16} aria-hidden="true" /><input id="mr-details-search" aria-label="Search MR details" maxLength={200} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search MR details" data-testid="input-search-mrs" /></div></div>
        <div className="admin-filter"><label htmlFor="mr-zone-filter">Assigned zone</label><MRListFilter id="mr-zone-filter" kind="zones" label="Assigned zone" value={zoneFilter} onChange={(v) => { setZoneFilter(v); setPage(1); }} allLabel="All zones" emptyGuidance="No zones exist yet." /></div>
        <div className="admin-filter"><label htmlFor="mr-hq-filter">Headquarter</label><MRListFilter id="mr-hq-filter" kind="headquarters" label="Headquarter" value={hqFilter} onChange={(v) => { setHqFilter(v); setPage(1); }} allLabel="All headquarters" emptyGuidance="No headquarters exist yet." /></div>
        <div className="admin-filter"><label htmlFor="mr-status-filter">Status</label><MRListFilter id="mr-status-filter" label="Status" value={statusFilter} onChange={(v) => { setStatusFilter(v); setPage(1); }} allLabel="All statuses" allValue="all" options={STATUS_OPTIONS} /></div>
      </div></div>
      {loading ? <p className="admin-empty" role="status">Loading MRs…</p> : error ? <div className="admin-empty" role="alert"><span className="admin-empty__icon"><UsersRound size={21} /></span><strong>MR records could not be loaded</strong><p>{error}</p><button className="admin-button" type="button" onClick={retry} style={{ marginTop: 16 }} data-testid="button-retry-mrs">Try again</button></div> : <>
        {data.items.length ? <>
          <div className="admin-mr-desktop"><DataTable columns={columns} rows={pagination.pageRows} rowOffset={pagination.startIndex} rowKey={(r) => r.id} label="MR records" testIdPrefix="mr" /></div>
          <div className="admin-mr-mobile" role="list" aria-label="MR records">{data.items.map((r) => <article className="admin-record-card" role="listitem" key={r.id} data-testid={`card-mr-${r.id}`}>
            <div className="admin-record-card__head"><div className="admin-record-card__identity"><h2>{r.name}</h2><small>{r.designation}</small></div><StatusBadge status={r.status} id={r.id} kind="mr" /></div>
            <div className="admin-record-card__body">{details(r, false)}<dl><div><dt>Address</dt><dd>{address(r)}</dd></div><div><dt>Reporting manager</dt><dd>{r.reportingManagerName || '—'}</dd></div><div><dt>HQ / zone</dt><dd>{r.hqName} / {r.zoneName}{warn(r)}</dd></div><div><dt>Created by</dt><dd>{auditDetails(r.createdBy, r.createdAt)}</dd></div><div><dt>Updated by</dt><dd>{auditDetails(r.updatedBy, r.updatedAt)}</dd></div></dl></div>
            {actions(r, true)}</article>)}</div>
        </> : <div className="admin-empty" data-testid="status-mrs-empty"><span className="admin-empty__icon"><UsersRound size={21} aria-hidden="true" /></span><strong>{data.total ? 'No matching MRs' : 'No MR records yet'}</strong><p>{data.total ? 'Try different search or filters.' : 'Add an MR, or import a file. Headquarters and zones must exist first.'}</p></div>}
        <TablePagination {...pagination} filtered={data.filtered} total={data.total} label={data.total === 1 ? 'MR' : 'MRs'} onPageChange={setPage} onPageSizeChange={pagination.setPageSize} testId="text-mr-count" />
      </>}
    </section>
    {confirming && <ConfirmationDialog pending={pending} blocked={blocked} title={copy.title} description={copy.description} actionLabel={copy.label} destructive={type === 'delete'} onConfirm={confirmAction} onClose={() => { setConfirming(null); setActionError(''); if (blocked) retry(); }} error={actionError} />}
    {credentials && <CredentialReveal credentials={credentials} title="Password reset. Copy the new credentials" onClose={() => setCredentials(null)} />}
    {doctorView && <Dialog title={`Doctors for ${doctorView.name}`} eyebrow="MR Master" onClose={() => setDoctorView(null)}>
      <p data-testid="text-mr-doctors-unavailable">Assigned doctors are unavailable for server MRs. Doctor records still live in this browser's local preview and are not linked to verified server MR accounts.</p>
    </Dialog>}
  </AdminLayout>;
}
