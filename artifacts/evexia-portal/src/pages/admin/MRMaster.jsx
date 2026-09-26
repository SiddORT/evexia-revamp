import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'wouter';
import { CalendarDays, CirclePower, Download, Hash, Mail, Pencil, Phone, Plus, Search, Upload, UsersRound } from 'lucide-react';
import AdminLayout from '../../components/admin/AdminLayout.jsx';
import ConfirmationDialog from '../../components/admin/ConfirmationDialog.jsx';
import Dialog from '../../components/admin/Dialog.jsx';
import DataTable from '../../components/admin/DataTable.jsx';
import StatusBadge from '../../components/admin/StatusBadge.jsx';
import TablePagination from '../../components/admin/TablePagination.jsx';
import useMRs from '../../hooks/useMRs.js';
import useTablePagination from '../../hooks/useTablePagination.js';
import { exportMRCSV, loadMRs } from '../../services/mrs.js';
import { loadZones } from '../../services/zones.js';
import { DOCTOR_STORAGE_KEY, loadDoctors } from '../../services/doctors.js';
import '../../mr.css';

const cleanPhone = (phone) => phone.replace(/[^+\d]/g, '');
const dateFormat = new Intl.DateTimeFormat('en-US', { day: '2-digit', month: 'short', year: 'numeric' });
const dateTimeFormat = new Intl.DateTimeFormat('en-US', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

function formattedDate(value, formatter) {
  if (!value) return '—';
  const date = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  return Number.isNaN(date.getTime()) ? '—' : formatter.format(date);
}

function auditDetails(name, value) {
  return <span className="admin-mr-audit"><strong>{name}</strong><time dateTime={value}>{formattedDate(value, dateTimeFormat)}</time></span>;
}

export default function MRMaster() {
  const [, navigate] = useLocation();
  const { records, zones, error, feedback, retry, clearFeedback, changeStatus } = useMRs();
  const [saveFeedback] = useState(() => {
    const saved = new URLSearchParams(window.location.search).get('saved');
    return saved === 'added' ? 'MR added successfully.' : saved === 'updated' ? 'MR updated successfully.' : '';
  });
  useEffect(() => {
    if (saveFeedback) window.history.replaceState(window.history.state, '', '/admin/masters/mrs');
  }, [saveFeedback]);
  const [search, setSearch] = useState('');
  const [zoneFilter, setZoneFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [confirming, setConfirming] = useState(null);
  const [actionError, setActionError] = useState('');
  const [doctorView, setDoctorView] = useState(null);
  useEffect(() => {
    if (!doctorView) return undefined;
    const onStorage = (event) => {
      if ([DOCTOR_STORAGE_KEY, 'evexia.admin.mrs.v1', null].includes(event.key)) {
        setDoctorView((previous) => previous && ({ ...previous, error: 'Doctor assignments or MR records changed in another tab. Close this window, refresh records and reopen it.' }));
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [Boolean(doctorView)]);
  const zoneName = (record) => zones.find((zone) => zone.id === record.zoneId)?.name || 'Deleted zone';
  const managerName = (record) => records.find((candidate) => candidate.id === record.reportingManagerId)?.name || (record.reportingManagerId ? 'Missing MR' : '—');
  const visible = useMemo(() => records.filter((record) => {
    const query = search.trim().toLocaleLowerCase();
    return (!query || [record.name, record.designation, record.phone, record.email, record.employeeCode, record.dateOfJoining, record.hq].some((value) => value.toLocaleLowerCase().includes(query)))
      && (zoneFilter === 'all' || (zoneFilter === 'missing' ? !zones.some((zone) => zone.id === record.zoneId) : record.zoneId === zoneFilter))
      && (statusFilter === 'all' || record.status === statusFilter);
  }), [records, zones, search, zoneFilter, statusFilter]);
  const pagination = useTablePagination(visible);
  const hasMissingZones = records.some((record) => !zones.some((zone) => zone.id === record.zoneId));

  function toggle() {
    const status = confirming.status === 'active' ? 'inactive' : 'active';
    const result = changeStatus(confirming.id, status);
    if (result.success) { setConfirming(null); setActionError(''); }
    else setActionError(result.error);
  }
  function exportVisible() {
    if (!visible.length || error) return;
    try {
      if (JSON.stringify(loadMRs()) !== JSON.stringify(records) || JSON.stringify(loadZones()) !== JSON.stringify(zones)) {
        setActionError('Saved records or zones changed in another tab. Refresh records before exporting.');
        return;
      }
      const csv = exportMRCSV(visible, zones, records);
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = 'evexia-mr-master.csv';
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setActionError('CSV export failed. Please try again.');
    }
  }
  function showDoctors(record) {
    try {
      const savedDoctors = loadDoctors();
      const doctors = savedDoctors.filter((doctor) => doctor.mrId === record.id);
      const currentMRs = loadMRs();
      if (JSON.stringify(currentMRs) !== JSON.stringify(records) || JSON.stringify(loadDoctors()) !== JSON.stringify(savedDoctors)) {
        setDoctorView({ record, error: 'MR or doctor assignments changed while loading. Refresh records before viewing doctors.' });
      } else {
        setDoctorView({ record, doctors });
      }
    } catch (cause) {
      setDoctorView({ record, error: cause.message || 'Doctor records could not be loaded. Refresh and try again.' });
    }
  }
  function actions(record, compact = false) {
    return <div className={compact ? 'admin-mr-card__actions' : 'admin-table__actions'}>
      <a className={compact ? 'admin-mr-card__action' : 'admin-icon-button'} href={`tel:${cleanPhone(record.phone)}`} aria-label={`Call ${record.name} at ${record.phone}`} title="Call" data-testid={`action-call-mr-${record.id}`}><Phone size={16} aria-hidden="true" />{compact && 'Call'}</a>
      <button type="button" className={compact ? 'admin-mr-card__action' : 'admin-icon-button'} aria-label={`View doctors for ${record.name}`} title="View doctors" onClick={() => showDoctors(record)} data-testid={`button-doctors-mr-${record.id}`}><UsersRound size={16} aria-hidden="true" />{compact && 'Doctors'}</button>
      <button type="button" className={compact ? 'admin-mr-card__action' : 'admin-icon-button'} aria-label={`Edit ${record.name}`} title="Edit" onClick={() => { clearFeedback(); navigate(`/admin/masters/mrs/${encodeURIComponent(record.id)}`); }} data-testid={`button-edit-mr-${record.id}`}><Pencil size={16} aria-hidden="true" />{compact && 'Edit'}</button>
      <button type="button" className={compact ? 'admin-mr-card__action' : 'admin-icon-button'} aria-label={`${record.status === 'active' ? 'Inactivate' : 'Activate'} ${record.name}`} title={record.status === 'active' ? 'Inactivate' : 'Activate'} onClick={() => { clearFeedback(); setActionError(''); setConfirming(record); }} data-testid={`button-toggle-mr-${record.id}`}><CirclePower size={16} aria-hidden="true" />{compact && (record.status === 'active' ? 'Inactivate' : 'Activate')}</button>
    </div>;
  }
  function details(record, showName = true) {
    return <div className="admin-mr-details" data-testid={`text-mr-details-${record.id}`}>
      {showName && <strong>{record.name}</strong>}
      <span className="admin-mr-details__line"><Hash size={14} aria-hidden="true" /><span><span className="sr-only">Employee code: </span>{record.employeeCode}</span></span>
      <span className="admin-mr-details__line"><Phone size={14} aria-hidden="true" /><a href={`tel:${cleanPhone(record.phone)}`} aria-label={`Call ${record.name} at ${record.phone}`} data-testid={`link-phone-mr-${record.id}`}>{record.phone}</a></span>
      <span className="admin-mr-details__line"><Mail size={14} aria-hidden="true" /><a href={`mailto:${record.email}`} aria-label={`Email ${record.name} at ${record.email}`} data-testid={`link-email-mr-${record.id}`}>{record.email}</a></span>
      <span className="admin-mr-details__line"><CalendarDays size={14} aria-hidden="true" /><span><span className="sr-only">Date of joining: </span>{formattedDate(record.dateOfJoining, dateFormat)}</span></span>
    </div>;
  }
  function address(record) {
    return <span className="admin-mr-address">{[record.addressLine1, record.addressLine2, record.landmark, `${record.city}, ${record.state} ${record.pincode}`, record.country].filter(Boolean).join(' · ')}</span>;
  }
  const columns = [
    { key: 'serial', label: 'Sr No.', render: (_, index) => index + 1 },
    { key: 'details', label: 'Employee details', render: (record) => details(record) },
    { key: 'address', label: 'Address', render: address },
    { key: 'designation', label: 'Designation', render: (record) => record.designation },
    { key: 'manager', label: 'Reporting manager', render: managerName },
    { key: 'zone', label: 'Assigned zone', render: (record) => <span className={!zones.some((zone) => zone.id === record.zoneId) ? 'admin-mr-missing' : ''}>{zoneName(record)}</span> },
    { key: 'status', label: 'Status', render: (record) => <StatusBadge status={record.status} id={record.id} kind="mr" /> },
    { key: 'created', label: 'Created details', render: (record) => auditDetails(record.createdBy, record.createdAt) },
    { key: 'updated', label: 'Updated details', render: (record) => auditDetails(record.updatedBy, record.updatedAt) },
    { key: 'actions', label: 'Actions', render: (record) => actions(record) },
  ];
  return <AdminLayout title="MR Master">
    <div className="admin-page-head">
      <div><p className="admin-page-head__eyebrow">Masters / Team</p><h1>MR Master</h1><p className="admin-page-head__description">Manage MR profiles in this browser. This preview does not create login accounts.</p></div>
      <div className="admin-mr-head-actions">
         <button type="button" className="admin-button admin-button--secondary" onClick={() => { retry(); setActionError(''); setConfirming(null); }} data-testid="button-refresh-mrs">Refresh records</button>
          <button type="button" className="admin-button admin-button--secondary" onClick={() => navigate('/admin/masters/import/mr')} data-testid="button-import-mrs"><Upload size={16} aria-hidden="true" /> Import data</button>
         <button type="button" className="admin-button admin-button--secondary" disabled={Boolean(error) || !visible.length} onClick={exportVisible} data-testid="button-export-mrs"><Download size={16} aria-hidden="true" /> Export data</button>
         <button type="button" className="admin-button" disabled={Boolean(error)} onClick={() => { clearFeedback(); navigate('/admin/masters/mrs/new'); }} data-testid="button-add-mr"><Plus size={16} aria-hidden="true" /> Add MR</button>
      </div>
    </div>
     {(feedback || saveFeedback) && <div className="admin-feedback" role="status" data-testid="status-mr-feedback">{feedback || saveFeedback}</div>}
    {actionError && !confirming && <div className="admin-feedback admin-feedback--error" role="alert">{actionError}</div>}
    <section className="admin-panel" aria-label="MR list">
      <div className="admin-toolbar">
        <div className="admin-toolbar__fields">
           <label className="admin-search"><Search size={16} aria-hidden="true" /><span className="sr-only">Search MR details</span><input value={search} onChange={(event) => { setSearch(event.target.value); pagination.resetPage(); }} placeholder="Search MR details" data-testid="input-search-mrs" /></label>
           <div className="admin-filter"><label htmlFor="mr-zone-filter">Assigned zone</label><select id="mr-zone-filter" className="admin-select" value={zoneFilter} onChange={(event) => { setZoneFilter(event.target.value); pagination.resetPage(); }} data-testid="select-filter-mr-zone"><option value="all">All zones</option>{zones.map((zone) => <option key={zone.id} value={zone.id}>{zone.name}{zone.status === 'inactive' ? ' (inactive)' : ''}</option>)}{hasMissingZones && <option value="missing">Deleted zone</option>}</select></div>
           <div className="admin-filter"><label htmlFor="mr-status-filter">Status</label><select id="mr-status-filter" className="admin-select" value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value); pagination.resetPage(); }} data-testid="select-filter-mr-status"><option value="all">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option></select></div>
        </div>
      </div>
      {error ? <div className="admin-empty" role="alert"><span className="admin-empty__icon"><UsersRound size={21} /></span><strong>MR records could not be loaded</strong><p>{error}</p><button className="admin-button" type="button" onClick={() => { retry(); setActionError(''); }} style={{ marginTop: 16 }} data-testid="button-retry-mrs">Refresh records</button></div> : <>
        {hasMissingZones && <div className="admin-feedback admin-feedback--error" role="status">Some MRs refer to deleted zones. Edit their assignments to an active zone in Zone Master.</div>}
        {visible.length ? <>
           <div className="admin-mr-desktop"><DataTable columns={columns} rows={pagination.pageRows} rowOffset={pagination.startIndex} rowKey={(record) => record.id} label="MR records" testIdPrefix="mr" /></div>
           <div className="admin-mr-mobile" role="list" aria-label="MR records">{pagination.pageRows.map((record) => <article className="admin-mr-card" role="listitem" key={record.id} data-testid={`card-mr-${record.id}`}>
            <div className="admin-mr-card__head"><div><h2>{record.name}</h2><small>{record.designation}</small></div><StatusBadge status={record.status} id={record.id} kind="mr" /></div>
             <div className="admin-mr-card__body">{details(record, false)}<dl><div><dt>Address</dt><dd>{address(record)}</dd></div><div><dt>Manager</dt><dd>{managerName(record)}</dd></div><div><dt>Zone</dt><dd>{zoneName(record)}</dd></div><div><dt>Created by</dt><dd>{auditDetails(record.createdBy, record.createdAt)}</dd></div><div><dt>Updated by</dt><dd>{auditDetails(record.updatedBy, record.updatedAt)}</dd></div></dl></div>
            {actions(record, true)}
          </article>)}</div>
        </> : <div className="admin-empty" data-testid="status-mrs-empty"><span className="admin-empty__icon"><UsersRound size={21} aria-hidden="true" /></span><strong>{records.length ? 'No matching MRs' : 'No MR records yet'}</strong><p>{records.length ? 'Try different search or filters.' : 'Add an MR to create a browser-local preview record.'}</p></div>}
        <TablePagination {...pagination} filtered={visible.length} total={records.length} label={records.length === 1 ? 'MR' : 'MRs'} onPageChange={pagination.setPage} onPageSizeChange={pagination.setPageSize} testId="text-mr-count" />
      </>}
    </section>
    {confirming && <ConfirmationDialog title={`${confirming.status === 'active' ? 'Inactivate' : 'Activate'} MR?`} description={`Change “${confirming.name}” to ${confirming.status === 'active' ? 'inactive' : 'active'}? This only changes this browser-local preview record; it does not control login access.`} actionLabel={`${confirming.status === 'active' ? 'Inactivate' : 'Activate'} MR`} onConfirm={toggle} onClose={() => setConfirming(null)} error={actionError} />}
    {doctorView && <Dialog title={`Doctors for ${doctorView.record.name}`} eyebrow="MR Master" className="admin-mr-doctors-dialog" onClose={() => setDoctorView(null)}>
      {doctorView.error ? <div className="admin-feedback admin-feedback--error" role="alert">{doctorView.error}</div> : doctorView.doctors.length
        ? <div className="admin-mr-doctors-table">
          <p className="admin-mr-doctors-table__count" data-testid="text-mr-doctor-count">{doctorView.doctors.length} {doctorView.doctors.length === 1 ? 'doctor' : 'doctors'} assigned</p>
          <DataTable
            columns={[
              { key: 'doctor', label: 'Doctor / registration', render: (doctor) => <span className="admin-mr-doctors-table__doctor"><strong>{doctor.name}</strong><small>{doctor.registrationNumber}</small></span> },
              { key: 'clinic', label: 'Clinic', render: (doctor) => doctor.clinicName || 'Not provided' },
              { key: 'phone', label: 'Phone', render: (doctor) => <a href={`tel:${cleanPhone(doctor.phone)}`} data-testid={`link-phone-doctor-${doctor.id}`}>{doctor.phone}</a> },
              { key: 'status', label: 'Status', render: (doctor) => <StatusBadge status={doctor.status} /> },
            ]}
            rows={doctorView.doctors}
            rowKey={(doctor) => doctor.id}
            label={`Doctors assigned to ${doctorView.record.name}`}
            testIdPrefix="assigned-doctor"
          />
        </div>
        : <p>No doctors are currently assigned to this MR.</p>}
    </Dialog>}
  </AdminLayout>;
}