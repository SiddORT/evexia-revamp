import { useMemo, useState } from 'react';
import { CirclePower, Download, Mail, Pencil, Phone, Plus, Search, UsersRound } from 'lucide-react';
import AdminLayout from '../../components/admin/AdminLayout.jsx';
import ConfirmationDialog from '../../components/admin/ConfirmationDialog.jsx';
import DataTable from '../../components/admin/DataTable.jsx';
import MRForm from '../../components/admin/MRForm.jsx';
import StatusBadge from '../../components/admin/StatusBadge.jsx';
import useMRs from '../../hooks/useMRs.js';
import { exportMRCSV, loadMRs } from '../../services/mrs.js';
import { loadZones } from '../../services/zones.js';
import '../../mr.css';

const cleanPhone = (phone) => phone.replace(/[^+\d]/g, '');

export default function MRMaster() {
  const { records, zones, error, feedback, retry, clearFeedback, add, edit, changeStatus } = useMRs();
  const [search, setSearch] = useState('');
  const [zoneFilter, setZoneFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [editing, setEditing] = useState(null);
  const [confirming, setConfirming] = useState(null);
  const [actionError, setActionError] = useState('');
  const zoneName = (record) => zones.find((zone) => zone.id === record.zoneId)?.name || 'Deleted zone';
  const managerName = (record) => records.find((candidate) => candidate.id === record.reportingManagerId)?.name || (record.reportingManagerId ? 'Missing MR' : '—');
  const visible = useMemo(() => records.filter((record) => {
    const query = search.trim().toLocaleLowerCase();
    return (!query || [record.name, record.designation, record.phone, record.employeeCode].some((value) => value.toLocaleLowerCase().includes(query)))
      && (zoneFilter === 'all' || (zoneFilter === 'missing' ? !zones.some((zone) => zone.id === record.zoneId) : record.zoneId === zoneFilter))
      && (statusFilter === 'all' || record.status === statusFilter);
  }), [records, zones, search, zoneFilter, statusFilter]);
  const hasMissingZones = records.some((record) => !zones.some((zone) => zone.id === record.zoneId));

  function save(values) {
    const result = editing === 'new' ? add(values) : edit(editing.id, values);
    if (result.success) setEditing(null);
    return result;
  }
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
  function actions(record, compact = false) {
    return <div className={compact ? 'admin-mr-card__actions' : 'admin-table__actions'}>
      <button type="button" className={compact ? 'admin-mr-card__action' : 'admin-icon-button'} aria-label={`Edit ${record.name}`} title="Edit" onClick={() => { clearFeedback(); setEditing(record); }} data-testid={`button-edit-mr-${record.id}`}><Pencil size={16} aria-hidden="true" />{compact && 'Edit'}</button>
      <button type="button" className={compact ? 'admin-mr-card__action' : 'admin-icon-button'} aria-label={`${record.status === 'active' ? 'Inactivate' : 'Activate'} ${record.name}`} title={record.status === 'active' ? 'Inactivate' : 'Activate'} onClick={() => { clearFeedback(); setActionError(''); setConfirming(record); }} data-testid={`button-toggle-mr-${record.id}`}><CirclePower size={16} aria-hidden="true" />{compact && (record.status === 'active' ? 'Inactivate' : 'Activate')}</button>
    </div>;
  }
  function details(record) {
    return <div className="admin-mr-details" data-testid={`text-mr-details-${record.id}`}>
      <strong>{record.name}</strong>
      <span>Code: {record.employeeCode} · ID: {record.userId}</span>
      <span>Phone: {record.phone ? <a href={`tel:${cleanPhone(record.phone)}`} aria-label={`Call ${record.name} at ${record.phone}`} data-testid={`link-phone-mr-${record.id}`}>{record.phone} <Phone size={12} aria-hidden="true" /></a> : '—'}</span>
      <span>Email: {record.email ? <a href={`mailto:${record.email}`} aria-label={`Email ${record.name} at ${record.email}`} data-testid={`link-email-mr-${record.id}`}>{record.email} <Mail size={12} aria-hidden="true" /></a> : '—'}</span>
      <span>HQ: {record.hq}</span>
    </div>;
  }
  function address(record) {
    return <span className="admin-mr-address">{[record.addressLine1, record.addressLine2, record.landmark, `${record.city}, ${record.state} ${record.pincode}`, record.country].filter(Boolean).join(' · ')}</span>;
  }
  const columns = [
    { key: 'serial', label: 'Sr No.', render: (_, index) => index + 1 },
    { key: 'details', label: 'Employee details', render: details },
    { key: 'address', label: 'Address', render: address },
    { key: 'designation', label: 'Designation', render: (record) => record.designation },
    { key: 'manager', label: 'Reporting manager', render: managerName },
    { key: 'zone', label: 'Assigned zone', render: (record) => <span className={!zones.some((zone) => zone.id === record.zoneId) ? 'admin-mr-missing' : ''}>{zoneName(record)}</span> },
    { key: 'status', label: 'Status', render: (record) => <StatusBadge status={record.status} id={record.id} kind="mr" /> },
    { key: 'actions', label: 'Actions', render: (record) => actions(record) },
  ];
  return <AdminLayout title="MR Master">
    <div className="admin-page-head">
      <div><p className="admin-page-head__eyebrow">Masters / Team</p><h1>MR Master</h1><p className="admin-page-head__description">Manage MR profiles in this browser. This preview does not create login accounts.</p></div>
      <div className="admin-mr-head-actions">
        <button type="button" className="admin-button admin-button--secondary" onClick={() => { retry(); setActionError(''); setEditing(null); setConfirming(null); }} data-testid="button-refresh-mrs">Refresh records</button>
        <button type="button" className="admin-button admin-button--secondary" disabled={Boolean(error) || !visible.length} onClick={exportVisible} data-testid="button-export-mrs"><Download size={16} aria-hidden="true" /> Export CSV</button>
        <button type="button" className="admin-button" disabled={Boolean(error)} onClick={() => { clearFeedback(); setEditing('new'); }} data-testid="button-add-mr"><Plus size={16} aria-hidden="true" /> Add MR</button>
      </div>
    </div>
    {feedback && <div className="admin-feedback" role="status" data-testid="status-mr-feedback">{feedback}</div>}
    {actionError && !confirming && <div className="admin-feedback admin-feedback--error" role="alert">{actionError}</div>}
    <section className="admin-panel" aria-label="MR list">
      <div className="admin-toolbar">
        <div className="admin-toolbar__fields">
          <label className="admin-search"><Search size={16} aria-hidden="true" /><span className="sr-only">Search by name, designation, phone or employee code</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name, designation, phone or code" data-testid="input-search-mrs" /></label>
          <div className="admin-filter"><label htmlFor="mr-zone-filter">Assigned zone</label><select id="mr-zone-filter" className="admin-select" value={zoneFilter} onChange={(event) => setZoneFilter(event.target.value)} data-testid="select-filter-mr-zone"><option value="all">All zones</option>{zones.map((zone) => <option key={zone.id} value={zone.id}>{zone.name}{zone.status === 'inactive' ? ' (inactive)' : ''}</option>)}{hasMissingZones && <option value="missing">Deleted zone</option>}</select></div>
          <div className="admin-filter"><label htmlFor="mr-status-filter">Status</label><select id="mr-status-filter" className="admin-select" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} data-testid="select-filter-mr-status"><option value="all">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option></select></div>
        </div>
      </div>
      {error ? <div className="admin-empty" role="alert"><span className="admin-empty__icon"><UsersRound size={21} /></span><strong>MR records could not be loaded</strong><p>{error}</p><button className="admin-button" type="button" onClick={() => { retry(); setActionError(''); }} style={{ marginTop: 16 }} data-testid="button-retry-mrs">Refresh records</button></div> : <>
        {hasMissingZones && <div className="admin-feedback admin-feedback--error" role="status">Some MRs refer to deleted zones. Edit their assignments to an active zone in Zone Master.</div>}
        {visible.length ? <>
          <div className="admin-mr-desktop"><DataTable columns={columns} rows={visible} rowKey={(record) => record.id} label="MR records" testIdPrefix="mr" /></div>
          <div className="admin-mr-mobile" role="list" aria-label="MR records">{visible.map((record) => <article className="admin-mr-card" role="listitem" key={record.id} data-testid={`card-mr-${record.id}`}>
            <div className="admin-mr-card__head"><div><h2>{record.name}</h2><small>{record.designation}</small></div><StatusBadge status={record.status} id={record.id} kind="mr" /></div>
            <div className="admin-mr-card__body">{details(record)}<dl><div><dt>Address</dt><dd>{address(record)}</dd></div><div><dt>Manager</dt><dd>{managerName(record)}</dd></div><div><dt>Zone</dt><dd>{zoneName(record)}</dd></div></dl></div>
            {actions(record, true)}
          </article>)}</div>
        </> : <div className="admin-empty" data-testid="status-mrs-empty"><span className="admin-empty__icon"><UsersRound size={21} aria-hidden="true" /></span><strong>{records.length ? 'No matching MRs' : 'No MR records yet'}</strong><p>{records.length ? 'Try different search or filters.' : 'Add an MR to create a browser-local preview record.'}</p></div>}
        <div className="admin-panel__foot" data-testid="text-mr-count">Showing {visible.length} of {records.length} {records.length === 1 ? 'MR' : 'MRs'}</div>
      </>}
    </section>
    {editing && <MRForm key={editing === 'new' ? 'new' : editing.id} mr={editing === 'new' ? null : editing} records={records} zones={zones} onSave={save} onClose={() => setEditing(null)} />}
    {confirming && <ConfirmationDialog title={`${confirming.status === 'active' ? 'Inactivate' : 'Activate'} MR?`} description={`Change “${confirming.name}” to ${confirming.status === 'active' ? 'inactive' : 'active'}? This only changes this browser-local preview record; it does not control login access.`} actionLabel={`${confirming.status === 'active' ? 'Inactivate' : 'Activate'} MR`} onConfirm={toggle} onClose={() => setConfirming(null)} error={actionError} />}
  </AdminLayout>;
}