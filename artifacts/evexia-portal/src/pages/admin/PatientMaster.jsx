import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'wouter';
import { CirclePower, Download, History, Pencil, Plus, Search, Upload, UsersRound } from 'lucide-react';
import AdminLayout from '../../components/admin/AdminLayout.jsx';
import ConfirmationDialog from '../../components/admin/ConfirmationDialog.jsx';
import DataTable from '../../components/admin/DataTable.jsx';
import StatusBadge from '../../components/admin/StatusBadge.jsx';
import TablePagination from '../../components/admin/TablePagination.jsx';
import usePatients from '../../hooks/usePatients.js';
import useTablePagination from '../../hooks/useTablePagination.js';
import { exportPatientCSV, patientAge, readPatientSnapshots } from '../../services/patients.js';
import { getSampleDosageHistory } from '../../services/patientDosageHistory.js';
import '../../mr.css';
import '../../patient.css';

const base = '/admin/masters/patients';
function download(text, filename) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export default function PatientMaster() {
  const [, navigate] = useLocation();
  const { records, doctors, mrs, zones, error, feedback, retry, clearFeedback, changeStatus } = usePatients();
  const [saved] = useState(() => new URLSearchParams(window.location.search).get('saved'));
  useEffect(() => { if (saved) window.history.replaceState(window.history.state, '', base); }, [saved]);
  const [search, setSearch] = useState('');
  const [zone, setZone] = useState('all');
  const [mr, setMR] = useState('all');
  const [status, setStatus] = useState('all');
  const [confirming, setConfirming] = useState(null);
  const [actionError, setActionError] = useState('');
  const doctorFor = (record) => doctors.find((item) => item.id === record.doctorId);
  const mrFor = (record) => mrs.find((item) => item.id === doctorFor(record)?.mrId);
  const zoneFor = (record) => zones.find((item) => item.id === mrFor(record)?.zoneId);
  const missing = (record) => !doctorFor(record) || !mrFor(record) || !zoneFor(record);
  const visible = useMemo(() => records.filter((record) => {
    const doctor = doctors.find((item) => item.id === record.doctorId);
    const assignedMR = mrs.find((item) => item.id === doctor?.mrId);
    const assignedZone = zones.find((item) => item.id === assignedMR?.zoneId);
    return (!search.trim() || [record.name, record.id].some((value) => value.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())))
      && (zone === 'all' || (zone === 'missing' ? !assignedZone : assignedZone?.id === zone))
      && (mr === 'all' || (mr === 'missing' ? !assignedMR : assignedMR?.id === mr))
      && (status === 'all' || record.status === status);
  }), [records, doctors, mrs, zones, search, zone, mr, status]);
  const pagination = useTablePagination(visible);
  const hasMissing = records.some(missing);
  function refresh() { retry(); setActionError(''); setConfirming(null); }
  function exportVisible() {
    try {
      if (error) return;
      const current = readPatientSnapshots();
      if (['records', 'doctors', 'mrs', 'zones'].some((key) => JSON.stringify(current[key]) !== JSON.stringify({ records, doctors, mrs, zones }[key]))) {
        setActionError('Records changed in another tab. Refresh records before exporting.'); return;
      }
      download(exportPatientCSV(visible, doctors), 'evexia-patient-master.csv');
    } catch (cause) { setActionError(cause.message || 'CSV export failed. Refresh records and try again.'); }
  }
  function actions(record, compact = false) {
    return <div className={compact ? 'admin-mr-card__actions' : 'admin-table__actions'}>
      <button type="button" className={compact ? 'admin-mr-card__action' : 'admin-icon-button patient-history-action'} aria-label={`Dosage History for ${record.name}`} title="Dosage History" onClick={() => navigate(`${base}/${encodeURIComponent(record.id)}/dosage-history`)} data-testid={`button-dosage-history-patient-${record.id}`}><History size={16} aria-hidden="true" />Dosage History</button>
      <button type="button" className={compact ? 'admin-mr-card__action' : 'admin-icon-button'} aria-label={`Edit ${record.name}`} title="Edit" onClick={() => { clearFeedback(); navigate(`${base}/${encodeURIComponent(record.id)}`); }} data-testid={`button-edit-patient-${record.id}`}><Pencil size={16} />{compact && 'Edit'}</button>
      <button type="button" className={compact ? 'admin-mr-card__action' : 'admin-icon-button'} aria-label={`${record.status === 'active' ? 'Inactivate' : 'Activate'} ${record.name}`} title={record.status === 'active' ? 'Inactivate' : 'Activate'} onClick={() => { setActionError(''); setConfirming(record); }} data-testid={`button-toggle-patient-${record.id}`}><CirclePower size={16} />{compact && (record.status === 'active' ? 'Inactivate' : 'Activate')}</button>
    </div>;
  }
  const reference = (record) => <span className="patient-reference"><strong className={!doctorFor(record) ? 'admin-mr-missing' : ''}>{doctorFor(record)?.name || 'Missing doctor'}</strong><small className={!mrFor(record) ? 'admin-mr-missing' : ''}>MR: {mrFor(record)?.name || 'Missing MR'}</small><small className={!zoneFor(record) ? 'admin-mr-missing' : ''}>Zone: {zoneFor(record)?.name || 'Missing zone'}</small></span>;
  const details = (record) => <span className="admin-mr-details"><strong>{record.name}</strong><span>{record.gender} · {patientAge(record.dateOfBirth)} years</span><span>{record.phone}</span>{record.email && <span>{record.email}</span>}<span>DOB: {record.dateOfBirth}</span></span>;
  const address = (record) => <span className="admin-mr-address">{[record.addressLine1, record.addressLine2, record.landmark, `${record.city}, ${record.state} ${record.pincode}`, record.country].filter(Boolean).join(' · ')}</span>;
  const lastDose = (record) => {
    const last = getSampleDosageHistory(record)?.last;
    return last ? `Sample: ${last.date} (illustrative, not recorded)` : 'Not recorded';
  };
  const columns = [
    { key: 'serial', label: 'Sr No.', render: (_, index) => index + 1 },
    { key: 'id', label: 'Patient ID', render: (r) => r.id },
    { key: 'details', label: 'Patient details', render: details },
    { key: 'address', label: 'Address', render: address },
    { key: 'reference', label: 'Doctor / MR / Zone', render: reference },
    { key: 'language', label: 'Instructions language', render: (r) => r.instructionsLanguage },
    { key: 'dose', label: 'Last dose', render: lastDose },
    { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
    { key: 'actions', label: 'Actions', render: (r) => actions(r) },
  ];
  return <AdminLayout title="Patient Master">
    <div className="admin-page-head"><div><p className="admin-page-head__eyebrow">Masters / Patients</p><h1>Patient Master</h1><p className="admin-page-head__description">Browser-local preview only. Do not enter real patient or health information. Sample dosage examples are illustrative, not recorded treatment.</p></div>
      <div className="admin-mr-head-actions">
        <button className="admin-button admin-button--secondary" type="button" onClick={refresh}>Refresh records</button>
        <button className="admin-button admin-button--secondary" type="button" disabled={Boolean(error)} onClick={() => navigate(`${base}/import`)} data-testid="button-import-patients"><Upload size={16} /> Import CSV</button>
        <button className="admin-button admin-button--secondary" type="button" disabled={Boolean(error) || !visible.length} onClick={exportVisible} data-testid="button-export-patients"><Download size={16} /> Export CSV</button>
        <button className="admin-button" type="button" disabled={Boolean(error)} onClick={() => navigate(`${base}/new`)} data-testid="button-add-patient"><Plus size={16} /> Add Patient</button>
      </div>
    </div>
    {(feedback || saved) && <div className="admin-feedback" role="status">{feedback || (saved === 'imported' ? 'Patients imported successfully.' : `Patient ${saved === 'added' ? 'added' : 'updated'} successfully.`)}</div>}
    {actionError && !confirming && <div className="admin-feedback admin-feedback--error" role="alert">{actionError}</div>}
    <section className="admin-panel" aria-label="Patient list">
      <div className="admin-toolbar"><div className="admin-toolbar__fields">
        <label className="admin-search"><Search size={16} /><span className="sr-only">Search patient name or ID</span><input placeholder="Search name or patient ID" value={search} onChange={(e) => { setSearch(e.target.value); pagination.resetPage(); }} data-testid="input-search-patients" /></label>
        <div className="admin-filter"><label htmlFor="patient-zone">Zone</label><select className="admin-select" id="patient-zone" value={zone} onChange={(e) => { setZone(e.target.value); pagination.resetPage(); }}><option value="all">All zones</option>{zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}{hasMissing && <option value="missing">Missing zone</option>}</select></div>
        <div className="admin-filter"><label htmlFor="patient-mr">MR</label><select className="admin-select" id="patient-mr" value={mr} onChange={(e) => { setMR(e.target.value); pagination.resetPage(); }}><option value="all">All MRs</option>{mrs.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}{records.some((r) => !mrFor(r)) && <option value="missing">Missing MR</option>}</select></div>
        <div className="admin-filter"><label htmlFor="patient-status">Status</label><select className="admin-select" id="patient-status" value={status} onChange={(e) => { setStatus(e.target.value); pagination.resetPage(); }}><option value="all">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option></select></div>
      </div></div>
      {error ? <div className="admin-empty" role="alert"><strong>Patient records could not be loaded</strong><p>{error}</p><button className="admin-button" type="button" onClick={refresh}>Refresh records</button></div> : <>
        {hasMissing && <div className="admin-feedback admin-feedback--error" role="status">Some patients have missing doctor, MR, or zone assignments. Repair the reference in Doctor or MR Master, or edit the patient assignment.</div>}
        {visible.length ? <>
          <div className="admin-mr-desktop"><DataTable columns={columns} rows={pagination.pageRows} rowOffset={pagination.startIndex} rowKey={(r) => r.id} label="Patient records" testIdPrefix="patient" /></div>
          <div className="admin-mr-mobile" role="list" aria-label="Patient records">{pagination.pageRows.map((r) => <article className="admin-mr-card" role="listitem" key={r.id} data-testid={`card-patient-${r.id}`}>
            <div className="admin-mr-card__head"><div><h2>{r.name}</h2><small>{r.id}</small></div><StatusBadge status={r.status} /></div>
            <div className="admin-mr-card__body">{details(r)}<dl><div><dt>Address</dt><dd>{address(r)}</dd></div><div><dt>Doctor / MR / Zone</dt><dd>{reference(r)}</dd></div><div><dt>Instructions language</dt><dd>{r.instructionsLanguage}</dd></div><div><dt>Last dose</dt><dd>{lastDose(r)}</dd></div></dl></div>{actions(r, true)}
          </article>)}</div>
        </> : <div className="admin-empty"><span className="admin-empty__icon"><UsersRound size={21} /></span><strong>{records.length ? 'No matching patients' : 'No patients yet'}</strong><p>{records.length ? 'Try different search or filters.' : 'Add a browser-local preview patient or import a CSV.'}</p></div>}
        <TablePagination {...pagination} filtered={visible.length} total={records.length} label={records.length === 1 ? 'patient' : 'patients'} onPageChange={pagination.setPage} onPageSizeChange={pagination.setPageSize} />
      </>}
    </section>
    {confirming && <ConfirmationDialog title={`${confirming.status === 'active' ? 'Inactivate' : 'Activate'} patient?`} description={`Change “${confirming.name}” to ${confirming.status === 'active' ? 'inactive' : 'active'} in this browser only?`} actionLabel="Confirm status" error={actionError} onClose={() => setConfirming(null)} onConfirm={() => {
      const result = changeStatus(confirming.id, confirming.status === 'active' ? 'inactive' : 'active');
      if (result.success) { setConfirming(null); setActionError(''); } else setActionError(result.error);
    }} />}
  </AdminLayout>;
}