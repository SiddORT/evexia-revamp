import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'wouter';
import { Download, Eye, EyeOff, Mail, Pencil, Plus, RefreshCw, Search, Upload, UsersRound } from 'lucide-react';
import AdminLayout from '../../components/admin/AdminLayout.jsx';
import { formatAdminDate, formatAdminTimestamp, useAdminPreferences } from '../../components/admin/adminPreferences.js';
import DataTable from '../../components/admin/DataTable.jsx';
import Dialog from '../../components/admin/Dialog.jsx';
import TablePagination from '../../components/admin/TablePagination.jsx';
import useTablePagination from '../../hooks/useTablePagination.js';
import { loadDesignations } from '../../services/designations.js';
import { STAFF_COLUMNS, STAFF_ROLES, loadStaff, validateStaff, createStaff, updateStaff, setStaffStatus, staffCSVTemplate, exportStaffCSV, reviewStaffCSV, importStaff, staffInvitationPreview } from '../../services/staff.js';
import '../../staff.css';

const FIELDS = ['name', 'phone', 'userId', 'email', 'status', 'role', 'designation', 'dateOfJoining'];
const LABELS = { ...Object.fromEntries(STAFF_COLUMNS.map(([key, label]) => [key, label])), name: 'Name', phone: 'Phone No.', userId: 'User ID', email: 'Email ID', status: 'Status', role: 'Role', designation: 'Designation', dateOfJoining: 'Date of joining' };
const INITIAL = { name: '', phone: '', userId: '', email: '', status: 'active', role: 'Staff', designation: '', dateOfJoining: '' };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const isSample = (record) => /^sample[-_]/i.test(String(record.id));
const safeFields = (values) => Object.fromEntries(FIELDS.map((key) => [key, values[key] ?? '']));

function downloadCSV(text, filename) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function audit(by, at) {
  return <span className="admin-staff-audit"><strong>{by || '—'}</strong><time dateTime={at}>{formatAdminTimestamp(at)}</time></span>;
}

function securePassword() {
  if (!globalThis.crypto?.getRandomValues) throw new Error('Secure password generation is unavailable in this browser. Enter a password manually instead.');
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const bytes = new Uint8Array(22);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => alphabet[byte & 63]).join('');
}

function StaffForm({ record, records, designations, stale, onSave, onClose }) {
  const [values, setValues] = useState(() => record ? safeFields(record) : { ...INITIAL });
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState({});
  const [attempted, setAttempted] = useState(false);
  const [message, setMessage] = useState('');
  const active = designations.filter((item) => item.status === 'active');
  const selected = record?.designation;
  const inactiveExisting = selected && !active.some((item) => item.name === selected);
  function change(key, value) {
    const next = { ...values, [key]: value };
    setValues(next);
    setMessage('');
    if (attempted) {
      try {
        const issues = validateStaff(next, records, record?.id, designations).errors || {};
        if (!next.designation && !issues.designation) issues.designation = 'Choose an active designation.';
        setErrors(issues);
      }
      catch (cause) { setMessage(cause.message || 'Staff details could not be checked.'); }
    }
  }
  function save(event) {
    event.preventDefault();
    setAttempted(true);
    setMessage('');
    if (stale) { setMessage('Records changed in another tab. Refresh records before saving.'); return; }
    try {
      const result = validateStaff(safeFields(values), records, record?.id, designations);
      const issues = result.errors || {};
      if (!values.designation && !issues.designation) issues.designation = 'Choose an active designation.';
      setErrors(issues);
      if (Object.keys(issues).length) return;
      // Password is intentionally transient. Neither the service nor browser storage ever receives it.
      const outcome = onSave(safeFields(result.fields || values), record?.id);
      if (!outcome.success) setMessage(outcome.error || 'Staff member could not be saved. Your draft is still here.');
      else setPassword('');
    } catch (cause) { setMessage(cause.message || 'Staff member could not be saved. Your draft is still here.'); }
  }
  return <Dialog title={record ? 'Edit staff member' : 'Add staff member'} eyebrow="Staff Management" description="Manage directory details in this browser. This form does not create a sign-in account." onClose={onClose} className="admin-import-dialog"
    footer={<><button type="button" className="admin-button admin-button--secondary" onClick={onClose} data-testid="button-cancel-staff">Cancel</button><button type="submit" form="staff-management-form" className="admin-button" disabled={stale} data-testid="button-save-staff">{record ? 'Save changes' : 'Add staff member'}</button></>}>
    <form id="staff-management-form" className="admin-staff-form" onSubmit={save} noValidate>
      {['name', 'phone', 'userId', 'email'].map((key) => <label key={key} className="admin-staff-field"><span>{LABELS[key]} <span aria-hidden="true">*</span></span><input type={key === 'email' ? 'email' : key === 'phone' ? 'tel' : 'text'} autoComplete={key === 'name' ? 'name' : key === 'email' ? 'email' : key === 'phone' ? 'tel' : 'off'} value={values[key]} onChange={(event) => change(key, event.target.value)} aria-required="true" aria-invalid={Boolean(errors[key])} aria-describedby={errors[key] ? `staff-error-${key}` : undefined} data-testid={`input-staff-${key}`} />{errors[key] && <span id={`staff-error-${key}`} className="admin-staff-field__error" role="alert">{errors[key]}</span>}</label>)}
      <label className="admin-staff-field"><span>Status <span aria-hidden="true">*</span></span><select value={values.status} onChange={(event) => change('status', event.target.value)} aria-required="true" aria-invalid={Boolean(errors.status)} data-testid="select-staff-status"><option value="active">Active</option><option value="inactive">Inactive</option></select>{errors.status && <span className="admin-staff-field__error" role="alert">{errors.status}</span>}</label>
      <label className="admin-staff-field"><span>Role <span aria-hidden="true">*</span></span><select value={values.role} onChange={(event) => change('role', event.target.value)} aria-required="true" aria-invalid={Boolean(errors.role)} data-testid="select-staff-role">{!STAFF_ROLES.includes(values.role) && <option value={values.role}>{values.role || 'Select a role'}</option>}{STAFF_ROLES.map((role) => <option key={role} value={role}>{role}</option>)}</select>{errors.role && <span className="admin-staff-field__error" role="alert">{errors.role}</span>}</label>
      <label className="admin-staff-field"><span>Designation <span aria-hidden="true">*</span></span><select value={values.designation} onChange={(event) => change('designation', event.target.value)} aria-required="true" aria-invalid={Boolean(errors.designation)} data-testid="select-staff-designation"><option value="">Select a designation</option>{inactiveExisting && <option value={selected}>{selected} (inactive or no longer available)</option>}{active.map((item) => <option key={item.id} value={item.name}>{item.name}</option>)}</select>{errors.designation && <span className="admin-staff-field__error" role="alert">{errors.designation}</span>}</label>
      <label className="admin-staff-field"><span>Date of joining <span aria-hidden="true">*</span></span><input type="date" value={values.dateOfJoining} onChange={(event) => change('dateOfJoining', event.target.value)} aria-required="true" aria-invalid={Boolean(errors.dateOfJoining)} data-testid="input-staff-dateOfJoining" />{errors.dateOfJoining && <span className="admin-staff-field__error" role="alert">{errors.dateOfJoining}</span>}</label>
      <div className="admin-staff-field admin-staff-form__wide"><label htmlFor="staff-transient-password">Password (optional, preview only)</label><div className="admin-staff-field__inline"><input id="staff-transient-password" type={showPassword ? 'text' : 'password'} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} data-testid="input-staff-password" /><button type="button" onClick={() => setShowPassword((current) => !current)} aria-label={showPassword ? 'Hide password' : 'Show password'} data-testid="button-toggle-staff-password">{showPassword ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}</button><button type="button" onClick={() => { try { setPassword(securePassword()); setShowPassword(true); setMessage(''); } catch (cause) { setMessage(cause.message); } }} data-testid="button-generate-staff-password">Generate securely</button></div><span className="admin-staff-field__hint">This password is not saved, sent, or usable to sign in. It disappears when you close this form.</span></div>
      {!active.length && <div className="admin-feedback admin-staff-form__wide" role="status">No active designations are available. <Link href="/admin/masters/designations" data-testid="link-staff-designations">Manage designations</Link> before adding staff.</div>}
      {errors.form && <div className="admin-feedback admin-feedback--error admin-staff-form__wide" role="alert">{errors.form}</div>}
      {message && <div className="admin-feedback admin-feedback--error admin-staff-form__wide" role="alert" data-testid="status-staff-save-error">{message}</div>}
      {stale && <div className="admin-feedback admin-feedback--error admin-staff-form__wide" role="alert">Records changed in another tab. Cancel and refresh to continue.</div>}
    </form>
  </Dialog>;
}

function StaffImport({ records, designations, stale, onImport, onClose }) {
  const [review, setReview] = useState(null);
  const [message, setMessage] = useState('');
  const [reading, setReading] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const sequence = useRef(0);
  const invalid = review?.entries.filter((entry) => entry.errors?.length || !entry.fields) || [];
  const valid = review ? review.entries.length - invalid.length : 0;
  const alreadyPresent = review?.entries.filter((entry) => entry.skipSample && !entry.errors?.length).length || 0;
  const newRows = valid - alreadyPresent;
  function close() { sequence.current += 1; onClose(); }
  async function choose(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    setReview(null);
    setConfirmed(false);
    setMessage('');
    if (!file) return;
    if (!/\.csv$/i.test(file.name) || !file.size || file.size > 2_000_000) { setMessage('Choose a non-empty .csv file smaller than 2 MB.'); return; }
    const current = ++sequence.current;
    setReading(true);
    try {
      const text = await file.text();
      if (current !== sequence.current) return;
      const snapshot = loadStaff();
      const designationSnapshot = loadDesignations();
      if (!same(snapshot, records) || !same(designationSnapshot, designations)) throw new Error('Staff or designations changed in another tab. Refresh records before reviewing this file.');
      const entries = reviewStaffCSV(text, snapshot, designationSnapshot);
      if (current === sequence.current) setReview({ fileName: file.name, entries, snapshot, designationSnapshot });
    } catch (cause) { if (current === sequence.current) setMessage(cause.message || 'Could not review this CSV file.'); }
    finally { if (current === sequence.current) setReading(false); }
  }
  function confirm() {
    if (!review || !valid || invalid.length || reading || stale || !confirmed) return;
    setMessage('');
    const result = onImport(review.entries, review.snapshot, review.designationSnapshot);
    if (result.success) close();
    else setMessage(result.error || 'Import failed. No staff members were saved.');
  }
  return <Dialog title="Import staff" eyebrow="Staff Management" description="Review each row before confirming. The entire file is imported together, or nothing is saved." onClose={close} className="admin-import-dialog"
    footer={<><button type="button" className="admin-button admin-button--secondary" onClick={close} data-testid="button-cancel-staff-import">Cancel</button><button type="button" className="admin-button" onClick={confirm} disabled={!valid || Boolean(invalid.length) || reading || stale || !confirmed} data-testid="button-confirm-staff-import">Import {newRows} new {newRows === 1 ? 'member' : 'members'}</button></>}>
    <div className="admin-staff-import">
      <div className="admin-staff-import__guide"><strong>CSV columns in this order</strong><p>{STAFF_COLUMNS.map(([, label]) => label).join(', ')}. Audit details and passwords are never imported.</p></div>
      <button type="button" className="admin-button admin-button--secondary" onClick={() => { try { downloadCSV(staffCSVTemplate(), 'evexia-staff-template.csv'); setMessage(''); } catch { setMessage('The CSV template could not be downloaded.'); } }} data-testid="button-staff-import-template"><Download size={16} aria-hidden="true" /> Download template</button>
      <label className="admin-staff-import__file">Choose a local CSV file (maximum 2 MB)<input type="file" accept=".csv,text/csv" onChange={choose} disabled={stale || reading} data-testid="input-staff-import" /></label>
      {reading && <p role="status">Reading CSV file…</p>}
      {stale && <div className="admin-feedback admin-feedback--error" role="alert">Records changed in another tab. Close and refresh before importing.</div>}
      {message && <div className="admin-feedback admin-feedback--error" role="alert" data-testid="status-staff-import-error">{message}</div>}
      {review && <div aria-live="polite" data-testid="status-staff-import-review"><p><strong>{review.fileName}</strong> — {newRows} new, {alreadyPresent} unchanged sample {alreadyPresent === 1 ? 'record' : 'records'} already present, {invalid.length} with errors. {invalid.length ? 'Correct the file and choose it again; nothing was saved.' : valid ? 'Ready to review as one batch. Existing samples will not be replaced.' : 'There are no staff rows to import.'}</p>
        <div className="admin-staff-import__rows" role="list" aria-label="Reviewed staff rows">{review.entries.map((entry, index) => <div key={`${entry.line}-${index}`} role="listitem" className={`admin-staff-import__row${entry.errors?.length || !entry.fields ? ' admin-staff-import__row--error' : ''}`} data-testid={`row-staff-import-${entry.line}`}><details><summary>Line {entry.line}: {entry.values?.name || entry.fields?.name || '(unnamed)'} — {entry.errors?.length ? `${entry.errors.length} ${entry.errors.length === 1 ? 'error' : 'errors'}` : entry.skipSample ? 'Already present (unchanged sample; skipped)' : entry.fields ? 'Ready to add' : 'Invalid row'}</summary><dl>{STAFF_COLUMNS.map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{entry.values?.[key] ?? entry.fields?.[key] ?? '—'}</dd></div>)}</dl></details>{entry.errors?.length > 0 && <ul>{entry.errors.map((problem, i) => <li key={i}>{problem}</li>)}</ul>}</div>)}</div>
        {!invalid.length && valid > 0 && <label className="admin-staff-import__confirm"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} data-testid="checkbox-confirm-staff-import" /> I reviewed every row. Only new staff will be added; unchanged samples will be skipped.</label>}
      </div>}
    </div>
  </Dialog>;
}

function InvitationPreview({ record, onClose }) {
  const [message, setMessage] = useState('');
  const { recipient, email, copy, confirmation } = staffInvitationPreview(record);
  async function copyText() {
    try { await navigator.clipboard.writeText(copy); setMessage(`Invitation preview copied. ${confirmation}`); }
    catch { setMessage(`Clipboard access is unavailable. Select and copy the preview text manually. ${confirmation}`); }
  }
  return <Dialog title="Invitation preview" eyebrow="Staff Management" description="Preview only — this directory does not send invitations or create sign-in accounts." onClose={onClose} className="admin-import-dialog" footer={<><button type="button" className="admin-button admin-button--secondary" onClick={onClose} data-testid="button-close-staff-invitation">Close</button><button type="button" className="admin-button" onClick={copyText} data-testid="button-copy-staff-invitation">Copy invitation text</button></>}>
    <div className="admin-staff-invite"><div className="admin-staff-invite__recipient"><strong>To: {recipient}</strong><span>{email}</span></div><pre className="admin-staff-invite__copy" data-testid="text-staff-invitation">{copy}</pre><div className="admin-feedback" role="status" data-testid="status-staff-invitation">{confirmation}</div>{message && <div className="admin-feedback" role="status">{message}</div>}</div>
  </Dialog>;
}

export default function StaffManagement() {
  useAdminPreferences();
  const [records, setRecords] = useState([]);
  const [designations, setDesignations] = useState([]);
  const [error, setError] = useState('');
  const [designationError, setDesignationError] = useState('');
  const [stale, setStale] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [actionError, setActionError] = useState('');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(undefined);
  const [importing, setImporting] = useState(false);
  const [inviting, setInviting] = useState(null);
  const visible = useMemo(() => records.filter((record) => FIELDS.some((key) => String(record[key] ?? '').toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))), [records, search]);
  const pagination = useTablePagination(visible);
  const blocked = Boolean(error || designationError || stale);

  function refresh() {
    let staff = null;
    let designationRecords = null;
    let staffError = '';
    let masterError = '';
    try { staff = loadStaff(); } catch (cause) { staffError = cause.message || 'Staff records could not be loaded.'; }
    try { designationRecords = loadDesignations(); } catch (cause) { masterError = cause.message || 'Designation records could not be loaded.'; }
    setRecords(staff || []);
    setDesignations(designationRecords || []);
    setError(staffError);
    setDesignationError(masterError);
    setStale(Boolean(staffError || masterError));
    setActionError('');
    setFeedback('');
    setEditing(undefined);
    setImporting(false);
    setInviting(null);
  }
  useEffect(() => { refresh(); }, []);
  useEffect(() => {
    function onStorage() {
      try { if (!same(loadStaff(), records) || !same(loadDesignations(), designations)) { setStale(true); setFeedback(''); } }
      catch { setStale(true); setFeedback(''); }
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [records, designations]);

  function guard(expected = records, expectedDesignations = designations) {
    if (blocked) { setStale(true); return false; }
    try {
      if (!same(records, expected) || !same(designations, expectedDesignations) || !same(loadStaff(), expected) || !same(loadDesignations(), expectedDesignations)) {
        setStale(true);
        setFeedback('');
        setActionError('Staff or designations changed in another tab. Refresh records before continuing.');
        return false;
      }
      return true;
    } catch (cause) {
      setStale(true);
      setActionError(cause.message || 'Could not verify saved records. Refresh records before continuing.');
      return false;
    }
  }
  function mutation(operation, success) {
    if (!guard()) return { success: false, error: 'Records changed. Refresh records before continuing.' };
    try {
      const next = operation();
      setRecords(next);
      setActionError('');
      setFeedback(success);
      return { success: true };
    } catch (cause) {
      const message = cause.message || 'The change could not be saved.';
      if (/chang|snapshot|refresh|conflict/i.test(message)) setStale(true);
      return { success: false, error: message };
    }
  }
  function save(values, id) {
    const result = mutation(() => id ? updateStaff(records, id, safeFields(values), designations) : createStaff(records, safeFields(values), designations), id ? 'Staff member updated.' : 'Staff member added.');
    if (result.success) setEditing(undefined);
    return result;
  }
  function toggle(record) {
    const status = record.status === 'active' ? 'inactive' : 'active';
    const result = mutation(() => setStaffStatus(records, record.id, status), `${record.name} is now ${status}. This does not change account access.`);
    if (!result.success) setActionError(result.error);
  }
  function importRows(entries, expected, expectedDesignations) {
    if (!guard(expected, expectedDesignations)) return { success: false, error: 'Records changed. Refresh and review the CSV again.' };
    if (!entries.length || entries.some((entry) => entry.errors?.length || !entry.fields)) return { success: false, error: 'Every row must be valid before importing. Nothing was saved.' };
    try {
      const next = importStaff(entries, expected, expectedDesignations);
      setRecords(next);
      const added = entries.filter((entry) => !entry.skipSample).length;
      const skipped = entries.length - added;
      setFeedback(`${added} new ${added === 1 ? 'staff member' : 'staff members'} imported.${skipped ? ` ${skipped} unchanged sample ${skipped === 1 ? 'record was' : 'records were'} already present and skipped.` : ''}`);
      setActionError('');
      return { success: true };
    } catch (cause) {
      const message = cause.message || 'Import failed. No staff members were saved.';
      if (/chang|snapshot|refresh|conflict/i.test(message)) setStale(true);
      return { success: false, error: message };
    }
  }
  function exportRows() {
    if (!guard() || !visible.length) return;
    try { downloadCSV(exportStaffCSV(visible), 'evexia-staff.csv'); setActionError(''); }
    catch (cause) { setActionError(cause.message || 'CSV export failed. Please try again.'); }
  }
  function template() {
    try { downloadCSV(staffCSVTemplate(), 'evexia-staff-template.csv'); setActionError(''); }
    catch (cause) { setActionError(cause.message || 'The CSV template could not be downloaded.'); }
  }
  function edit(record) { setEditing(record); setActionError(''); setFeedback(''); }
  const rowActions = (record) => <div className="admin-staff-row-actions"><button type="button" className="admin-icon-button" title={`Edit ${record.name}`} aria-label={`Edit ${record.name}`} disabled={blocked} onClick={() => edit(record)} data-testid={`button-edit-staff-${record.id}`}><Pencil size={16} aria-hidden="true" /></button><button type="button" className="admin-icon-button" title={`Preview invitation for ${record.name}`} aria-label={`Preview invitation for ${record.name}`} onClick={() => setInviting(record)} data-testid={`button-invite-staff-${record.id}`}><Mail size={16} aria-hidden="true" /></button></div>;
  const columns = [
    { key: 'serial', label: 'Sr No.', render: (_, index) => <span className="admin-table__serial">{index + 1}</span> },
    { key: 'name', label: 'Name', render: (record) => <span className="admin-staff-identity"><strong data-testid={`text-staff-name-${record.id}`}>{record.name}</strong>{isSample(record) && <span className="admin-staff-sample">Sample record</span>}</span> },
    { key: 'phone', label: 'Phone No.', render: (record) => <a href={`tel:${record.phone}`} className="admin-staff-link" data-testid={`link-staff-phone-${record.id}`}>{record.phone}</a> },
    { key: 'userId', label: 'User ID', render: (record) => record.userId },
    { key: 'email', label: 'Email ID', render: (record) => <a href={`mailto:${record.email}`} className="admin-staff-link" data-testid={`link-staff-email-${record.id}`}>{record.email}</a> },
    { key: 'role', label: 'Role', render: (record) => record.role },
    { key: 'dateOfJoining', label: 'Date of joining', render: (record) => formatAdminDate(record.dateOfJoining) },
    { key: 'designation', label: 'Designation', render: (record) => record.designation || 'Not assigned' },
    { key: 'status', label: 'Status', render: (record) => <button type="button" role="switch" aria-checked={record.status === 'active'} aria-label={`${record.name}: ${record.status}. Change to ${record.status === 'active' ? 'inactive' : 'active'}`} className="admin-staff-status" disabled={blocked} onClick={() => toggle(record)} data-testid={`switch-staff-status-${record.id}`}><span className="admin-staff-status__track" aria-hidden="true" />{record.status === 'active' ? 'Active' : 'Inactive'}</button> },
    { key: 'created', label: 'Created details', render: (record) => audit(record.createdBy, record.createdAt) },
    { key: 'updated', label: 'Updated details', render: (record) => audit(record.updatedBy, record.updatedAt) },
    { key: 'actions', label: 'Actions', render: rowActions },
  ];
  return <AdminLayout title="Staff Management">
    <div className="admin-page-head"><div><p className="admin-page-head__eyebrow">People / Directory</p><h1>Staff Management</h1><p className="admin-page-head__description">Keep staff identities, roles, and joining details in this browser. Directory status is not account access.</p></div><div className="admin-staff-actions">
      <button type="button" className="admin-button admin-button--secondary" onClick={refresh} data-testid="button-refresh-staff"><RefreshCw size={16} aria-hidden="true" /> Refresh records</button>
      <button type="button" className="admin-button admin-button--secondary" onClick={template} data-testid="button-download-staff-template"><Download size={16} aria-hidden="true" /> CSV template</button>
      <button type="button" className="admin-button admin-button--secondary" onClick={() => { setImporting(true); setActionError(''); }} disabled={blocked} data-testid="button-import-staff"><Upload size={16} aria-hidden="true" /> Import data</button>
      <button type="button" className="admin-button admin-button--secondary" onClick={exportRows} disabled={blocked || !visible.length} data-testid="button-export-staff"><Download size={16} aria-hidden="true" /> Export data</button>
      <button type="button" className="admin-button" onClick={() => edit(null)} disabled={blocked} data-testid="button-add-staff"><Plus size={16} aria-hidden="true" /> Add staff</button>
    </div></div>
    {feedback && <div className="admin-feedback" role="status" data-testid="status-staff-feedback">{feedback}</div>}
    {designationError && <div className="admin-feedback admin-feedback--error" role="alert" data-testid="status-staff-designations-error">Designation records are unavailable: {designationError} Staff changes and imports are disabled. <Link href="/admin/masters/designations" data-testid="link-staff-designations-error">Open Designation Master</Link> or retry loading.</div>}
    {!designationError && !designations.some((item) => item.status === 'active') && !error && <div className="admin-feedback" role="status" data-testid="status-staff-no-designations">No active designations yet. <Link href="/admin/masters/designations" data-testid="link-staff-designations-empty">Add an active designation</Link> before creating staff members.</div>}
    {stale && !error && !designationError && <div className="admin-feedback admin-feedback--error" role="alert" data-testid="status-staff-stale">Staff or designation records changed in another tab. Refresh records before making changes.</div>}
    {actionError && <div className="admin-feedback admin-feedback--error" role="alert" data-testid="status-staff-action-error">{actionError}</div>}
    <section className="admin-panel" aria-label="Staff directory"><div className="admin-toolbar"><div className="admin-toolbar__fields"><label className="admin-search"><Search size={16} aria-hidden="true" /><span className="sr-only">Search staff</span><input value={search} onChange={(event) => { setSearch(event.target.value); pagination.resetPage(); }} placeholder="Search name, phone, user ID, email, role or designation" data-testid="input-search-staff" /></label></div></div>
      {error ? <div className="admin-empty" role="alert"><span className="admin-empty__icon"><UsersRound size={21} aria-hidden="true" /></span><strong>Staff records could not be loaded</strong><p>{error}</p><button type="button" className="admin-button" onClick={refresh} data-testid="button-retry-staff">Retry loading</button></div> : <>
        {visible.length ? <><div className="admin-staff-desktop"><DataTable columns={columns} rows={pagination.pageRows} rowOffset={pagination.startIndex} rowKey={(record) => record.id} label="Staff records" testIdPrefix="staff" /></div><div className="admin-staff-mobile" role="list" aria-label="Staff records">{pagination.pageRows.map((record, index) => <article className="admin-staff-card" role="listitem" key={record.id} data-testid={`card-staff-${record.id}`}><div className="admin-staff-card__head"><div><small>#{pagination.startIndex + index + 1} · {record.userId}</small><h2>{record.name}</h2>{isSample(record) && <span className="admin-staff-sample">Sample record</span>}</div><button type="button" role="switch" aria-checked={record.status === 'active'} aria-label={`${record.name}: ${record.status}. Change status`} className="admin-staff-status" disabled={blocked} onClick={() => toggle(record)} data-testid={`switch-staff-mobile-status-${record.id}`}><span className="admin-staff-status__track" aria-hidden="true" />{record.status === 'active' ? 'Active' : 'Inactive'}</button></div><dl className="admin-staff-card__meta">{['phone', 'userId', 'email', 'role', 'dateOfJoining', 'designation', 'status'].map((key) => <div key={key}><dt>{LABELS[key]}</dt><dd>{key === 'phone' ? <a className="admin-staff-link" href={`tel:${record.phone}`} data-testid={`link-staff-mobile-phone-${record.id}`}>{record.phone}</a> : key === 'email' ? <a className="admin-staff-link" href={`mailto:${record.email}`} data-testid={`link-staff-mobile-email-${record.id}`}>{record.email}</a> : key === 'dateOfJoining' ? formatAdminDate(record.dateOfJoining) : record[key] || 'Not assigned'}</dd></div>)}<div><dt>Created details</dt><dd>{audit(record.createdBy, record.createdAt)}</dd></div><div><dt>Updated details</dt><dd>{audit(record.updatedBy, record.updatedAt)}</dd></div></dl><div className="admin-staff-card__actions"><button type="button" className="admin-button admin-button--secondary" onClick={() => edit(record)} disabled={blocked} data-testid={`button-edit-staff-mobile-${record.id}`}><Pencil size={15} aria-hidden="true" /> Edit</button><button type="button" className="admin-button admin-button--secondary" onClick={() => setInviting(record)} data-testid={`button-invite-staff-mobile-${record.id}`}><Mail size={15} aria-hidden="true" /> Invitation preview</button></div></article>)}</div></> : <div className="admin-empty" data-testid="status-staff-empty"><span className="admin-empty__icon"><UsersRound size={21} aria-hidden="true" /></span><strong>{records.length ? 'No matching staff members' : 'No staff members yet'}</strong><p>{records.length ? 'Try a different search term.' : 'Add a staff member or import a CSV to begin this browser-local directory.'}</p></div>}
        <TablePagination {...pagination} filtered={visible.length} total={records.length} label={visible.length === 1 ? 'staff member' : 'staff members'} onPageChange={pagination.setPage} onPageSizeChange={pagination.setPageSize} testId="text-staff-count" />
      </>}
    </section>
    {editing !== undefined && <StaffForm key={editing?.id || 'new'} record={editing} records={records} designations={designations} stale={blocked} onSave={save} onClose={() => setEditing(undefined)} />}
    {importing && <StaffImport records={records} designations={designations} stale={blocked} onImport={importRows} onClose={() => setImporting(false)} />}
    {inviting && <InvitationPreview record={inviting} onClose={() => setInviting(null)} />}
  </AdminLayout>;
}