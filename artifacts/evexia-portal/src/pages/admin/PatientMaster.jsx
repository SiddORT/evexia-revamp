import { useEffect, useRef, useState } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { useLocation } from 'wouter';
import { CirclePower, Download, History, Pencil, Plus, Search, Trash2, Upload, UsersRound } from 'lucide-react';
import AdminLayout from '../../components/admin/AdminLayout.jsx';
import { formatAdminDate, useAdminPreferences } from '../../components/admin/adminPreferences.js';
import ConfirmationDialog from '../../components/admin/ConfirmationDialog.jsx';
import DataTable from '../../components/admin/DataTable.jsx';
import RecordDetails from '../../components/admin/RecordDetails.jsx';
import StatusBadge from '../../components/admin/StatusBadge.jsx';
import TablePagination from '../../components/admin/TablePagination.jsx';
import DirectorySearchStatus from '../../components/admin/DirectorySearchStatus.jsx';
import usePatients from '../../hooks/usePatients.js';
import { downloadPatientFile, exportPatients, patientAge } from '../../services/serverPatients.js';
import { internationalPhone } from '../../services/phoneCountries.js';
import { useMasterActions } from '../../auth/useMasterActions.js';
import '../../mr.css';
import '../../patient.css';

const base = '/admin/masters/patients';
export default function PatientMaster() {
  const can = useMasterActions('patient');
  useAdminPreferences();
  const [, navigate] = useLocation();
  const [saved] = useState(() => new URLSearchParams(window.location.search).get('saved'));
  useEffect(() => { if (saved) window.history.replaceState(window.history.state, '', base); }, [saved]);
  const [search, setSearch] = useState('');
  const [zone, setZone] = useState('all');
  const [mr, setMR] = useState('all');
  const [status, setStatus] = useState('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => { const timer = setTimeout(() => setDebouncedSearch(search), 250); return () => clearTimeout(timer); }, [search]);
  const params = { query: debouncedSearch, zone_id: zone, mr_id: mr, status, limit: pageSize, offset: (page - 1) * pageSize };
  const { records, mrs, zones, total, filtered, partial, scanned, nextCursor, continueSearch, restartSearch, loading, pending, error, feedback, retry, clearFeedback, changeStatus, remove } = usePatients(params);
  const [exporting, setExporting] = useState(false);
  const exportBusy = useRef(false);
  const [confirming, setConfirming] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const refreshButton = useRef(null);
  const [focusAfterDelete, setFocusAfterDelete] = useState(false);
  useEffect(() => {
    if (!focusAfterDelete || deleting || loading || pending) return;
    const frame = requestAnimationFrame(() => {
      if (refreshButton.current && !refreshButton.current.disabled) {
        refreshButton.current.focus();
        setFocusAfterDelete(false);
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [focusAfterDelete, deleting, loading, pending]);
  const [actionError, setActionError] = useState('');
  const visible = records;
  const pagination = { page, pageSize, pageCount: Math.max(1, Math.ceil(filtered / pageSize)), startIndex: (page - 1) * pageSize,
    endIndex: Math.min(page * pageSize, filtered), pageRows: records, resetPage: () => setPage(1), setPage, setPageSize };
  const hasMissing = records.some((record) => record.assignmentWarnings?.length);
  useEffect(() => { if (!loading && page > pagination.pageCount) setPage(pagination.pageCount); }, [loading, page, pagination.pageCount]);
  function refresh() { retry(); setActionError(''); setConfirming(null); setDeleting(null); }
  async function exportVisible(format) {
    if (exportBusy.current) return;
    exportBusy.current = true; setExporting(true);
    try {
      if (error) return;
      const blob = await exportPatients(params, format);
      downloadPatientFile(blob, format);
    } catch (cause) { setActionError(cause.message || 'Export failed. Refresh records and try again.'); }
    finally { exportBusy.current = false; setExporting(false); }
  }
  function actions(record, compact = false) {
    return <div className={compact ? 'admin-mr-card__actions' : 'admin-table__actions'}>
      {can.delete && <button type="button" disabled={pending || loading || Boolean(error)} className={compact ? 'admin-mr-card__action' : 'admin-icon-button'} aria-label={`Delete ${record.name}`} title="Delete patient" onClick={() => { setActionError(''); setDeleting(record); }} data-testid={`button-delete-patient-${compact ? 'mobile-' : ''}${record.id}`}><Trash2 size={16} aria-hidden="true" />{compact && 'Delete'}</button>}
      {can.protected && <button type="button" className={compact ? 'admin-mr-card__action' : 'admin-icon-button patient-history-action'} aria-label={`Dosage History for ${record.name}`} title="Dosage History" onClick={() => navigate(`${base}/${encodeURIComponent(record.id)}/dosage-history`)} data-testid={`button-dosage-history-patient-${record.id}`}><History size={16} aria-hidden="true" />Dosage History</button>}
      {can.edit && <button type="button" className={compact ? 'admin-mr-card__action' : 'admin-icon-button'} aria-label={`Edit ${record.name}`} title="Edit" onClick={() => { clearFeedback(); navigate(`${base}/${encodeURIComponent(record.id)}`); }} data-testid={`button-edit-patient-${record.id}`}><Pencil size={16} />{compact && 'Edit'}</button>}
      {can.edit && <button type="button" className={compact ? 'admin-mr-card__action' : 'admin-icon-button'} aria-label={`${record.status === 'active' ? 'Inactivate' : 'Activate'} ${record.name}`} title={record.status === 'active' ? 'Inactivate' : 'Activate'} onClick={() => { setActionError(''); setConfirming(record); }} data-testid={`button-toggle-patient-${record.id}`}><CirclePower size={16} />{compact && (record.status === 'active' ? 'Inactivate' : 'Activate')}</button>}
    </div>;
  }
  const reference = (record) => <span className="admin-record-fields"><span><span className="admin-record-fields__label">Doctor: </span>{record.doctorName || 'Missing doctor'}</span><span><span className="admin-record-fields__label">MR: </span>{record.mrName || 'Missing MR'}</span><span><span className="admin-record-fields__label">Zone: </span>{record.zoneName || 'Missing zone'}</span></span>;
  const details = (record, showName = true) => <RecordDetails name={record.name} showName={showName} testId={`text-patient-details-${record.id}`} rows={[
    { label: 'Gender and age', value: `${record.gender || 'Not specified'} · ${record.dateOfBirth ? `${patientAge(record.dateOfBirth)} years` : 'Age unavailable'}` },
    { label: 'Phone', icon: 'phone', value: internationalPhone(record), href: `tel:${internationalPhone(record)}`, testId: `link-phone-patient-${record.id}` },
    { label: 'Email', icon: 'email', value: record.email, href: record.email ? `mailto:${record.email}` : undefined, testId: `link-email-patient-${record.id}` },
    { label: 'Date of birth', icon: 'date', value: formatAdminDate(record.dateOfBirth) },
  ]} />;
  const address = (record) => <span className="admin-mr-address">{[record.addressLine1, record.addressLine2, record.landmark, `${record.city}, ${record.state} ${record.pincode}`, record.country].filter(Boolean).join(' · ')}</span>;
  const lastDose = () => 'Not recorded';
  const columns = [
    { key: 'serial', label: 'Sr No.', render: (_, index) => index + 1 },
    { key: 'id', label: 'Patient ID', render: (r) => r.code },
    { key: 'details', label: 'Patient details', render: details },
    { key: 'address', label: 'Address', render: address },
    { key: 'reference', label: 'Doctor / MR / Zone', render: reference },
    { key: 'language', label: 'Instructions language', render: (r) => r.instructionsLanguage },
    { key: 'dose', label: 'Last dose', render: lastDose },
    { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
    { key: 'actions', label: 'Actions', render: (r) => actions(r) },
  ];
  return <AdminLayout title="Patient Master">
    <div className="admin-page-head"><div><p className="admin-page-head__eyebrow">Masters / Patients</p><h1>Patient Master</h1><p className="admin-page-head__description">Protected shared records. Doctor, MR and Zone references come from the server. No dosage history is recorded here.</p></div>
      <div className="admin-mr-head-actions">
        <button ref={refreshButton} className="admin-button admin-button--secondary" type="button" onClick={refresh}>Refresh records</button>
        {can.import && <button className="admin-button admin-button--secondary" type="button" disabled={Boolean(error)} onClick={() => navigate(`${base}/import`)} data-testid="button-import-patients"><Upload size={16} /> Import data</button>}
        {can.export && <DropdownMenu.Root><DropdownMenu.Trigger asChild><button className="admin-button admin-button--secondary" type="button" aria-busy={exporting} disabled={Boolean(error) || loading || search !== debouncedSearch || (!partial && !filtered)} data-testid="button-export-patients"><Download size={16} />{exporting ? 'Preparing export…' : 'Export data'}</button></DropdownMenu.Trigger>
          <DropdownMenu.Portal><DropdownMenu.Content className="admin-export-menu" sideOffset={6}>
            <DropdownMenu.Item className="admin-export-menu__item" disabled={exporting} onSelect={() => exportVisible('csv')}>CSV</DropdownMenu.Item>
            <DropdownMenu.Item className="admin-export-menu__item" disabled={exporting} onSelect={() => exportVisible('xlsx')}>Excel (.xlsx)</DropdownMenu.Item>
          </DropdownMenu.Content></DropdownMenu.Portal></DropdownMenu.Root>}
        {can.add && <button className="admin-button" type="button" disabled={Boolean(error)} onClick={() => navigate(`${base}/new`)} data-testid="button-add-patient"><Plus size={16} /> Add Patient</button>}
      </div>
    </div>
    {(feedback || saved) && <div className="admin-feedback" role="status">{feedback || (saved === 'imported' ? 'Patients imported successfully.' : `Patient ${saved === 'added' ? 'added' : 'updated'} successfully.`)}</div>}
    {actionError && !confirming && !deleting && <div className="admin-feedback admin-feedback--error" role="alert">{actionError}</div>}
    <section className="admin-panel" aria-label="Patient list">
      <div className="admin-toolbar"><div className="admin-toolbar__fields">
        <label className="admin-search"><Search size={16} /><span className="sr-only">Search patient name or ID</span><input placeholder="Search name or patient ID" value={search} onChange={(e) => { setSearch(e.target.value); pagination.resetPage(); }} data-testid="input-search-patients" /></label>
        <div className="admin-filter"><label htmlFor="patient-zone">Zone</label><select className="admin-select" id="patient-zone" value={zone} onChange={(e) => { setZone(e.target.value); pagination.resetPage(); }}><option value="all">All zones</option>{zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}<option value="missing">Missing zone</option></select></div>
        <div className="admin-filter"><label htmlFor="patient-mr">MR</label><select className="admin-select" id="patient-mr" value={mr} onChange={(e) => { setMR(e.target.value); pagination.resetPage(); }}><option value="all">All MRs</option>{mrs.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}<option value="missing">Missing MR</option></select></div>
        <div className="admin-filter"><label htmlFor="patient-status">Status</label><select className="admin-select" id="patient-status" value={status} onChange={(e) => { setStatus(e.target.value); pagination.resetPage(); }}><option value="all">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option></select></div>
      </div><button type="button" className="admin-button admin-button--secondary" onClick={() => { setSearch(''); setMR('all'); setZone('all'); setStatus('all'); setPage(1); }}>Reset filters</button></div>
      {loading ? <p className="admin-empty" role="status">Loading Patients…</p> : error ? <div className="admin-empty" role="alert"><strong>Patient records could not be loaded</strong><p>{error}</p><button className="admin-button" type="button" onClick={refresh}>Refresh records</button></div> : <>
        {hasMissing && <div className="admin-feedback admin-feedback--error" role="status">Some patients have missing doctor, MR, or zone assignments. Repair the reference in Doctor or MR Master, or edit the patient assignment.</div>}
        {visible.length ? <>
          <div className="admin-mr-desktop"><DataTable columns={columns} rows={pagination.pageRows} rowOffset={pagination.startIndex} rowKey={(r) => r.id} label="Patient records" testIdPrefix="patient" /></div>
           <div className="admin-mr-mobile" role="list" aria-label="Patient records">{pagination.pageRows.map((r) => <article className="admin-record-card" role="listitem" key={r.id} data-testid={`card-patient-${r.id}`}>
              <div className="admin-record-card__head"><div className="admin-record-card__identity"><h2>{r.name}</h2><small>{r.code}</small></div><StatusBadge status={r.status} /></div>
             <div className="admin-record-card__body">{details(r, false)}<dl><div><dt>Address</dt><dd>{address(r)}</dd></div><div><dt>Doctor / MR / Zone</dt><dd>{reference(r)}</dd></div><div><dt>Instructions language</dt><dd>{r.instructionsLanguage}</dd></div><div><dt>Last dose</dt><dd>{lastDose(r)}</dd></div></dl></div>{actions(r, true)}
          </article>)}</div>
         </> : <div className="admin-empty"><span className="admin-empty__icon"><UsersRound size={21} /></span><strong>{total ? 'No matching patients' : 'No patients yet'}</strong><p>{total ? 'Try different search or filters.' : 'Set up an active Doctor/MR/Zone chain, then add a Patient or import CSV/Excel.'}</p></div>}
         {partial ? <DirectorySearchStatus count={records.length} scanned={scanned} nextCursor={nextCursor} loading={loading} onNext={continueSearch} onRestart={restartSearch} /> : <TablePagination {...pagination} filtered={filtered} total={total} label="patients" onPageChange={setPage} onPageSizeChange={(size) => { setPageSize(size); setPage(1); }} />}
      </>}
    </section>
    {confirming && <ConfirmationDialog title={`${confirming.status === 'active' ? 'Inactivate' : 'Activate'} patient?`} description={`Change “${confirming.name}” to ${confirming.status === 'active' ? 'inactive' : 'active'}? Inactive patients deny MR file access; retained files are not deleted.`} actionLabel="Confirm status" pending={pending} blocked={Boolean(error)} error={actionError} onClose={() => { if (!pending) setConfirming(null); }} onConfirm={async () => {
      const result = await changeStatus(confirming, confirming.status === 'active' ? 'inactive' : 'active');
      if (result.success) { setConfirming(null); setActionError(''); } else setActionError(result.error);
    }} />}
    {deleting && <ConfirmationDialog destructive title="Delete patient?" description={`Remove “${deleting.name}” from normal use? The Patient identity, stored relationships, assigned MR, files and history remain. Business status and private-file access rules do not change.`} actionLabel="Delete patient" pending={pending} blocked={loading || Boolean(error)} error={actionError} onClose={() => { if (!pending) { setDeleting(null); setActionError(''); } }} onConfirm={async () => {
      const result = await remove(deleting);
      if (result.success) { setFocusAfterDelete(true); setDeleting(null); setActionError(''); } else setActionError(result.error);
    }} />}
  </AdminLayout>;
}