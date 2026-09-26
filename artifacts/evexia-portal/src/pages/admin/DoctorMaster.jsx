import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'wouter';
import { ChevronDown, CirclePower, Download, Filter, Pencil, Plus, ReceiptText, Search, ShieldCheck, ShieldX, Upload, UsersRound } from 'lucide-react';
import AdminLayout from '../../components/admin/AdminLayout.jsx';
import ConfirmationDialog from '../../components/admin/ConfirmationDialog.jsx';
import ContactRequirementButton from '../../components/admin/ContactRequirementButton.jsx';
import DataTable from '../../components/admin/DataTable.jsx';
import RecordDetails from '../../components/admin/RecordDetails.jsx';
import Dialog from '../../components/admin/Dialog.jsx';
import StatusBadge from '../../components/admin/StatusBadge.jsx';
import useDoctors from '../../hooks/useDoctors.js';
import { exportDoctorCSV, loadDoctors } from '../../services/doctors.js';
import { loadMRs } from '../../services/mrs.js';
import { loadZones } from '../../services/zones.js';
import '../../doctor-list.css';

const cleanPhone = (value) => String(value || '').replace(/[^\d+]/g, '');
const dialCodes = { IN: '+91', US: '+1', GB: '+44', AE: '+971' };
const text = (value) => String(value ?? '').trim() || '—';
const auditFormatter = new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
function auditDetails(actor, at) {
  const date = new Date(at);
  return <span className="doctor-master__audit"><strong>{text(actor)}</strong><time dateTime={at}>{Number.isNaN(date.getTime()) ? '—' : auditFormatter.format(date)}</time></span>;
}

export default function DoctorMaster() {
  const [, navigate] = useLocation();
  const { records, mrs, zones, error, feedback, retry, clearFeedback, changeStatus, changeVerification, shiftMR, changeContactRequirement } = useDoctors();
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
  const [selected, setSelected] = useState([]);
  const [confirming, setConfirming] = useState(null);
  const [targetMR, setTargetMR] = useState('');
  const [actionError, setActionError] = useState('');

  const mrById = useMemo(() => new Map(mrs.map((mr) => [mr.id, mr])), [mrs]);
  const zoneById = useMemo(() => new Map(zones.map((zone) => [zone.id, zone])), [zones]);
  const mrFor = (record) => mrById.get(record.mrId);
  const zoneFor = (record) => zoneById.get(mrFor(record)?.zoneId);
  const states = useMemo(() => [...new Set(records.map((record) => record.state).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [records]);
  const missingMR = records.some((record) => !mrById.has(record.mrId));
  const missingZone = records.some((record) => mrById.has(record.mrId) && !zoneById.has(mrFor(record)?.zoneId));
  const hasFilters = Boolean(search.trim() || zoneFilter !== 'all' || mrFilter !== 'all' || stateFilter !== 'all' || statusFilter !== 'all');
  const visible = useMemo(() => records.filter((record) => {
    const mr = mrById.get(record.mrId);
    const query = search.trim().toLocaleLowerCase();
    return (!query || [record.name, record.phone, record.alternatePhone, record.email, record.registrationNumber, record.qualification, record.clinicName, mr?.name].some((value) => String(value ?? '').toLocaleLowerCase().includes(query)))
      && (zoneFilter === 'all' || (zoneFilter === 'missing' ? Boolean(mr && !zoneById.has(mr.zoneId)) : mr?.zoneId === zoneFilter))
      && (mrFilter === 'all' || (mrFilter === 'missing' ? !mr : record.mrId === mrFilter))
      && (stateFilter === 'all' || record.state === stateFilter)
      && (statusFilter === 'all' || record.status === statusFilter);
  }), [records, mrById, zoneById, search, zoneFilter, mrFilter, stateFilter, statusFilter]);
  const visibleIds = useMemo(() => new Set(visible.map((record) => record.id)), [visible]);
  const selectedVisible = selected.filter((id) => visibleIds.has(id));
  const allVisibleSelected = visible.length > 0 && visible.every((record) => selected.includes(record.id));
  const activeFilters = [search.trim() && 'search', zoneFilter !== 'all' && 'zone', mrFilter !== 'all' && 'MR', stateFilter !== 'all' && 'state', statusFilter !== 'all' && 'status'].filter(Boolean);

  function resetFilters() {
    setSearch(''); setZoneFilter('all'); setMrFilter('all'); setStateFilter('all'); setStatusFilter('all'); setSelected([]);
  }
  function filterWith(setter, value) { setter(value); setSelected([]); }
  function selectOne(id, checked) { setSelected((previous) => checked ? [...new Set([...previous, id])] : previous.filter((value) => value !== id)); }
  function selectAll(checked) { setSelected((previous) => checked ? [...new Set([...previous, ...visible.map((record) => record.id)])] : previous.filter((id) => !visibleIds.has(id))); }
  function openConfirmation(next) { clearFeedback(); setActionError(''); setConfirming(next); }
  function closeConfirmation() { setConfirming(null); setActionError(''); }
  function handleConfirm() {
    if (!confirming) return;
    let result;
    if (confirming.type === 'status') result = changeStatus(confirming.id, confirming.value);
    if (confirming.type === 'contact') result = changeContactRequirement(confirming.id, confirming.value);
    if (confirming.type === 'verification') result = changeVerification(confirming.ids, confirming.value);
    if (confirming.type === 'shift') {
      if (!targetMR || !mrById.has(targetMR)) { setActionError('Choose an available MR.'); return; }
      result = shiftMR(confirming.ids, targetMR);
    }
    if (result?.success) { closeConfirmation(); setSelected([]); }
    else setActionError(result?.error || 'The change could not be saved. Refresh records and try again.');
  }
  function exportVisible() {
    if (error || !visible.length) return;
    setActionError('');
    try {
      if (JSON.stringify(loadDoctors()) !== JSON.stringify(records)
        || JSON.stringify(loadMRs()) !== JSON.stringify(mrs)
        || JSON.stringify(loadZones()) !== JSON.stringify(zones)) {
        setActionError('Doctor, MR or zone records changed in another tab. Refresh records before exporting.');
        return;
      }
      const csv = exportDoctorCSV(visible, mrs, zones);
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = 'evexia-doctor-master.csv';
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) {
      setActionError(cause?.message || 'CSV export failed. Refresh records and try again.');
    }
  }
  function actions(record, compact = false) {
    const suffix = `${compact ? 'mobile-' : ''}${record.id}`;
    return <div className="doctor-master__actions">
      <button type="button" className="doctor-master__payment-action" aria-label={`Payment history for ${record.name}`} onClick={() => navigate(`/admin/masters/doctors/${encodeURIComponent(record.id)}/payments`)} data-testid={`button-payments-doctor-${suffix}`}><ReceiptText size={15} aria-hidden="true" /> Payment history</button>
      <ContactRequirementButton record={record} kind="doctor" compact={compact} onClick={() => openConfirmation({ type: 'contact', id: record.id, name: record.name, value: record.contactRequirement === 'required' ? 'optional' : 'required' })} />
      <button type="button" className="admin-icon-button" title="Edit doctor" aria-label={`Edit ${record.name}`} onClick={() => { clearFeedback(); navigate(`/admin/masters/doctors/${encodeURIComponent(record.id)}`); }} data-testid={`button-edit-doctor-${suffix}`}><Pencil size={16} aria-hidden="true" /></button>
      <button type="button" className="admin-icon-button" title={record.verification === 'verified' ? 'Unverify' : 'Verify'} aria-label={`${record.verification === 'verified' ? 'Unverify' : 'Verify'} ${record.name}`} onClick={() => openConfirmation({ type: 'verification', ids: [record.id], value: record.verification === 'verified' ? 'unverified' : 'verified' })} data-testid={`button-verification-doctor-${suffix}`}>{record.verification === 'verified' ? <ShieldX size={16} aria-hidden="true" /> : <ShieldCheck size={16} aria-hidden="true" />}</button>
      <button type="button" className="admin-icon-button" title={record.status === 'active' ? 'Inactivate' : 'Activate'} aria-label={`${record.status === 'active' ? 'Inactivate' : 'Activate'} ${record.name}`} onClick={() => openConfirmation({ type: 'status', id: record.id, name: record.name, value: record.status === 'active' ? 'inactive' : 'active' })} data-testid={`button-toggle-doctor-${suffix}`}><CirclePower size={16} aria-hidden="true" /></button>
    </div>;
  }
  function identity(record, mobile = false) {
    const suffix = `${mobile ? 'mobile-' : ''}${record.id}`;
    return <RecordDetails name={record.name} showName={!mobile} testId={`text-doctor-details-${suffix}`} rows={[
      { label: 'Registration number', icon: 'id', value: record.registrationNumber },
      { label: 'Phone', icon: 'phone', value: record.phone ? `${dialCodes[record.dialCountry] || ''} ${record.phone}`.trim() : '', href: record.phone ? `tel:${dialCodes[record.dialCountry] || ''}${cleanPhone(record.phone)}` : undefined, testId: `link-phone-doctor-${suffix}` },
      { label: 'Email', icon: 'email', value: record.email, href: record.email ? `mailto:${record.email}` : undefined, testId: `link-email-doctor-${suffix}` },
      { label: 'Date of joining', icon: 'date', value: record.dateOfJoining },
    ]} />;
  }
  function professional(record) {
    return <div className="admin-record-fields"><span><span className="admin-record-fields__label">Qualification: </span>{text(record.qualification)}</span><span><span className="admin-record-fields__label">Clinic: </span>{text(record.clinicName)}</span></div>;
  }
  function assignment(record) {
    const mr = mrFor(record);
    const zone = zoneFor(record);
    return <div className="admin-record-fields"><span className={!mr ? 'admin-record-missing' : ''}><span className="admin-record-fields__label">MR: </span>{mr ? mr.name : 'Missing MR'}</span><span className={!zone ? 'admin-record-missing' : ''}><span className="admin-record-fields__label">Zone: </span>{mr ? (zone?.name || 'Missing zone') : 'Zone unavailable'}</span></div>;
  }
  function address(record) {
    return <div className="doctor-master__field doctor-master__address"><span>{[record.addressLine1, record.addressLine2, record.landmark].filter(Boolean).join(', ') || '—'}</span><span>{[record.city, record.state, record.pincode].filter(Boolean).join(', ')}</span><span>{text(record.country)}</span></div>;
  }
  const columns = [
    { key: 'select', label: <input type="checkbox" className="doctor-master__check" checked={allVisibleSelected} onChange={(event) => selectAll(event.target.checked)} aria-label="Select all visible doctors" data-testid="checkbox-select-all-doctors" />, render: (record) => <input type="checkbox" className="doctor-master__check" checked={selected.includes(record.id)} onChange={(event) => selectOne(record.id, event.target.checked)} aria-label={`Select ${record.name}`} data-testid={`checkbox-doctor-${record.id}`} /> },
    { key: 'serial', label: 'No.', render: (_, index) => index + 1 },
    { key: 'identity', label: 'Doctor / Contact', render: (record) => identity(record) },
    { key: 'professional', label: 'Professional', render: professional },
    { key: 'assignment', label: 'MR / Zone', render: assignment },
    { key: 'address', label: 'Address', render: address },
    { key: 'verification', label: 'Verification', render: (record) => <span className={`doctor-master__verification${record.verification === 'verified' ? '' : ' doctor-master__verification--pending'}`} data-testid={`status-doctor-verification-${record.id}`}>{record.verification === 'verified' ? 'Verified' : 'Unverified'}</span> },
    { key: 'status', label: 'Status', render: (record) => <StatusBadge status={record.status} id={record.id} kind="doctor" /> },
    { key: 'created', label: 'Created details', render: (record) => auditDetails(record.createdBy, record.createdAt) },
    { key: 'updated', label: 'Updated details', render: (record) => auditDetails(record.updatedBy, record.updatedAt) },
    { key: 'actions', label: 'Actions', render: (record) => actions(record) },
  ];
  const count = confirming?.ids?.length || 1;
  return <AdminLayout title="Doctor Master">
    <div className="doctor-master">
      <div className="admin-page-head">
        <div><p className="admin-page-head__eyebrow">Masters / Care network</p><h1>Doctor Master</h1><p className="admin-page-head__description">Profiles, territories and verification in one working list. Changes are saved in this browser.</p></div>
        <div className="doctor-master__head-actions">
          <button type="button" className="admin-button admin-button--secondary" onClick={() => { retry(); setSelected([]); closeConfirmation(); }} data-testid="button-refresh-doctors">Refresh records</button>
          <button type="button" className="admin-button admin-button--secondary" onClick={() => navigate('/admin/masters/import/doctor')} data-testid="button-import-doctors"><Upload size={16} aria-hidden="true" /> Import data</button>
          <button type="button" className="admin-button admin-button--secondary" disabled={Boolean(error) || !visible.length} onClick={exportVisible} data-testid="button-export-doctors"><Download size={16} aria-hidden="true" /> Export data</button>
          <button type="button" className="admin-button" disabled={Boolean(error)} onClick={() => { clearFeedback(); navigate('/admin/masters/doctors/new'); }} data-testid="button-add-doctor"><Plus size={16} aria-hidden="true" /> Add doctor</button>
        </div>
      </div>
      {(feedback || saveFeedback) && <div className="admin-feedback" role="status" data-testid="status-doctor-feedback">{feedback || saveFeedback}</div>}
      {actionError && !confirming && <div className="admin-feedback admin-feedback--error" role="alert" data-testid="status-doctor-action-error">{actionError}</div>}
      <section className="admin-panel" aria-label="Doctor list">
        <div className="doctor-master__toolbar">
          <div className="doctor-master__toolbar-top">
            <label className="admin-search doctor-master__search"><Search size={16} aria-hidden="true" /><span className="sr-only">Search doctors by name, registration, clinic or contact</span><input value={search} onChange={(event) => filterWith(setSearch, event.target.value)} placeholder="Search name, registration, clinic or contact" data-testid="input-search-doctors" /></label>
            <span className="doctor-master__filter-feedback" data-testid="text-doctor-filter-feedback">{hasFilters ? `${visible.length} matching · ${activeFilters.join(', ')} applied` : `${records.length} total doctors`}{hasFilters && <button type="button" className="doctor-master__text-button" onClick={resetFilters} data-testid="button-reset-doctor-filters">Reset filters</button>}</span>
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
          {selectedVisible.length > 0 && <div className="doctor-master__bulk" role="group" aria-label="Selected doctor actions"><span className="doctor-master__bulk-label" data-testid="text-selected-doctors">{selectedVisible.length} selected from visible records</span>
            <button type="button" className="admin-button admin-button--secondary" onClick={() => { setTargetMR(''); openConfirmation({ type: 'shift', ids: selectedVisible }); }} data-testid="button-shift-doctors">Shift MR</button>
            <button type="button" className="admin-button admin-button--secondary" onClick={() => openConfirmation({ type: 'verification', ids: selectedVisible, value: 'verified' })} data-testid="button-verify-doctors">Verify</button>
            <button type="button" className="admin-button admin-button--secondary" onClick={() => openConfirmation({ type: 'verification', ids: selectedVisible, value: 'unverified' })} data-testid="button-unverify-doctors">Unverify</button>
            <button type="button" className="doctor-master__text-button" onClick={() => setSelected([])} data-testid="button-clear-doctor-selection">Clear selection</button>
          </div>}
          {visible.length ? <>
            <div className="doctor-master__table"><DataTable columns={columns} rows={visible} rowKey={(record) => record.id} label="Doctor records" testIdPrefix="doctor" /></div>
             <div className="doctor-master__card-list" role="list" aria-label="Doctor records">{visible.map((record) => <article role="listitem" className="admin-record-card" key={record.id} data-testid={`card-doctor-${record.id}`}>
               <div className="admin-record-card__head"><div className="admin-record-card__identity"><h2>{record.name}</h2><small>Doctor profile</small></div><input type="checkbox" className="doctor-master__check" checked={selected.includes(record.id)} onChange={(event) => selectOne(record.id, event.target.checked)} aria-label={`Select ${record.name}`} data-testid={`checkbox-mobile-doctor-${record.id}`} /></div>
                <div className="admin-record-card__body">{identity(record, true)}<dl><div><dt>Practice</dt><dd>{professional(record)}</dd></div><div><dt>MR / Zone</dt><dd>{assignment(record)}</dd></div><div><dt>Address</dt><dd>{address(record)}</dd></div><div><dt>Created details</dt><dd>{auditDetails(record.createdBy, record.createdAt)}</dd></div><div><dt>Updated details</dt><dd>{auditDetails(record.updatedBy, record.updatedAt)}</dd></div></dl></div>
               <div className="admin-record-card__foot doctor-master__card-foot"><StatusBadge status={record.status} id={record.id} kind="doctor-mobile" /><span className={`doctor-master__verification${record.verification === 'verified' ? '' : ' doctor-master__verification--pending'}`}>{record.verification === 'verified' ? 'Verified' : 'Unverified'}</span>{actions(record, true)}</div>
            </article>)}</div>
          </> : <div className="admin-empty" data-testid="status-doctors-empty"><span className="admin-empty__icon"><UsersRound size={21} aria-hidden="true" /></span><strong>{records.length ? 'No matching doctors' : 'No doctor records yet'}</strong><p>{records.length ? 'Try a different search or reset the filters.' : 'Add a doctor to start your browser-local directory.'}</p>{records.length > 0 && hasFilters && <button className="doctor-master__text-button" type="button" onClick={resetFilters} data-testid="button-reset-empty-doctor-filters">Reset filters</button>}</div>}
          <div className="admin-panel__foot" data-testid="text-doctor-count">Showing {visible.length} of {records.length} {records.length === 1 ? 'doctor' : 'doctors'} · Export includes only the visible records</div>
        </>}
      </section>
      {confirming?.type === 'status' && <ConfirmationDialog title={`${confirming.value === 'active' ? 'Activate' : 'Inactivate'} doctor?`} description={`Change “${confirming.name}” to ${confirming.value}? Verification is separate and this browser-local change does not control login access.`} actionLabel={confirming.value === 'active' ? 'Activate doctor' : 'Inactivate doctor'} onConfirm={handleConfirm} onClose={closeConfirmation} error={actionError} />}
      {confirming?.type === 'contact' && <ConfirmationDialog title={`Make phone and email ${confirming.value}?`} description={`Change the contact rule for “${confirming.name}”? ${confirming.value === 'required' ? 'Both fields must be filled before they can be required.' : 'Supplied phone and email must still have valid formats.'}`} actionLabel={`Make both ${confirming.value}`} onConfirm={handleConfirm} onClose={closeConfirmation} error={actionError} />}
      {confirming?.type === 'verification' && <ConfirmationDialog title={`${confirming.value === 'verified' ? 'Verify' : 'Unverify'} ${count === 1 ? 'doctor' : `${count} doctors`}?`} description={`Set verification to ${confirming.value} for ${count} selected ${count === 1 ? 'doctor' : 'doctors'}? This does not change active status or create login access.`} actionLabel={confirming.value === 'verified' ? 'Confirm verification' : 'Confirm unverification'} onConfirm={handleConfirm} onClose={closeConfirmation} error={actionError} />}
      {confirming?.type === 'shift' && <Dialog title={`Shift ${count === 1 ? 'doctor' : `${count} doctors`} to another MR?`} eyebrow="Confirm assignment" description="The selected doctors will be assigned to the chosen MR and inherit that MR’s zone." onClose={closeConfirmation} footer={<><button type="button" className="admin-button admin-button--secondary" onClick={closeConfirmation} data-testid="button-cancel-shift-doctors">Cancel</button><button type="button" className="admin-button" onClick={handleConfirm} disabled={!targetMR} data-testid="button-confirm-shift-doctors">Shift MR</button></>}>
        <label className="doctor-master__dialog-field" htmlFor="doctor-target-mr">New MR<select id="doctor-target-mr" className="admin-select" value={targetMR} onChange={(event) => { setTargetMR(event.target.value); setActionError(''); }} data-testid="select-shift-doctor-mr"><option value="">Choose an MR</option>{mrs.filter((mr) => mr.status === 'active' && zoneById.has(mr.zoneId)).map((mr) => <option key={mr.id} value={mr.id}>{mr.name} · {zoneById.get(mr.zoneId)?.name}</option>)}</select></label>
        {actionError && <div className="admin-feedback admin-feedback--error" role="alert" style={{ marginTop: 12 }}>{actionError}</div>}
      </Dialog>}
    </div>
  </AdminLayout>;
}