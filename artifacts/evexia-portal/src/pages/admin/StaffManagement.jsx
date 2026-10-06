import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'wouter';
import { Download, Eye, EyeOff, Pencil, Plus, RefreshCw, Search, Upload, UsersRound } from 'lucide-react';
import AdminLayout from '../../components/admin/AdminLayout.jsx';
import { formatAdminDate, formatAdminTimestamp, useAdminPreferences } from '../../components/admin/adminPreferences.js';
import DataTable from '../../components/admin/DataTable.jsx';
import Dialog from '../../components/admin/Dialog.jsx';
import PhoneInput from '../../components/admin/PhoneInput.jsx';
import { internationalPhone } from '../../services/phoneCountries.js';
import TablePagination from '../../components/admin/TablePagination.jsx';
import useTablePagination from '../../hooks/useTablePagination.js';
import { loadDesignations } from '../../services/designations.js';
import { getSession, subscribeSession, reportingIdentityGuard } from '../../auth/adminSession.js';
import { STAFF_COLUMNS, STAFF_ROLES, loadStaff, searchStaff, getStaff, validateStaff, createStaff, updateStaff, setStaffStatus, exportStaffCSV } from '../../services/staff.js';
import '../../staff.css';

const FIELDS = ['name', 'phone', 'dialCountry', 'userId', 'email', 'status', 'role', 'designation', 'dateOfJoining'];
const LABELS = Object.fromEntries(STAFF_COLUMNS);
const INITIAL = { name: '', phone: '', dialCountry: 'IN', userId: '', email: '', status: 'active', role: 'Staff', designation: '', dateOfJoining: '' };
const safeFields = (values) => Object.fromEntries(FIELDS.map((key) => [key, values[key] ?? '']));

function downloadCSV(text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'evexia-staff.csv';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function audit(by, at) {
  return <span className="admin-staff-audit"><strong title={by}>Verified Super Admin</strong><time dateTime={at}>{formatAdminTimestamp(at)}</time></span>;
}

function StaffPhone({ record, mobile = false }) {
  return <a className="admin-staff-link" href={`tel:${internationalPhone(record)}`} data-testid={`link-staff-${mobile ? 'mobile-phone' : 'phone'}-${record.id}`}>{internationalPhone(record)}</a>;
}

function StaffForm({ record, designations, onSave, onClose }) {
  const [values, setValues] = useState(() => record ? safeFields(record) : { ...INITIAL });
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [conflicted, setConflicted] = useState(false);
  const [current, setCurrent] = useState(null);
  const gate = useRef(false);
  const active = designations.filter((item) => item.status === 'active');
  const selected = record?.designation;
  const inactiveExisting = selected && !active.some((item) => item.name === selected);
  function change(key, value) {
    setValues((previous) => ({ ...previous, [key]: value }));
    setErrors((previous) => ({ ...previous, [key]: undefined }));
  }
  async function save(event) {
    event.preventDefault();
    if (gate.current || uncertain || conflicted) return;
    const result = validateStaff(values, record ? [record] : [], record?.id, designations);
    setErrors(result.errors);
    if (Object.keys(result.errors).length) return;
    gate.current = true;
    setSaving(true);
    setMessage('');
    try {
      await onSave(result.fields, record);
    } catch (cause) {
      setMessage(cause.message || 'Save failed. Your draft is still here.');
      setUncertain(Boolean(cause.ambiguous));
      setConflicted(cause.code === 'staff_stale');
    } finally { gate.current = false; setSaving(false); }
  }
  async function reviewCurrent() {
    try { setCurrent(await getStaff(record.id)); }
    catch (cause) { setMessage(cause.message); }
  }
  return <Dialog title={record ? 'Edit staff member' : 'Add staff member'} eyebrow="Staff Management"
    description="Saved securely on the server. Business roles and designations do not grant access; staff sign-in and email delivery are unavailable."
    onClose={() => { if (!gate.current) onClose(); }} className="admin-import-dialog"
    footer={<><button type="button" className="admin-button admin-button--secondary" onClick={onClose} disabled={saving} data-testid="button-cancel-staff">Cancel</button><button type="submit" form="staff-management-form" className="admin-button" disabled={saving || uncertain || conflicted} data-testid="button-save-staff">{saving ? 'Saving…' : record ? 'Save changes' : 'Add staff member'}</button></>}>
    <form id="staff-management-form" className="admin-staff-form" onSubmit={save} noValidate>
      {['name', 'phone', 'userId', 'email'].map((key) => {
        const inputProps = { id: `staff-${key}`, name: key, value: values[key], onChange: (event) => change(key, event.target.value),
          disabled: saving, 'aria-required': key !== 'userId', 'aria-invalid': Boolean(errors[key]),
          'aria-describedby': [errors[key] && `staff-error-${key}`, key === 'userId' && 'staff-userId-hint'].filter(Boolean).join(' ') || undefined,
          'data-testid': `input-staff-${key}` };
        return <div key={key} className="admin-staff-field">
          <label htmlFor={`staff-${key}`}>{LABELS[key]} {key !== 'userId' && <span aria-hidden="true">*</span>}</label>
          {key === 'phone' ? <PhoneInput prefix="staff" country={values.dialCountry} onCountryChange={(value) => change('dialCountry', value)} countryError={errors.dialCountry} inputProps={inputProps} />
            : <input {...inputProps} type={key === 'email' ? 'email' : 'text'} autoComplete="off" readOnly={key === 'userId'} placeholder={key === 'userId' && !record ? 'Generated on successful save' : undefined} />}
          {key === 'userId' && <span id="staff-userId-hint" className="admin-staff-field__hint">{record ? 'Existing identity — cannot be changed.' : 'Generated by the server on successful save.'}</span>}
          {key === 'phone' && errors.dialCountry && <span id="staff-dialCountry-error" className="admin-staff-field__error" role="alert">{errors.dialCountry}</span>}
          {errors[key] && <span id={`staff-error-${key}`} className="admin-staff-field__error" role="alert">{errors[key]}</span>}
        </div>;
      })}
      <label className="admin-staff-field"><span>Status <span aria-hidden="true">*</span></span><select value={values.status} onChange={(event) => change('status', event.target.value)} disabled={saving} data-testid="select-staff-status"><option value="active">Active</option><option value="inactive">Inactive</option></select>{errors.status && <span role="alert">{errors.status}</span>}</label>
      <label className="admin-staff-field"><span>Role <span aria-hidden="true">*</span></span><select value={values.role} onChange={(event) => change('role', event.target.value)} disabled={saving} data-testid="select-staff-role">{STAFF_ROLES.map((role) => <option key={role} value={role}>{role}</option>)}</select>{errors.role && <span role="alert">{errors.role}</span>}</label>
      <label className="admin-staff-field"><span>Designation <span aria-hidden="true">*</span></span><select value={values.designation} onChange={(event) => change('designation', event.target.value)} disabled={saving} data-testid="select-staff-designation"><option value="">Select a designation</option>{inactiveExisting && <option value={selected}>{selected} (inactive or no longer available)</option>}{active.map((item) => <option key={item.id} value={item.name}>{item.name}</option>)}</select>{errors.designation && <span className="admin-staff-field__error" role="alert">{errors.designation}</span>}<span className="admin-staff-field__hint">Browser-local choices; the server stores the selected label only.</span></label>
      <label className="admin-staff-field"><span>Date of joining <span aria-hidden="true">*</span></span><input type="date" value={values.dateOfJoining} onChange={(event) => change('dateOfJoining', event.target.value)} disabled={saving} data-testid="input-staff-dateOfJoining" />{errors.dateOfJoining && <span className="admin-staff-field__error" role="alert">{errors.dateOfJoining}</span>}</label>
      <div className="admin-staff-field admin-staff-form__wide"><strong>Password</strong><span className="admin-staff-field__hint">{record ? 'Editing does not change or reveal the password.' : 'A strong initial password is generated automatically and shown once after successful creation for manual handoff. No email is sent; staff cannot sign in in this phase.'}</span></div>
      {!active.length && <div className="admin-feedback admin-staff-form__wide" role="status">No active designations are available. <Link href="/admin/masters/designations">Manage designations</Link> before adding staff.</div>}
      {message && <div className="admin-feedback admin-feedback--error admin-staff-form__wide" role="alert" data-testid="status-staff-save-error">{message}</div>}
      {uncertain && <div className="admin-feedback admin-staff-form__wide">Do not repeat this submission. Close this form and refresh the directory to confirm whether it saved. A lost initial password cannot be retrieved.</div>}
      {conflicted && <div className="admin-staff-form__wide"><button type="button" className="admin-button admin-button--secondary" onClick={reviewCurrent}>Review current record</button>{current && <><dl>{STAFF_COLUMNS.map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{current[key]}</dd></div>)}</dl><p>Your draft remains above. To edit the current version, cancel and reopen the refreshed record; this form cannot overwrite it.</p></>}</div>}
    </form>
  </Dialog>;
}

function Credentials({ credentials, onClose }) {
  const [reveal, setReveal] = useState(false);
  const [message, setMessage] = useState('');
  async function copy() {
    try { await navigator.clipboard.writeText(`User ID: ${credentials.userId}\nInitial password: ${credentials.password}`); setMessage('Credentials copied for manual handoff. Clear the clipboard after use.'); }
    catch { setMessage('Clipboard unavailable. Reveal and copy the credentials manually.'); }
  }
  return <Dialog title="One-time staff credentials" eyebrow="Staff Management" description="Shown only now. Closing or leaving this page clears the password. Staff sign-in is unavailable and no invitation is sent." onClose={onClose}
    footer={<><button type="button" className="admin-button admin-button--secondary" onClick={onClose} data-testid="button-close-staff-credentials">Dismiss</button><button type="button" className="admin-button" onClick={copy} data-testid="button-copy-staff-credentials">Copy credentials</button></>}>
    <div className="admin-staff-form"><label className="admin-staff-field"><span>User ID</span><input value={credentials.userId} readOnly data-testid="text-staff-credential-id" /></label>
      <label className="admin-staff-field"><span>Initial password</span><input type={reveal ? 'text' : 'password'} value={credentials.password} readOnly autoComplete="off" data-testid="text-staff-credential-password" /></label>
      <button type="button" className="admin-button admin-button--secondary" onClick={() => setReveal(!reveal)} data-testid="button-reveal-staff-credentials">{reveal ? <EyeOff size={16} /> : <Eye size={16} />}{reveal ? 'Hide password' : 'Reveal password'}</button>
      {message && <p role="status">{message}</p>}
    </div>
  </Dialog>;
}

export default function StaffManagement() {
  useAdminPreferences();
  const [records, setRecords] = useState([]);
  const [designations, setDesignations] = useState([]);
  const [error, setError] = useState('');
  const [designationError, setDesignationError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [actionError, setActionError] = useState('');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(undefined);
  const [credentials, setCredentials] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [directoryTerm, setDirectoryTerm] = useState('');
  const [directory, setDirectory] = useState(null);
  const request = useRef(null);
  const mutationGate = useRef(false);
  const alive = useRef(true);
  const visible = useMemo(() => records.filter((record) => FIELDS.some((key) => String(record[key] ?? '').toLowerCase().includes(search.trim().toLowerCase()))), [records, search]);
  const pagination = useTablePagination(visible);
  const blocked = Boolean(error || loading || busy);

  async function refresh(nextOffset = offset, scope = directory) {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setError('');
    // Do not export or display stale results under a newly submitted scope.
    setRecords([]);
    setDirectory(scope);
    try {
      const page = scope
        ? await searchStaff(scope.query, scope.cursor, { signal: controller.signal })
        : await loadStaff(nextOffset, { signal: controller.signal });
      if (!alive.current || controller.signal.aborted) return;
      setRecords(page.items);
      setOffset(nextOffset);
      setHasMore(page.has_more);
      if (scope) setDirectory({ ...scope, nextCursor: page.next_cursor, scanned: page.scanned });
      pagination.resetPage();
    } catch (cause) {
      if (alive.current && !controller.signal.aborted) { setError(cause.message); setRecords([]); }
    } finally { if (alive.current && !controller.signal.aborted) setLoading(false); }
    try { setDesignations(loadDesignations()); setDesignationError(''); }
    catch (cause) { setDesignationError(cause.message); }
  }
  useEffect(() => {
    alive.current = true;
    void refresh(0);
    const unsubscribe = subscribeSession(() => {
      if (getSession().status !== 'authenticated') setCredentials(null);
      if (!getSession().user) { request.current?.abort(); setRecords([]); setDirectory(null); setDirectoryTerm(''); setSearch(''); setEditing(undefined); }
    });
    const updateDesignations = () => {
      try { setDesignations(loadDesignations()); setDesignationError(''); }
      catch (cause) { setDesignationError(cause.message); }
    };
    window.addEventListener('storage', updateDesignations);
    return () => { alive.current = false; request.current?.abort(); unsubscribe(); window.removeEventListener('storage', updateDesignations); };
  }, []);
  async function save(values, record) {
    if (mutationGate.current) return;
    mutationGate.current = true;
    setBusy(true);
    const guard = reportingIdentityGuard();
    try {
      const response = record ? await updateStaff(record, values) : await createStaff(values);
      guard();
      if (!alive.current) return;
      setEditing(undefined);
      setFeedback(record ? 'Staff member updated.' : 'Staff member created. Credentials are shown once.');
      if (!record) setCredentials({ userId: response.record.userId, password: response.initial_password });
      // The credentials remain visible even if the following list reload fails.
      void refresh(0, directory ? { query: directory.query, cursor: null, checked: 0 } : null);
    } finally { mutationGate.current = false; if (alive.current) setBusy(false); }
  }
  async function toggle(record) {
    if (mutationGate.current) return;
    mutationGate.current = true;
    setBusy(true);
    setActionError('');
    try {
      const next = await setStaffStatus(record, record.status === 'active' ? 'inactive' : 'active');
      if (alive.current) {
        if (directory) void refresh();
        else setRecords((previous) => previous.map((item) => item.id === next.id ? next : item));
      }
    } catch (cause) { if (alive.current) setActionError(cause.message); }
    finally { mutationGate.current = false; if (alive.current) setBusy(false); }
  }
  function beginDirectorySearch(event) {
    event.preventDefault();
    if (busy || loading || directoryTerm.trim().length < 2) return;
    setSearch('');
    void refresh(0, { query: directoryTerm.trim(), cursor: null, checked: 0 });
  }
  function clearDirectorySearch() {
    setDirectoryTerm('');
    setSearch('');
    void refresh(0, null);
  }
  async function edit(record) {
    setActionError('');
    setFeedback('');
    if (!record) { setEditing(null); return; }
    try { const latest = await getStaff(record.id); if (alive.current) setEditing(latest); }
    catch (cause) { if (alive.current) setActionError(cause.message); }
  }
  function exportRows() {
    try { reportingIdentityGuard()(); downloadCSV(exportStaffCSV(visible)); }
    catch (cause) { setActionError(cause.message); }
  }
  const rowActions = (record, mobile = false) => <button type="button" className="admin-icon-button" title={`Edit ${record.name}`} aria-label={`Edit ${record.name}`} disabled={blocked || Boolean(designationError)} onClick={() => edit(record)} data-testid={`button-edit-staff-${mobile ? 'mobile-' : ''}${record.id}`}><Pencil size={16} aria-hidden="true" /></button>;
  const columns = [
    { key: 'serial', label: 'Sr No.', render: (_, index) => <span className="admin-table__serial">{index + 1}</span> },
    { key: 'name', label: 'Name', render: (record) => <span className="admin-staff-identity"><strong data-testid={`text-staff-name-${record.id}`}>{record.name}</strong></span> },
    { key: 'phone', label: 'Phone No.', render: (record) => <StaffPhone record={record} /> },
    { key: 'userId', label: 'User ID', render: (record) => record.userId },
    { key: 'email', label: 'Email ID', render: (record) => <a href={`mailto:${record.email}`} className="admin-staff-link">{record.email}</a> },
    { key: 'role', label: 'Role', render: (record) => record.role },
    { key: 'dateOfJoining', label: 'Date of joining', render: (record) => formatAdminDate(record.dateOfJoining) },
    { key: 'designation', label: 'Designation', render: (record) => record.designation },
    { key: 'status', label: 'Status', render: (record) => <button type="button" role="switch" aria-checked={record.status === 'active'} aria-label={`${record.name}: ${record.status}. Change status`} className="admin-staff-status" disabled={blocked} onClick={() => toggle(record)} data-testid={`switch-staff-status-${record.id}`}><span className="admin-staff-status__track" aria-hidden="true" />{record.status === 'active' ? 'Active' : 'Inactive'}</button> },
    { key: 'created', label: 'Created details', render: (record) => audit(record.createdBy, record.createdAt) },
    { key: 'updated', label: 'Updated details', render: (record) => audit(record.updatedBy, record.updatedAt) },
    { key: 'actions', label: 'Actions', render: (record) => rowActions(record) },
  ];
  return <AdminLayout title="Staff Management">
    <div className="admin-page-head"><div><p className="admin-page-head__eyebrow">People / Directory</p><h1>Staff Management</h1><p className="admin-page-head__description">Server-backed staff directory. Directory status and business role labels do not grant sign-in or permissions.</p></div><div className="admin-staff-actions">
      <button type="button" className="admin-button admin-button--secondary" onClick={() => refresh()} disabled={busy || loading} data-testid="button-refresh-staff"><RefreshCw size={16} aria-hidden="true" /> Refresh records</button>
      <button type="button" className="admin-button admin-button--secondary" disabled title="CSV bulk account provisioning is unavailable in this phase." data-testid="button-import-staff"><Upload size={16} aria-hidden="true" /> Import unavailable</button>
      <button type="button" className="admin-button admin-button--secondary" onClick={exportRows} disabled={blocked || !visible.length} data-testid="button-export-staff"><Download size={16} aria-hidden="true" /> Export displayed records</button>
      <button type="button" className="admin-button" onClick={() => edit(null)} disabled={blocked || Boolean(designationError)} data-testid="button-add-staff"><Plus size={16} aria-hidden="true" /> Add staff</button>
    </div></div>
    <div className="admin-feedback">Legacy browser-local staff records are retained untouched but are not shown or imported. CSV import and email invitations are unavailable.</div>
    {feedback && <div className="admin-feedback" role="status">{feedback}</div>}
    {designationError && <div className="admin-feedback admin-feedback--error" role="alert">Designation choices could not be loaded: {designationError}. Retry loading before editing.</div>}
    {!designationError && !designations.some((item) => item.status === 'active') && <div className="admin-feedback" role="status">No active designations yet. <Link href="/admin/masters/designations">Add an active designation</Link> before creating staff.</div>}
    {actionError && <div className="admin-feedback admin-feedback--error" role="alert" data-testid="status-staff-action-error">{actionError}</div>}
    <section className="admin-panel" aria-label="Staff directory">
      <form className="admin-toolbar" onSubmit={beginDirectorySearch}>
        <div className="admin-toolbar__fields"><label className="admin-search"><Search size={16} aria-hidden="true" /><span className="sr-only">Search entire staff directory</span><input value={directoryTerm} onChange={(event) => setDirectoryTerm(event.target.value)} maxLength={200} minLength={2} autoComplete="off" placeholder="Search entire directory (at least 2 characters)" data-testid="input-directory-search-staff" aria-describedby="staff-directory-search-help" /></label></div>
        <button type="submit" className="admin-button" disabled={busy || loading || directoryTerm.trim().length < 2} data-testid="button-directory-search-staff">Search directory</button>
        {directory && <button type="button" className="admin-button admin-button--secondary" disabled={busy || loading} onClick={clearDirectorySearch} data-testid="button-clear-directory-search-staff">Back to directory batches</button>}
      </form>
      <p id="staff-directory-search-help" className="admin-feedback">Directory search checks name, local phone digits, user ID, email, country, role, designation, joining date and status (case-insensitive partial match). Each step checks up to 500 records and returns up to 100 matches. Continue until complete. Export covers only the loaded results, not the whole directory.</p>
      {directory && <div className="admin-feedback" role="status" data-testid="status-directory-search-staff">Directory search active: “{directory.query}”. {directory.checked + (directory.scanned || 0)} records checked. {loading ? 'Checking this section…' : error ? 'Search interrupted; retry this section.' : hasMore ? 'More records remain unchecked.' : 'Search complete.'} Results are not a snapshot; restart after directory changes.</div>}
      <div className="admin-toolbar"><div className="admin-toolbar__fields"><label className="admin-search"><Search size={16} aria-hidden="true" /><span className="sr-only">Search displayed staff</span><input value={search} onChange={(event) => { setSearch(event.target.value); pagination.resetPage(); }} placeholder="Filter only loaded records" data-testid="input-search-staff" /></label></div></div>
      {loading ? <div className="admin-empty" role="status">Loading staff records…</div> : error ? <div className="admin-empty" role="alert"><strong>Staff records could not be loaded</strong><p>{error}</p><button type="button" className="admin-button" onClick={() => refresh()} data-testid="button-retry-staff">Retry loading</button></div> : <>
        {visible.length ? <><div className="admin-staff-desktop"><DataTable columns={columns} rows={pagination.pageRows} rowOffset={pagination.startIndex} rowKey={(record) => record.id} label="Staff records" testIdPrefix="staff" /></div><div className="admin-staff-mobile" role="list" aria-label="Staff records">{pagination.pageRows.map((record, index) => <article className="admin-staff-card" role="listitem" key={record.id} data-testid={`card-staff-${record.id}`}><div className="admin-staff-card__head"><div><small>#{pagination.startIndex + index + 1} · {record.userId}</small><h2>{record.name}</h2></div></div><dl className="admin-staff-card__meta">{['phone', 'userId', 'email', 'role', 'dateOfJoining', 'designation', 'status'].map((key) => <div key={key}><dt>{LABELS[key]}</dt><dd>{key === 'phone' ? <StaffPhone record={record} mobile /> : key === 'dateOfJoining' ? formatAdminDate(record.dateOfJoining) : record[key]}</dd></div>)}<div><dt>Created details</dt><dd>{audit(record.createdBy, record.createdAt)}</dd></div><div><dt>Updated details</dt><dd>{audit(record.updatedBy, record.updatedAt)}</dd></div></dl><div className="admin-staff-card__actions">{rowActions(record, true)}<button type="button" role="switch" aria-checked={record.status === 'active'} className="admin-staff-status" disabled={blocked} onClick={() => toggle(record)} data-testid={`switch-staff-mobile-status-${record.id}`}><span className="admin-staff-status__track" aria-hidden="true" />{record.status === 'active' ? 'Active' : 'Inactive'}</button></div></article>)}</div></> : <div className="admin-empty" data-testid="status-staff-empty"><span className="admin-empty__icon"><UsersRound size={21} aria-hidden="true" /></span><strong>{directory ? (records.length ? 'No matches in the loaded results filter' : hasMore ? 'No matches in this section' : 'No matches in this final section') : records.length ? 'No matching staff members' : 'No staff members yet'}</strong><p>{directory ? (hasMore ? 'Continue search to check the remaining directory.' : 'Search complete. Earlier sections may contain matches; restart to review them or try another term.') : records.length ? 'Try a different search term.' : 'Add a staff member to begin the server-backed directory.'}</p></div>}
        <TablePagination {...pagination} filtered={visible.length} total={records.length} label="staff members in loaded batch" onPageChange={pagination.setPage} onPageSizeChange={pagination.setPageSize} testId="text-staff-count" />
        {directory ? <div className="admin-staff-actions"><button type="button" className="admin-button admin-button--secondary" disabled={blocked} onClick={() => refresh(0, { query: directory.query, cursor: null, checked: 0 })} data-testid="button-restart-directory-search-staff">Restart search</button>
          <button type="button" className="admin-button admin-button--secondary" disabled={blocked || !directory.history?.length} onClick={() => { setSearch(''); const history = directory.history; void refresh(0, { query: directory.query, ...history.at(-1), history: history.slice(0, -1) }); }} data-testid="button-previous-directory-search-staff">Previous search section</button>
          <span>{records.length} matches loaded in this section; filter and export cover this section only.</span><button type="button" className="admin-button admin-button--secondary" disabled={blocked || !hasMore} onClick={() => { setSearch(''); void refresh(0, { query: directory.query, cursor: directory.nextCursor, checked: directory.checked + directory.scanned, history: [...(directory.history || []), { cursor: directory.cursor, checked: directory.checked }] }); }} data-testid="button-continue-directory-search-staff">Continue search</button></div>
          : <div className="admin-staff-actions"><button type="button" className="admin-button admin-button--secondary" disabled={blocked || !offset} onClick={() => refresh(Math.max(0, offset - 100))}>Previous batch</button><span>Server records {records.length ? offset + 1 : 0}–{offset + records.length}; filter and export cover this batch. Use directory search to find other records.</span><button type="button" className="admin-button admin-button--secondary" disabled={blocked || !hasMore || offset >= 10000} onClick={() => refresh(offset + 100)}>Next batch</button></div>}
      </>}
    </section>
    {editing !== undefined && <StaffForm key={editing?.id || 'new'} record={editing} designations={designations} onSave={save} onClose={() => setEditing(undefined)} />}
    {credentials && <Credentials credentials={credentials} onClose={() => setCredentials(null)} />}
  </AdminLayout>;
}
