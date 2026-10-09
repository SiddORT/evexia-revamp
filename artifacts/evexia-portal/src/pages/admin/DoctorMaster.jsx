import { useEffect, useMemo, useRef, useState } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { useLocation } from 'wouter';
import { ChevronDown, CirclePower, Download, Filter, Pencil, Plus, ReceiptText, Search, ShieldCheck, ShieldX, Trash2, Upload, UsersRound } from 'lucide-react';
import AdminLayout from '../../components/admin/AdminLayout.jsx';
import { formatAdminDate, formatAdminTimestamp, useAdminPreferences } from '../../components/admin/adminPreferences.js';
import ConfirmationDialog from '../../components/admin/ConfirmationDialog.jsx';
import ContactRequirementButton from '../../components/admin/ContactRequirementButton.jsx';
import DataTable from '../../components/admin/DataTable.jsx';
import RecordDetails from '../../components/admin/RecordDetails.jsx';
import Dialog from '../../components/admin/Dialog.jsx';
import StatusBadge from '../../components/admin/StatusBadge.jsx';
import TablePagination from '../../components/admin/TablePagination.jsx';
import useDoctors from '../../hooks/useDoctors.js';
import { downloadDoctorFile, exportDoctors } from '../../services/serverDoctors.js';
import { reportingIdentityGuard } from '../../auth/adminSession.js';
import { useMasterActions } from '../../auth/useMasterActions.js';
import '../../doctor-list.css';

const cleanPhone = (value) => String(value || '').replace(/[^\d+]/g, '');
const dialCodes = { IN: '+91', US: '+1', GB: '+44', AE: '+971' };
const text = (value) => String(value ?? '').trim() || '—';
function auditDetails(actor, at) {
  return <span className="doctor-master__audit"><strong>{text(actor)}</strong><time dateTime={at}>{formatAdminTimestamp(at)}</time></span>;
}

export default function DoctorMaster() {
  const can = useMasterActions('doctor');
  const { theme, appearance } = useAdminPreferences();
  const [, navigate] = useLocation();
  const [saveFeedback] = useState(() => {
    const saved = new URLSearchParams(window.location.search).get('saved');
    return saved === 'added' ? 'Doctor added successfully.' : saved === 'updated' ? 'Doctor updated successfully.' : '';
  });
  useEffect(() => {
    if (saveFeedback) window.history.replaceState(window.history.state, '', '/admin/masters/doctors');
  }, [saveFeedback]);
  const [search, setSearch] = useState('');
  const [zoneFilter, setZoneFilter] = useState('all');
  const [mrFilter, setMrFilter] = useState('all');
  const [stateFilter, setStateFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [debounced, setDebounced] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [exporting, setExporting] = useState(false);
  const exportBusy = useRef(false);
  const exportController = useRef(null);
  useEffect(() => () => exportController.current?.abort(), []);
  const filters = { query: debounced, zone_id: zoneFilter, mr_id: mrFilter, state: stateFilter, status: statusFilter };
  const normalizedFilters = Object.fromEntries(Object.entries(filters).map(([key, value]) => [key, value === 'all' ? '' : value]));
  const { records, mrs, zones, states, missingMR, missingZone, total, filtered, loading, pending, error, feedback, retry, clearFeedback, changeStatus, changeVerification, shiftMR, changeContactRequirement, remove } = useDoctors({ ...normalizedFilters, limit: pageSize, offset: (page - 1) * pageSize });
  const [selected, setSelected] = useState([]);
  const [confirming, setConfirming] = useState(null);
  const [targetMR, setTargetMR] = useState('');
  const [actionError, setActionError] = useState('');
  const refreshButton = useRef(null);
  const [focusAfterDelete, setFocusAfterDelete] = useState(false);
  useEffect(() => {
    if (!focusAfterDelete || confirming || loading || pending) return;
    const frame = requestAnimationFrame(() => {
      if (refreshButton.current && !refreshButton.current.disabled) {
        refreshButton.current.focus();
        setFocusAfterDelete(false);
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [focusAfterDelete, confirming, loading, pending]);
  useEffect(() => { const timer = setTimeout(() => { setDebounced(search.trim()); setPage(1); }, 250); return () => clearTimeout(timer); }, [search]);
  useEffect(() => { setSelected([]); }, [page, pageSize, records]);
  const pageCount = Math.max(1, Math.ceil(filtered / pageSize));
  useEffect(() => { if (!loading && !error && page > pageCount) setPage(pageCount); }, [loading, error, page, pageCount]);

  const mrById = useMemo(() => new Map(mrs.map((mr) => [mr.id, mr])), [mrs]);
  const hasFilters = Boolean(search.trim() || zoneFilter !== 'all' || mrFilter !== 'all' || stateFilter !== 'all' || statusFilter !== 'all');
  const visible = records;
  const visibleIds = useMemo(() => new Set(visible.map((record) => record.id)), [visible]);
  const selectedVisible = selected.filter((id) => visibleIds.has(id));
  const allVisibleSelected = visible.length > 0 && visible.every((record) => selected.includes(record.id));
  const activeFilters = [search.trim() && 'search', zoneFilter !== 'all' && 'zone', mrFilter !== 'all' && 'MR', stateFilter !== 'all' && 'state', statusFilter !== 'all' && 'status'].filter(Boolean);

  function resetFilters() {
    setSearch(''); setZoneFilter('all'); setMrFilter('all'); setStateFilter('all'); setStatusFilter('all'); setSelected([]); setPage(1);
  }
  function filterWith(setter, value) { setter(value); setSelected([]); setPage(1); }
  function selectOne(id, checked) { setSelected((previous) => checked ? [...new Set([...previous, id])] : previous.filter((value) => value !== id)); }
  function selectAll(checked) { setSelected((previous) => checked ? [...new Set([...previous, ...visible.map((record) => record.id)])] : previous.filter((id) => !visibleIds.has(id))); }
  function openConfirmation(next) {
    clearFeedback(); setActionError('');
    const snapshots = (next.ids || [next.id]).map((id) => {
      const record = records.find((row) => row.id === id);
      return { id, version: record.version };
    });
    setConfirming({ ...next, snapshots });
  }
  function closeConfirmation() { if (pending) return; setConfirming(null); setActionError(''); }
  async function handleConfirm() {
    if (!confirming || pending) return;
    let result;
    if (confirming.type === 'status') result = await changeStatus(confirming.snapshots[0], confirming.value);
    if (confirming.type === 'delete') result = await remove(confirming.snapshots[0]);
    if (confirming.type === 'contact') result = await changeContactRequirement(confirming.snapshots[0], confirming.value);
    if (confirming.type === 'verification') result = await changeVerification(confirming.snapshots, confirming.value);
    if (confirming.type === 'shift') {
      if (!targetMR || !mrById.has(targetMR)) { setActionError('Choose an available MR.'); return; }
      result = await shiftMR(confirming.snapshots, targetMR);
    }
    if (result?.success) {
      if (confirming.type === 'delete') setFocusAfterDelete(true);
      setConfirming(null); setActionError(''); setSelected([]);
    }
    else setActionError(result?.error || 'The change could not be saved. Refresh records and try again.');
  }
  async function exportVisible(format) {
    if (error || loading || exportBusy.current) return;
    exportBusy.current = true;
    exportController.current = new AbortController();
    const signal = exportController.current.signal;
    setExporting(true);
    setActionError('');
    const guard = reportingIdentityGuard();
    try {
      const blob = await exportDoctors(normalizedFilters, format, signal);
      guard();
      if (signal.aborted) return;
      downloadDoctorFile(blob, format);
    } catch (cause) {
      if (signal.aborted) return;
      try { guard(); } catch { return; }
      setActionError(cause?.message || 'Export failed. Refresh records and try again.');
    } finally { exportBusy.current = false; if (!signal.aborted) setExporting(false); }
  }
  function actions(record, compact = false) {
    const suffix = `${compact ? 'mobile-' : ''}${record.id}`;
    return <fieldset disabled={pending || loading || Boolean(error)} style={{ border: 0, padding: 0, margin: 0 }} className="doctor-master__actions">
      {can.protected && <button type="button" className="doctor-master__payment-action" aria-label={`Payment history for ${record.name}`} onClick={() => navigate(`/admin/masters/doctors/${encodeURIComponent(record.id)}/payments`)} data-testid={`button-payments-doctor-${suffix}`}><ReceiptText size={15} aria-hidden="true" /> Payment history</button>}
      {can.edit && <><ContactRequirementButton record={record} kind="doctor" compact={compact} onClick={() => openConfirmation({ type: 'contact', id: record.id, name: record.name, value: record.contactRequirement === 'required' ? 'optional' : 'required' })} />
      <button type="button" className="admin-icon-button" title="Edit doctor" aria-label={`Edit ${record.name}`} onClick={() => { clearFeedback(); navigate(`/admin/masters/doctors/${encodeURIComponent(record.id)}`); }} data-testid={`button-edit-doctor-${suffix}`}><Pencil size={16} aria-hidden="true" /></button>
      <button type="button" className="admin-icon-button" title={record.verification === 'verified' ? 'Unverify' : 'Verify'} aria-label={`${record.verification === 'verified' ? 'Unverify' : 'Verify'} ${record.name}`} onClick={() => openConfirmation({ type: 'verification', ids: [record.id], value: record.verification === 'verified' ? 'unverified' : 'verified' })} data-testid={`button-verification-doctor-${suffix}`}>{record.verification === 'verified' ? <ShieldX size={16} aria-hidden="true" /> : <ShieldCheck size={16} aria-hidden="true" />}</button>
      <button type="button" className="admin-icon-button" title={record.status === 'active' ? 'Inactivate' : 'Activate'} aria-label={`${record.status === 'active' ? 'Inactivate' : 'Activate'} ${record.name}`} onClick={() => openConfirmation({ type: 'status', id: record.id, name: record.name, value: record.status === 'active' ? 'inactive' : 'active' })} data-testid={`button-toggle-doctor-${suffix}`}><CirclePower size={16} aria-hidden="true" /></button>
      </>}
      {can.delete && <button type="button" className="admin-icon-button" title="Delete doctor" aria-label={`Delete ${record.name}`} onClick={() => openConfirmation({ type: 'delete', id: record.id, name: record.name })} data-testid={`button-delete-doctor-${suffix}`}><Trash2 size={16} aria-hidden="true" /></button>}
    </fieldset>;
  }
  function identity(record, mobile = false) {
    const suffix = `${mobile ? 'mobile-' : ''}${record.id}`;
    return <RecordDetails name={record.name} showName={!mobile} testId={`text-doctor-details-${suffix}`} rows={[
      { label: 'Registration number', icon: 'id', value: record.registrationNumber },
      { label: 'Phone', icon: 'phone', value: record.phone ? `${dialCodes[record.dialCountry] || ''} ${record.phone}`.trim() : '', href: record.phone ? `tel:${dialCodes[record.dialCountry] || ''}${cleanPhone(record.phone)}` : undefined, testId: `link-phone-doctor-${suffix}` },
      { label: 'Email', icon: 'email', value: record.email, href: record.email ? `mailto:${record.email}` : undefined, testId: `link-email-doctor-${suffix}` },
      { label: 'Date of joining', icon: 'date', value: formatAdminDate(record.dateOfJoining) },
    ]} />;
  }
  function professional(record) {
    return <div className="admin-record-fields"><span><span className="admin-record-fields__label">Qualification: </span>{text(record.qualification)}</span><span><span className="admin-record-fields__label">Clinic: </span>{text(record.clinicName)}</span></div>;
  }
  function assignment(record) {
    return <div className="admin-record-fields"><span className={!record.mrName ? 'admin-record-missing' : ''}><span className="admin-record-fields__label">MR: </span>{record.mrName || 'Missing MR'}</span><span className={!record.zoneName ? 'admin-record-missing' : ''}><span className="admin-record-fields__label">Zone: </span>{record.zoneName || 'Missing zone'}</span>{record.assignmentWarnings?.map((warning) => <small key={warning} className="admin-record-missing">{warning}</small>)}</div>;
  }
  function address(record) {
    return <div className="doctor-master__field doctor-master__address"><span>{[record.addressLine1, record.addressLine2, record.landmark].filter(Boolean).join(', ') || '—'}</span><span>{[record.city, record.state, record.pincode].filter(Boolean).join(', ')}</span><span>{text(record.country)}</span></div>;
  }
  const columns = [
    { key: 'select', label: <input type="checkbox" className="doctor-master__check" checked={allVisibleSelected} onChange={(event) => selectAll(event.target.checked)} aria-label="Select all visible doctors" data-testid="checkbox-select-all-doctors" />, render: (record) => <input type="checkbox" className="doctor-master__check" checked={selected.includes(record.id)} onChange={(event) => selectOne(record.id, event.target.checked)} aria-label={`Select ${record.name}`} data-testid={`checkbox-doctor-${record.id}`} /> },
    { key: 'serial', label: 'No.', render: (_, index) => (page - 1) * pageSize + index + 1 },
    { key: 'identity', label: 'Doctor / Contact', render: (record) => identity(record) },
    { key: 'professional', label: 'Professional', render: professional },
    { key: 'assignment', label: 'MR / Zone', render: assignment },
    { key: 'address', label: 'Address', render: address },
    { key: 'verification', label: 'Verification', render: (record) => <span className={`doctor-master__verification${record.verification === 'verified' ? '' : ' doctor-master__verification--pending'}`} data-testid={`status-doctor-verification-${record.id}`}>{record.verification === 'verified' ? 'Verified' : 'Unverified'}</span> },
    { key: 'status', label: 'Status', render: (record) => <StatusBadge status={record.status} id={record.id} kind="doctor" /> },
    { key: 'created', label: 'Created details', render: (record) => auditDetails(record.createdBy, record.createdAt) },
    { key: 'updated', label: 'Updated details', render: (record) => auditDetails(record.updatedBy, record.updatedAt) },
    { key: 'actions', label: 'Actions', render: (record) => actions(record) },
  ].filter((column) => column.key !== 'select' || can.edit);
  const count = confirming?.ids?.length || 1;
  return <AdminLayout title="Doctor Master">
    <div className="doctor-master">
      <div className="admin-page-head">
        <div><p className="admin-page-head__eyebrow">Masters / Care network</p><h1>Doctor Master</h1><p className="admin-page-head__description">Shared server profiles, MR assignments and verification. No doctor login or payment ledger is created.</p></div>
        <div className="doctor-master__head-actions">
          <button ref={refreshButton} type="button" className="admin-button admin-button--secondary" disabled={loading || pending} onClick={() => { retry(); setSelected([]); closeConfirmation(); }} data-testid="button-refresh-doctors">Refresh records</button>
          {can.import && <button type="button" className="admin-button admin-button--secondary" onClick={() => navigate('/admin/masters/import/doctor')} data-testid="button-import-doctors"><Upload size={16} aria-hidden="true" /> Import data</button>}
          {can.export && <DropdownMenu.Root><DropdownMenu.Trigger asChild><button type="button" className="admin-button admin-button--secondary" disabled={Boolean(error) || loading} aria-disabled={exporting || undefined} data-testid="button-export-doctors"><Download size={16} aria-hidden="true" />{exporting ? 'Exporting…' : 'Export data'}</button></DropdownMenu.Trigger>
            <DropdownMenu.Portal><DropdownMenu.Content className="admin-profile__menu admin-zone-export__menu" data-admin-theme={theme} data-admin-appearance={appearance} align="end" sideOffset={6} collisionPadding={12} aria-label="Doctor export format">
              <DropdownMenu.Item className="admin-profile__settings" disabled={exporting} onSelect={() => void exportVisible('csv')}>CSV</DropdownMenu.Item>
              <DropdownMenu.Item className="admin-profile__settings" disabled={exporting} onSelect={() => void exportVisible('xlsx')}>Excel (.xlsx)</DropdownMenu.Item>
            </DropdownMenu.Content></DropdownMenu.Portal></DropdownMenu.Root>}
          {can.add && <button type="button" className="admin-button" disabled={Boolean(error)} onClick={() => { clearFeedback(); navigate('/admin/masters/doctors/new'); }} data-testid="button-add-doctor"><Plus size={16} aria-hidden="true" /> Add doctor</button>}
        </div>
      </div>
      {(feedback || saveFeedback) && <div className="admin-feedback" role="status" data-testid="status-doctor-feedback">{feedback || saveFeedback}</div>}
      {actionError && !confirming && <div className="admin-feedback admin-feedback--error" role="alert" data-testid="status-doctor-action-error">{actionError}</div>}
      <section className="admin-panel" aria-label="Doctor list">
        <div className="doctor-master__toolbar">
          <div className="doctor-master__toolbar-top">
            <label className="admin-search doctor-master__search"><Search size={16} aria-hidden="true" /><span className="sr-only">Search doctors by name, registration, clinic or contact</span><input maxLength={200} value={search} onChange={(event) => filterWith(setSearch, event.target.value)} placeholder="Search name, registration, clinic or contact" data-testid="input-search-doctors" /></label>
            <span className="doctor-master__filter-feedback" data-testid="text-doctor-filter-feedback">{hasFilters ? `${filtered} matching · ${activeFilters.join(', ')} applied` : `${total} total doctors`}{hasFilters && <button type="button" className="doctor-master__text-button" onClick={resetFilters} data-testid="button-reset-doctor-filters">Reset filters</button>}</span>
          </div>
          <details className="doctor-master__filters">
            <summary data-testid="button-toggle-doctor-filters"><Filter size={15} aria-hidden="true" /> Filter records{activeFilters.length > 0 && ` · ${activeFilters.length} active`}<ChevronDown size={15} aria-hidden="true" /></summary>
            <div className="doctor-master__filter-grid">
              <div className="admin-filter"><label htmlFor="doctor-zone-filter">Zone</label><select id="doctor-zone-filter" className="admin-select" value={zoneFilter} onChange={(event) => filterWith(setZoneFilter, event.target.value)} data-testid="select-filter-doctor-zone"><option value="all">All zones</option>{zones.map((zone) => <option key={zone.id} value={zone.id}>{zone.name}{zone.status === 'inactive' ? ' (inactive)' : ''}</option>)}{missingZone && <option value="missing">Missing zone</option>}</select></div>
              <div className="admin-filter"><label htmlFor="doctor-mr-filter">MR</label><select id="doctor-mr-filter" className="admin-select" value={mrFilter} onChange={(event) => filterWith(setMrFilter, event.target.value)} data-testid="select-filter-doctor-mr"><option value="all">All MRs</option>{mrs.map((mr) => <option key={mr.id} value={mr.id}>{mr.name}{mr.status === 'inactive' ? ' (inactive)' : ''}</option>)}{missingMR && <option value="missing">Missing MR</option>}</select></div>
              <div className="admin-filter"><label htmlFor="doctor-state-filter">State</label><select id="doctor-state-filter" className="admin-select" value={stateFilter} onChange={(event) => filterWith(setStateFilter, event.target.value)} data-testid="select-filter-doctor-state"><option value="all">All states</option>{states.map((state) => <option key={state} value={state}>{state}</option>)}</select></div>
              <div className="admin-filter"><label htmlFor="doctor-status-filter">Status</label><select id="doctor-status-filter" className="admin-select" value={statusFilter} onChange={(event) => filterWith(setStatusFilter, event.target.value)} data-testid="select-filter-doctor-status"><option value="all">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option></select></div>
            </div>
          </details>
        </div>
        {error ? <div className="admin-empty" role="alert"><span className="admin-empty__icon"><UsersRound size={21} aria-hidden="true" /></span><strong>Doctor records could not be loaded</strong><p>{error}</p><button className="admin-button" type="button" onClick={() => { retry(); setActionError(''); }} style={{ marginTop: 16 }} data-testid="button-retry-doctors">Refresh records</button></div> : <>
          {(missingMR || missingZone) && <div className="admin-feedback admin-feedback--error" role="status" style={{ margin: '12px 16px' }}>Some doctor assignments reference {missingMR && missingZone ? 'missing MRs or zones' : missingMR ? 'missing MRs' : 'missing zones'}. Review their assignments before shifting records.</div>}
          {can.edit && selectedVisible.length > 0 && <div className="doctor-master__bulk" role="group" aria-label="Selected doctor actions"><span className="doctor-master__bulk-label" data-testid="text-selected-doctors">{selectedVisible.length} selected from visible records</span>
            <button type="button" className="admin-button admin-button--secondary" onClick={() => { setTargetMR(''); openConfirmation({ type: 'shift', ids: selectedVisible }); }} data-testid="button-shift-doctors">Shift MR</button>
            <button type="button" className="admin-button admin-button--secondary" onClick={() => openConfirmation({ type: 'verification', ids: selectedVisible, value: 'verified' })} data-testid="button-verify-doctors">Verify</button>
            <button type="button" className="admin-button admin-button--secondary" onClick={() => openConfirmation({ type: 'verification', ids: selectedVisible, value: 'unverified' })} data-testid="button-unverify-doctors">Unverify</button>
            <button type="button" className="doctor-master__text-button" onClick={() => setSelected([])} data-testid="button-clear-doctor-selection">Clear selection</button>
          </div>}
          {loading ? <p className="admin-empty" role="status">Loading doctors…</p> : visible.length ? <>
            <div className="doctor-master__table"><DataTable columns={columns} rows={visible} rowKey={(record) => record.id} label="Doctor records" testIdPrefix="doctor" /></div>
             <div className="doctor-master__card-list" role="list" aria-label="Doctor records">{visible.map((record) => <article role="listitem" className="admin-record-card" key={record.id} data-testid={`card-doctor-${record.id}`}>
               <div className="admin-record-card__head"><div className="admin-record-card__identity"><h2>{record.name}</h2><small>Doctor profile</small></div>{can.edit && <input type="checkbox" className="doctor-master__check" checked={selected.includes(record.id)} onChange={(event) => selectOne(record.id, event.target.checked)} aria-label={`Select ${record.name}`} data-testid={`checkbox-mobile-doctor-${record.id}`} />}</div>
                <div className="admin-record-card__body">{identity(record, true)}<dl><div><dt>Practice</dt><dd>{professional(record)}</dd></div><div><dt>MR / Zone</dt><dd>{assignment(record)}</dd></div><div><dt>Address</dt><dd>{address(record)}</dd></div><div><dt>Created details</dt><dd>{auditDetails(record.createdBy, record.createdAt)}</dd></div><div><dt>Updated details</dt><dd>{auditDetails(record.updatedBy, record.updatedAt)}</dd></div></dl></div>
               <div className="admin-record-card__foot doctor-master__card-foot"><StatusBadge status={record.status} id={record.id} kind="doctor-mobile" /><span className={`doctor-master__verification${record.verification === 'verified' ? '' : ' doctor-master__verification--pending'}`}>{record.verification === 'verified' ? 'Verified' : 'Unverified'}</span>{actions(record, true)}</div>
            </article>)}</div>
          </> : <div className="admin-empty" data-testid="status-doctors-empty"><span className="admin-empty__icon"><UsersRound size={21} aria-hidden="true" /></span><strong>{total ? 'No matching doctors' : 'No doctor records yet'}</strong><p>{total ? 'Try a different search or reset the filters.' : 'Add a doctor to start the shared server directory.'}</p>{total > 0 && hasFilters && <button className="doctor-master__text-button" type="button" onClick={resetFilters} data-testid="button-reset-empty-doctor-filters">Reset filters</button>}</div>}
          {!loading && <TablePagination page={page} pageSize={pageSize} pageCount={pageCount} filtered={filtered} total={total} label="doctors" onPageChange={(n) => { setPage(n); setSelected([]); }} onPageSizeChange={(n) => { setPageSize(n); setPage(1); setSelected([]); }} testId="text-doctor-count" />}
        </>}
      </section>
      {confirming?.type === 'delete' && <ConfirmationDialog destructive pending={pending} blocked={loading || Boolean(error)} title="Delete doctor?" description={`Remove “${confirming.name}” from normal use? Stored relationships, Patients and Opening Balances remain. This does not change business status or reassign records.`} actionLabel="Delete doctor" onConfirm={handleConfirm} onClose={closeConfirmation} error={actionError} />}
      {confirming?.type === 'status' && <ConfirmationDialog pending={pending} blocked={Boolean(error)} title={`${confirming.value === 'active' ? 'Activate' : 'Inactivate'} doctor?`} description={`Change “${confirming.name}” to ${confirming.value}? Verification is separate and this change does not create login access.`} actionLabel={confirming.value === 'active' ? 'Activate doctor' : 'Inactivate doctor'} onConfirm={handleConfirm} onClose={closeConfirmation} error={actionError} />}
      {confirming?.type === 'contact' && <ConfirmationDialog pending={pending} blocked={Boolean(error)} title={`Make phone and email ${confirming.value}?`} description={`Change the contact rule for “${confirming.name}”? ${confirming.value === 'required' ? 'Both fields must be filled before they can be required.' : 'Supplied phone and email must still have valid formats.'}`} actionLabel={`Make both ${confirming.value}`} onConfirm={handleConfirm} onClose={closeConfirmation} error={actionError} />}
      {confirming?.type === 'verification' && <ConfirmationDialog pending={pending} blocked={Boolean(error)} title={`${confirming.value === 'verified' ? 'Verify' : 'Unverify'} ${count === 1 ? 'doctor' : `${count} doctors`}?`} description={`Set verification to ${confirming.value} for ${count} selected ${count === 1 ? 'doctor' : 'doctors'}? This does not change active status or create login access.`} actionLabel={confirming.value === 'verified' ? 'Confirm verification' : 'Confirm unverification'} onConfirm={handleConfirm} onClose={closeConfirmation} error={actionError} />}
      {confirming?.type === 'shift' && <Dialog title={`Shift ${count === 1 ? 'doctor' : `${count} doctors`} to another MR?`} eyebrow="Confirm assignment" description="The selected doctors will be assigned to the chosen MR and inherit that MR’s zone." onClose={closeConfirmation} footer={<><button type="button" className="admin-button admin-button--secondary" disabled={pending} onClick={closeConfirmation} data-testid="button-cancel-shift-doctors">Cancel</button><button type="button" className="admin-button" onClick={handleConfirm} disabled={!targetMR || pending || Boolean(error)} data-testid="button-confirm-shift-doctors">{pending ? 'Saving…' : 'Shift MR'}</button></>}>
        <label className="doctor-master__dialog-field" htmlFor="doctor-target-mr">New MR<select id="doctor-target-mr" className="admin-select" disabled={pending} value={targetMR} onChange={(event) => { setTargetMR(event.target.value); setActionError(''); }} data-testid="select-shift-doctor-mr"><option value="">Choose an MR</option>{mrs.filter((mr) => mr.usable).map((mr) => <option key={mr.id} value={mr.id}>{mr.name} · {mr.zoneName}</option>)}</select></label>
        {actionError && <div className="admin-feedback admin-feedback--error" role="alert" style={{ marginTop: 12 }}>{actionError}</div>}
      </Dialog>}
    </div>
  </AdminLayout>;
}