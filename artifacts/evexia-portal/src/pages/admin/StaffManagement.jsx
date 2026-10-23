import { downloadCSV as loggedCSV } from '../../services/downloads.js';
import { captureExportPreferences } from '../../services/exportPreferences.js';
import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Download, Eye, Filter, KeyRound, EyeOff, Pencil, Plus, RefreshCw, Search, Trash2, Upload, UsersRound } from 'lucide-react';
import AdminLayout from '../../components/admin/AdminLayout.jsx';
import { formatAdminDate, formatAdminTimestamp, useAdminPreferences } from '../../components/admin/adminPreferences.js';
import DataTable from '../../components/admin/DataTable.jsx';
import MasterFilterReset from '../../components/admin/MasterFilterReset.jsx';
import StaffAccessDialog from '../../components/admin/StaffAccessDialog.jsx';
import Dialog from '../../components/admin/Dialog.jsx';
import PhoneInput from '../../components/admin/PhoneInput.jsx';
import RemoteSelect from '../../components/admin/RemoteSelect.jsx';
import { internationalPhone } from '../../services/phoneCountries.js';
import TablePagination from '../../components/admin/TablePagination.jsx';
import useTablePagination from '../../hooks/useTablePagination.js';
import { staffDesignationPage } from '../../services/serverDesignations.js';
import { getSession, subscribeSession, reportingIdentityGuard } from '../../auth/adminSession.js';
import { STAFF_COLUMNS, loadStaff, searchStaff, staffDesignationChoices, staffRoleChoices, getStaff, validateStaff, createStaff, updateStaff, setStaffStatus, deleteStaff, exportStaffCSV } from '../../services/staff.js';
import '../../staff.css';
import '../../mr.css';
import { initialCredentials } from '../../services/initialCredentials.js';
import { validateReset } from '../../services/passwordRecovery.js';
import InviteAccountButton from '../../components/admin/InviteAccountButton.jsx';

const FIELDS = ['name', 'phone', 'dialCountry', 'employeeCode', 'email', 'status', 'role', 'designation_id', 'dateOfJoining'];
const LABELS = Object.fromEntries(STAFF_COLUMNS);
const INITIAL = { name: '', phone: '', dialCountry: 'IN', employeeCode: '', email: '', status: 'active', role: '', designation_id: '', dateOfJoining: '' };
const safeFields = (values) => Object.fromEntries(FIELDS.map((key) => [key, values[key] ?? '']));
const EMPTY_FILTERS = { status: '', designation_id: '', role: '' };
const roleFilterPage = (query, offset, signal, cursor) => staffRoleChoices(query, offset, signal, cursor, true);

function downloadCSV(text) {
  return loggedCSV(text, 'evexia-staff.csv', 'staff');
}

function audit(by, at) {
  return <span className="admin-staff-audit"><strong title={by}>Verified Super Admin</strong><time dateTime={at}>{formatAdminTimestamp(at)}</time></span>;
}

function StaffPhone({ record, mobile = false }) {
  return <a className="admin-staff-link" href={`tel:${internationalPhone(record)}`} data-testid={`link-staff-${mobile ? 'mobile-phone' : 'phone'}-${record.id}`}>{internationalPhone(record)}</a>;
}

function StaffForm({ record, onSave, onClose }) {
  const [credentials, setCredentials] = useState(() => ({ password: '', confirmPassword: '', generationError: '' }));
  const [visible, setVisible] = useState(false);
  const [values, setValues] = useState(() => record ? safeFields(record) : { ...INITIAL });
  const [roleChoice, setRoleChoice] = useState(() => record ? { value: record.role, label: record.role } : null);
  const [designationChoice, setDesignationChoice] = useState(() => record ? { value: record.designation_id, label: record.designationName } : null);
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [conflicted, setConflicted] = useState(false);
  const [current, setCurrent] = useState(null);
  const gate = useRef(false);
  const formRef = useRef(null);
  function change(key, value) {
    setValues((previous) => ({ ...previous, [key]: value }));
    setErrors((previous) => ({ ...previous, [key]: undefined }));
  }
  async function save(event) {
    event.preventDefault();
    if (gate.current || uncertain || conflicted) return;
    const result = validateStaff(values, record ? [record] : [], record?.id,
      designationChoice?.raw ? [designationChoice.raw] : [], roleChoice?.raw ? [roleChoice.raw] : []);
    if (!record && (credentials.password || credentials.confirmPassword)) {
      const problem = validateReset(credentials.password, credentials.confirmPassword);
      if (problem) result.errors.password = problem;
    }
    setErrors(result.errors);
    if (Object.keys(result.errors).length) {
      const first = Object.keys(result.errors)[0];
      formRef.current?.querySelector(`[id="staff-${first}"]`)?.focus();
      return;
    }
    gate.current = true;
    setSaving(true);
    setMessage('');
    try {
      await onSave({ ...result.fields, ...(!record && credentials.password ? { initialPassword: credentials.password } : {}) }, record);
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
    description="Saved securely on the server. Business roles and designations do not grant access. Use Access in the directory to assign a role and enable workspace login."
    onClose={() => { if (!gate.current) onClose(); }} className="admin-import-dialog"
     footer={<><button type="button" className="admin-button admin-button--secondary" onClick={onClose} disabled={saving} data-testid="button-cancel-staff">Cancel</button><button type="submit" form="staff-management-form" className="admin-button" disabled={saving || uncertain || conflicted} data-testid="button-save-staff">{saving ? 'Saving…' : record ? 'Save changes' : 'Add staff member'}</button></>}>
    <form ref={formRef} id="staff-management-form" className="admin-staff-form" onSubmit={save} noValidate aria-busy={saving}>
      {['name', 'phone', 'employeeCode', 'email'].map((key) => {
        const inputProps = { id: `staff-${key}`, name: key, value: values[key], onChange: (event) => change(key, event.target.value),
          disabled: saving, 'aria-required': key !== 'employeeCode', 'aria-invalid': Boolean(errors[key]),
          'aria-describedby': errors[key] ? `staff-error-${key}` : undefined,
          'data-testid': `input-staff-${key}` };
        return <div key={key} className="admin-staff-field">
          <label htmlFor={`staff-${key}`}>{LABELS[key]} {key !== 'employeeCode' && <span aria-hidden="true">*</span>}</label>
          {key === 'phone' ? <PhoneInput prefix="staff" country={values.dialCountry} onCountryChange={(value) => change('dialCountry', value)} countryError={errors.dialCountry} inputProps={inputProps} />
            : <input {...inputProps} type={key === 'email' ? 'email' : 'text'} autoComplete="off" />}
          {key === 'phone' && errors.dialCountry && <span id="staff-dialCountry-error" className="admin-staff-field__error" role="alert">{errors.dialCountry}</span>}
          {errors[key] && <span id={`staff-error-${key}`} className="admin-staff-field__error" role="alert">{errors[key]}</span>}
        </div>;
      })}
      <label className="admin-staff-field"><span>Status <span aria-hidden="true">*</span></span><select value={values.status} onChange={(event) => change('status', event.target.value)} disabled={saving} data-testid="select-staff-status"><option value="active">Active</option><option value="inactive">Inactive</option></select>{errors.status && <span role="alert">{errors.status}</span>}</label>
      <div className="admin-staff-field">
        <label htmlFor="staff-role">Role <span aria-hidden="true">*</span></label>
        <RemoteSelect id="staff-role" label="Role" value={values.role} selected={roleChoice}
          fetchPage={staffRoleChoices} placeholder="Select a saved role" emptyText="No current saved roles match. Clear the search or save a role in Roles & Permissions." describeSelection required disabled={saving}
          invalid={errors.role} describedBy={errors.role ? 'staff-error-role' : undefined}
          onChange={(item) => { setRoleChoice(item); change('role', item?.value || ''); }} />
        {errors.role && <span id="staff-error-role" className="admin-staff-field__error" role="alert">{errors.role}</span>}
        {record && <span className="admin-staff-field__hint">Saved role: {record.role}. Keeping it unchanged does not require a current catalogue match.</span>}
        {record && values.role !== record.role && <button type="button" className="admin-button admin-button--secondary" disabled={saving}
          onClick={() => { setRoleChoice({ value: record.role, label: record.role }); change('role', record.role); }}>Keep saved role</button>}
      </div>
      <div className="admin-staff-field">
        <label htmlFor="staff-designation_id">Designation <span aria-hidden="true">*</span></label>
        <RemoteSelect id="staff-designation_id" label="Designation" value={values.designation_id} selected={designationChoice}
          fetchPage={staffDesignationPage} placeholder="Select an active designation" emptyText="No active designations match. Clear the search or save an active designation in Designation Master." describeSelection required disabled={saving}
          invalid={errors.designation_id} describedBy={errors.designation_id ? 'staff-error-designation_id' : undefined}
          onChange={(item) => { setDesignationChoice(item); change('designation_id', item?.value || ''); }} />
        {errors.designation_id && <span id="staff-error-designation_id" className="admin-staff-field__error" role="alert">{errors.designation_id}</span>}
        {record && <span className="admin-staff-field__hint">Saved designation: {record.designationName}. It can be kept unchanged even if unavailable.</span>}
        {record && values.designation_id !== record.designation_id && <button type="button" className="admin-button admin-button--secondary" disabled={saving}
          onClick={() => { setDesignationChoice({ value: record.designation_id, label: record.designationName }); change('designation_id', record.designation_id); }}>Keep saved designation</button>}
      </div>
      <label className="admin-staff-field"><span>Date of joining <span aria-hidden="true">*</span></span><input type="date" value={values.dateOfJoining} onChange={(event) => change('dateOfJoining', event.target.value)} disabled={saving} data-testid="input-staff-dateOfJoining" />{errors.dateOfJoining && <span className="admin-staff-field__error" role="alert">{errors.dateOfJoining}</span>}</label>
      {record ? <div className="admin-staff-field admin-staff-form__wide"><strong>Password</strong><span className="admin-staff-field__hint">Editing does not change or reveal the password.</span></div> :
        <div className="admin-staff-form__wide mr-form__password-note">
          <div className="admin-staff-form">{[['password', 'Password (optional)'], ['confirmPassword', 'Confirm password']].map(([key, label]) =>
            <div className="mr-form__field" key={key}><label className="mr-form__label" htmlFor={`staff-${key}`}>{label}</label>
              <div className="mr-form__input-row"><input id={`staff-${key}`} className="mr-form__control" name={key}
                type={visible ? 'text' : 'password'} autoComplete="new-password" spellCheck={false}
                autoCapitalize="none" autoCorrect="off" value={credentials[key]} disabled={saving}
                aria-describedby="staff-password-help" aria-invalid={Boolean(errors.password)}
                data-testid={`input-staff-${key}`} onChange={(event) => setCredentials((old) => ({ ...old, [key]: event.target.value }))} />
                <button type="button" className="mr-form__preview-action mr-form__credential-action"
                  disabled={saving} aria-controls={`staff-${key}`} aria-pressed={visible}
                  aria-label={`${visible ? 'Hide' : 'Show'} ${key === 'confirmPassword' ? 'confirm password' : 'password'}`}
                  onClick={() => setVisible((old) => !old)}>{visible ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}</button></div></div>)}</div>
          <button type="button" className="admin-button admin-button--secondary" disabled={saving} onClick={() => {
            const next = initialCredentials();
            setCredentials((old) => next.generationError ? { ...old, generationError: next.generationError } : next);
          }} data-testid="button-generate-staff-password">Auto-generate password</button>
          <p id="staff-password-help" className="admin-staff-field__hint">Manual passwords use 12–128 characters; confirm spaces exactly. Auto-generate fills both fields with the same random 12-character candidate containing uppercase, lowercase, a digit and a special character. If both are blank, the server generates a password with that same length and composition and requires email password setup before login. No email is sent by saving. Workspace access must be configured separately.</p>
          {credentials.generationError && <p role="alert">{credentials.generationError}</p>}
          {errors.password && <p role="alert" className="admin-staff-field__error">{errors.password}</p>}
        </div>}
      {message && <div className="admin-feedback admin-feedback--error admin-staff-form__wide" role="alert" data-testid="status-staff-save-error">{message}</div>}
      {uncertain && <div className="admin-feedback admin-staff-form__wide">Do not repeat this submission. Close this form and refresh the directory to confirm whether it saved. A lost initial password cannot be retrieved.</div>}
      {conflicted && <div className="admin-staff-form__wide"><button type="button" className="admin-button admin-button--secondary" onClick={reviewCurrent}>Review current record</button>{current && <><dl>{STAFF_COLUMNS.filter(([key]) => key !== 'userId').map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{current[key]}</dd></div>)}</dl><p>Your draft remains above. To edit the current version, cancel and reopen the refreshed record; this form cannot overwrite it.</p></>}</div>}
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
  return <Dialog title="One-time staff credentials" eyebrow="Staff Management" description="Shown only now. Closing or leaving clears the password. No invitation was sent. If both password inputs were blank, email password setup is required before login. Configure Access, then use Invite / send again." onClose={onClose}
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
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [actionError, setActionError] = useState('');
  const [editing, setEditing] = useState(undefined);
  const [credentials, setCredentials] = useState(null);
  const [accessFor, setAccessFor] = useState(null);
  const [deleteFor, setDeleteFor] = useState(null);
  const [deleteError, setDeleteError] = useState('');
  const [deleteUncertain, setDeleteUncertain] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [directoryTerm, setDirectoryTerm] = useState('');
  const [searchDirty, setSearchDirty] = useState(false);
  const [directory, setDirectory] = useState(null);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const filtersRef = useRef(EMPTY_FILTERS);
  const [filterChoices, setFilterChoices] = useState([]);
  const [filterChoiceCursor, setFilterChoiceCursor] = useState(null);
  const [filterChoicesLoading, setFilterChoicesLoading] = useState(false);
  const [filterChoiceError, setFilterChoiceError] = useState('');
  const filterChoiceSequence = useRef(0);
  const filterChoiceGate = useRef(false);
  const filterChoiceRetry = useRef(null);
  const request = useRef(null);
  const mutationGate = useRef(false);
  const alive = useRef(true);
  const pagination = useTablePagination(records);
  const searchPending = searchDirty;
  const invalidSearch = directoryTerm.trim().length === 1;
  const activeFilterCount = Object.values(filters).filter(Boolean).length;
  const blocked = Boolean(error || loading || busy || searchPending);

  async function refresh(nextOffset = offset, scope = directory, nextFilters = filtersRef.current) {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setSearchDirty(false);
    setError('');
    // Do not export or display stale results under a newly submitted scope.
    setRecords([]);
    setOffset(nextOffset);
    setHasMore(false);
    setDirectory(scope);
    try {
      const page = scope
        ? await searchStaff(scope.query, scope.cursor, { signal: controller.signal, filters: nextFilters })
        : await loadStaff(nextOffset, { signal: controller.signal, filters: nextFilters });
      if (!alive.current || controller.signal.aborted) return;
      setRecords(page.items);
      setHasMore(page.has_more);
      if (scope) setDirectory({ ...scope, nextCursor: page.next_cursor, scanned: page.scanned });
      pagination.resetPage();
    } catch (cause) {
      if (alive.current && !controller.signal.aborted) { setError(cause.message); setRecords([]); }
    } finally { if (alive.current && !controller.signal.aborted) setLoading(false); }
  }
  async function refreshFilterChoices(cursor = null) {
    if (filterChoiceGate.current) return;
    filterChoiceGate.current = true;
    const sequence = ++filterChoiceSequence.current;
    const owner = getSession().user?.id;
    filterChoiceRetry.current = cursor;
    setFilterChoicesLoading(true);
    setFilterChoiceError('');
    try {
      const result = await staffDesignationChoices(cursor);
      if (!alive.current || sequence !== filterChoiceSequence.current || getSession().user?.id !== owner) return;
      setFilterChoices((old) => cursor
        ? [...old, ...result.items.filter((item) => !old.some((row) => row.id === item.id))]
        : result.items);
      setFilterChoiceCursor(result.next_cursor);
    } catch (cause) {
      if (alive.current && sequence === filterChoiceSequence.current && getSession().user?.id === owner) setFilterChoiceError(cause.message);
    } finally {
      if (sequence === filterChoiceSequence.current) {
        filterChoiceGate.current = false;
        if (alive.current) setFilterChoicesLoading(false);
      }
    }
  }
  useEffect(() => {
    alive.current = true;
    void refresh(0);
    void refreshFilterChoices();
    const unsubscribe = subscribeSession(() => {
      if (getSession().status !== 'authenticated') setCredentials(null);
      if (!getSession().user) { filterChoiceSequence.current++; setFilterChoices([]); setFilterChoiceCursor(null); setFilterChoiceError(''); setFilters(EMPTY_FILTERS); filtersRef.current = EMPTY_FILTERS; request.current?.abort(); setRecords([]); setDirectory(null); setDirectoryTerm(''); setEditing(undefined); setAccessFor(null); setDeleteFor(null); }
    });
    return () => { alive.current = false; request.current?.abort(); unsubscribe(); };
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
        if (directory || Object.values(filtersRef.current).some(Boolean)) void refresh();
        else setRecords((previous) => previous.map((item) => item.id === next.id ? next : item));
      }
    } catch (cause) { if (alive.current) setActionError(cause.message); }
    finally { mutationGate.current = false; if (alive.current) setBusy(false); }
  }
  function beginDirectorySearch(event) {
    event.preventDefault();
    if (busy || invalidSearch) return;
    const query = directoryTerm.trim();
    void refresh(0, query ? { query, cursor: null, checked: 0 } : null);
  }
  function changeSearch(value) {
    request.current?.abort();
    setDirectoryTerm(value);
    setRecords([]);
    setLoading(false);
    setError('');
    setHasMore(false);
    setSearchDirty(true);
    pagination.resetPage();
    if (!value.trim()) void refresh(0, null);
  }
  function changeFilter(key, value) {
    const next = { ...filtersRef.current, [key]: value };
    filtersRef.current = next;
    setFilters(next);
    const query = directoryTerm.trim();
    void refresh(0, query ? { query, cursor: null, checked: 0 } : null, next);
  }
  function resetFilters() {
    setDirectoryTerm('');
    setFilters(EMPTY_FILTERS);
    filtersRef.current = EMPTY_FILTERS;
    void refresh(0, null, EMPTY_FILTERS);
  }
  async function edit(record) {
    setActionError('');
    setFeedback('');
    if (!record) { setEditing(null); return; }
    try { const latest = await getStaff(record.id); if (alive.current) setEditing(latest); }
    catch (cause) { if (alive.current) setActionError(cause.message); }
  }
  async function exportRows() {
    if (blocked || !records.length) return;
    const preferences = captureExportPreferences();
    try { reportingIdentityGuard()(); await downloadCSV(exportStaffCSV(records, preferences)); }
    catch (cause) { setActionError(cause.message); }
  }
  async function confirmDelete() {
    if (mutationGate.current || deleteUncertain) return;
    mutationGate.current = true;
    setBusy(true);
    setDeleteError('');
    const guard = reportingIdentityGuard();
    try {
      await deleteStaff(deleteFor);
      guard();
      if (!alive.current) return;
      setDeleteFor(null);
      setFeedback('Staff member deleted. Relationships and account history are retained; workspace sessions have been revoked.');
      void refresh(0, directory ? { query: directory.query, cursor: null, checked: 0 } : null);
    } catch (cause) {
      if (alive.current) {
        setDeleteError(cause.message || 'Delete failed.');
        // A stale or uncertain action must be reviewed, never retried blindly.
        setDeleteUncertain(Boolean(cause.ambiguous) || ['staff_stale', 'staff_outcome_unknown', 'not_found'].includes(cause.code));
      }
    } finally { mutationGate.current = false; if (alive.current) setBusy(false); }
  }
  const rowActions = (record, mobile = false) => <><InviteAccountButton kind="staff" record={record} disabled={blocked} /><button type="button" className="admin-icon-button" title={`Edit ${record.name}`} aria-label={`Edit ${record.name}`} disabled={blocked} onClick={() => edit(record)} data-testid={`button-edit-staff-${mobile ? 'mobile-' : ''}${record.id}`}><Pencil size={16} aria-hidden="true" /></button><button type="button" className="admin-icon-button" title={`Access for ${record.name}`} aria-label={`Access for ${record.name}`} disabled={blocked} onClick={() => { setFeedback(''); setActionError(''); setAccessFor(record); }} data-testid={`button-access-staff-${mobile ? 'mobile-' : ''}${record.id}`}><KeyRound size={16} aria-hidden="true" /></button><button type="button" className="admin-icon-button" title={`Delete ${record.name}`} aria-label={`Delete ${record.name}`} disabled={blocked} onClick={() => { setDeleteError(''); setDeleteUncertain(false); setDeleteFor(record); }} data-testid={`button-delete-staff-${mobile ? 'mobile-' : ''}${record.id}`}><Trash2 size={16} aria-hidden="true" /></button></>;
  const columns = [
    { key: 'serial', label: 'Sr No.', render: (_, index) => <span className="admin-table__serial">{index + 1}</span> },
    { key: 'name', label: 'Name', render: (record) => <span className="admin-staff-identity"><strong data-testid={`text-staff-name-${record.id}`}>{record.name}</strong></span> },
    { key: 'phone', label: 'Phone No.', render: (record) => <StaffPhone record={record} /> },
    { key: 'userId', label: 'User ID', render: (record) => record.userId },
    { key: 'email', label: 'Email ID', render: (record) => <a href={`mailto:${record.email}`} className="admin-staff-link">{record.email}</a> },
    { key: 'role', label: 'Role', render: (record) => record.role },
    { key: 'dateOfJoining', label: 'Date of joining', render: (record) => formatAdminDate(record.dateOfJoining) },
    { key: 'designationName', label: 'Designation', render: (record) => record.designationName },
    { key: 'status', label: 'Status', render: (record) => <button type="button" role="switch" aria-checked={record.status === 'active'} aria-label={`${record.name}: ${record.status}. Change status`} className="admin-staff-status" disabled={blocked} onClick={() => toggle(record)} data-testid={`switch-staff-status-${record.id}`}><span className="admin-staff-status__track" aria-hidden="true" />{record.status === 'active' ? 'Active' : 'Inactive'}</button> },
    { key: 'access', label: 'Workspace access', render: (record) => <span data-testid={`text-staff-access-${record.id}`}>{record.custom_role_id ? 'Role assigned' : 'No role'} · login {record.workspace_login_enabled ? 'enabled' : 'disabled'}</span> },
    { key: 'created', label: 'Created details', render: (record) => audit(record.createdBy, record.createdAt) },
    { key: 'updated', label: 'Updated details', render: (record) => audit(record.updatedBy, record.updatedAt) },
    { key: 'actions', label: 'Actions', render: (record) => rowActions(record) },
  ];
  return <AdminLayout title="Staff Management">
    <div className="admin-page-head"><div><p className="admin-page-head__eyebrow">People / Directory</p><h1>Staff Management</h1><p className="admin-page-head__description">Server-backed staff directory. Business role labels grant nothing; use Access to assign a custom role and enable workspace login explicitly.</p></div><div className="admin-staff-actions">
      <button type="button" className="admin-button admin-button--secondary" disabled title="CSV bulk account provisioning is unavailable in this phase." data-testid="button-import-staff"><Upload size={16} aria-hidden="true" /> Import unavailable</button>
       <button type="button" className="admin-button admin-button--secondary" onClick={exportRows} disabled={blocked || !records.length} title="CSV: loaded result section only, under the applied search and filters." data-testid="button-export-staff"><Download size={16} aria-hidden="true" /> Export loaded section</button>
      <button type="button" className="admin-button" onClick={() => edit(null)} disabled={blocked} data-testid="button-add-staff"><Plus size={16} aria-hidden="true" /> Add staff</button>
    </div></div>
    {feedback && <div className="admin-feedback" role="status">{feedback}</div>}
    {actionError && <div className="admin-feedback admin-feedback--error" role="alert" data-testid="status-staff-action-error">{actionError}</div>}
    <section className="admin-panel" aria-label="Staff directory">
      <div className="admin-staff-toolbar">
        <form className="master-filter-toolbar" onSubmit={beginDirectorySearch}>
          <div className="admin-staff-search-actions">
            <button type="button" className="admin-button admin-button--secondary" onClick={() => { void refresh(0, directoryTerm.trim() ? { query: directoryTerm.trim(), cursor: null, checked: 0 } : null); void refreshFilterChoices(); }} disabled={busy || loading || invalidSearch} data-testid="button-refresh-staff"><RefreshCw size={16} aria-hidden="true" /> Refresh</button>
            <label className="admin-search admin-staff-search"><Search size={16} aria-hidden="true" /><span className="sr-only">Search entire staff directory</span><input value={directoryTerm} onChange={(event) => changeSearch(event.target.value)} disabled={busy} maxLength={200} minLength={2} autoComplete="off" placeholder="Search directory (2+ characters)" data-testid="input-directory-search-staff" /></label>
            <button type="submit" className="admin-button admin-button--secondary" disabled={busy || loading || invalidSearch} data-testid="button-directory-search-staff">Search</button>
          </div>
          <MasterFilterReset disabled={busy || (!directoryTerm && !directory && !activeFilterCount && !offset)} onClick={resetFilters} testId="button-reset-staff-filters" />
        </form>
        <details className="admin-staff-filters">
          <summary data-testid="button-toggle-staff-filters"><Filter size={15} aria-hidden="true" /> Filter records{activeFilterCount > 0 && ` · ${activeFilterCount} active`}<ChevronDown size={15} aria-hidden="true" /></summary>
          <div className="admin-staff-filter-grid">
            <div className="admin-filter"><label htmlFor="staff-status-filter">Status</label><select id="staff-status-filter" className="admin-select" value={filters.status} disabled={busy || invalidSearch} onChange={(event) => changeFilter('status', event.target.value)} data-testid="select-filter-staff-status"><option value="">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option></select></div>
            <div className="admin-filter"><label htmlFor="staff-designation-filter">Designation</label><select id="staff-designation-filter" className="admin-select" value={filters.designation_id} disabled={busy || invalidSearch || (filterChoicesLoading && !filterChoices.length)} onChange={(event) => changeFilter('designation_id', event.target.value)} data-testid="select-filter-staff-designation"><option value="">All designations</option>{filters.designation_id && !filterChoices.some((item) => item.id === filters.designation_id) && <option value={filters.designation_id}>Selected saved designation (not in loaded choices)</option>}{filterChoices.map((item) => <option key={item.id} value={item.id}>{item.name}{item.deleted ? ' (deleted; saved reference)' : item.status === 'inactive' ? ' (inactive)' : ''}</option>)}</select>
              <span className="admin-staff-field__hint">Saved staff designations{filterChoiceCursor ? ' · more choices available' : ''}.</span>
              {filterChoicesLoading && <span className="admin-staff-field__hint" role="status">Loading choices…</span>}
              {filterChoiceError && <div className="admin-staff-field__error" role="alert">Could not load designation choices: {filterChoiceError} <button type="button" className="admin-button admin-button--secondary" disabled={filterChoicesLoading} onClick={() => refreshFilterChoices(filterChoiceRetry.current)}>Retry choices</button></div>}
              {filterChoiceCursor && <button type="button" className="admin-button admin-button--secondary" disabled={filterChoicesLoading} onClick={() => refreshFilterChoices(filterChoiceCursor)}>Load more designations</button>}
            </div>
            <div className="admin-filter"><label htmlFor="staff-role-filter">Role</label><RemoteSelect id="staff-role-filter" label="Business role filter" value={filters.role}
              selected={filters.role ? { value: filters.role, label: filters.role } : null} fetchPage={roleFilterPage}
              placeholder="All business roles" disabled={busy || invalidSearch}
              onChange={(item) => changeFilter('role', item?.value || '')} /></div>
          </div>
        </details>
        <div className="admin-staff-sections">
          <span role="status" data-testid="status-directory-search-staff">{searchPending ? (invalidSearch ? 'Enter at least 2 characters, or clear search.' : 'Submit search to load the first section.') : loading ? 'Loading result section…' : error ? 'Section unavailable. Retry loading.' : directory ? `“${directory.query}” · ${directory.checked + (directory.scanned || 0)} filtered records checked · ${hasMore ? 'more remain unchecked' : 'final search section'}. Earlier sections may contain matches.` : `Section ${offset / 100 + 1} · ${records.length} loaded · ${hasMore ? offset >= 10000 ? 'more remain; narrow filters or search to continue' : 'more sections available' : 'final section'}`}</span>
          <nav aria-label="Staff result sections">
            <button type="button" className="admin-button admin-button--secondary" disabled={blocked || (!directory && !offset)} onClick={() => refresh(0, directory ? { query: directory.query, cursor: null, checked: 0 } : null)} data-testid="button-restart-directory-search-staff">First section</button>
            <button type="button" className="admin-button admin-button--secondary" disabled={blocked || (directory ? !directory.history?.length : !offset)} onClick={() => { if (directory) { const history = directory.history; void refresh(0, { query: directory.query, ...history.at(-1), history: history.slice(0, -1) }); } else void refresh(Math.max(0, offset - 100)); }} data-testid="button-previous-directory-search-staff">Previous section</button>
            <button type="button" className="admin-button admin-button--secondary" disabled={blocked || !hasMore || (!directory && offset >= 10000)} onClick={() => { if (directory) void refresh(0, { query: directory.query, cursor: directory.nextCursor, checked: directory.checked + directory.scanned, history: [...(directory.history || []), { cursor: directory.cursor, checked: directory.checked }] }); else void refresh(offset + 100); }} data-testid="button-continue-directory-search-staff">{directory ? 'Continue search' : 'Next section'}</button>
          </nav>
        </div>
      </div>
      {searchPending ? <div className="admin-empty">Submit the directory search to load matching staff.</div> : loading ? <div className="admin-empty" role="status">Loading staff records…</div> : error ? <div className="admin-empty" role="alert"><strong>Staff records could not be loaded</strong><p>{error}</p><button type="button" className="admin-button" onClick={() => refresh()} data-testid="button-retry-staff">Retry loading</button></div> : <>
        {records.length ? <><div className="admin-staff-desktop"><DataTable columns={columns} rows={pagination.pageRows} rowOffset={pagination.startIndex} rowKey={(record) => record.id} label="Staff records" testIdPrefix="staff" /></div><div className="admin-staff-mobile" role="list" aria-label="Staff records">{pagination.pageRows.map((record, index) => <article className="admin-staff-card" role="listitem" key={record.id} data-testid={`card-staff-${record.id}`}><div className="admin-staff-card__head"><div><small>#{pagination.startIndex + index + 1} · {record.userId}</small><h2>{record.name}</h2></div></div><dl className="admin-staff-card__meta">{['phone', 'userId', 'email', 'role', 'dateOfJoining', 'designationName', 'status'].map((key) => <div key={key}><dt>{LABELS[key]}</dt><dd>{key === 'phone' ? <StaffPhone record={record} mobile /> : key === 'dateOfJoining' ? formatAdminDate(record.dateOfJoining) : record[key]}</dd></div>)}<div><dt>Created details</dt><dd>{audit(record.createdBy, record.createdAt)}</dd></div><div><dt>Updated details</dt><dd>{audit(record.updatedBy, record.updatedAt)}</dd></div></dl><div className="admin-staff-card__actions">{rowActions(record, true)}<button type="button" role="switch" aria-checked={record.status === 'active'} className="admin-staff-status" disabled={blocked} onClick={() => toggle(record)} data-testid={`switch-staff-mobile-status-${record.id}`}><span className="admin-staff-status__track" aria-hidden="true" />{record.status === 'active' ? 'Active' : 'Inactive'}</button></div></article>)}</div></> : <div className="admin-empty" data-testid="status-staff-empty"><span className="admin-empty__icon"><UsersRound size={21} aria-hidden="true" /></span><strong>{directory ? (hasMore ? 'No matches in this section' : 'No matches in this final section') : activeFilterCount ? 'No staff match these filters in this section' : offset ? 'No staff members in this section' : 'No staff members yet'}</strong><p>{directory ? (hasMore ? 'Continue search to check the remaining filtered directory.' : 'Search complete. Earlier sections may contain matches; restart to review them or try another term.') : activeFilterCount ? 'Try different filters or reset them.' : offset ? 'Return to a previous section or search the directory.' : 'Add a staff member to begin the server-backed directory.'}</p></div>}
        <TablePagination {...pagination} filtered={records.length} total={records.length} label={directory ? 'staff matches in loaded section' : 'staff members in loaded batch'} onPageChange={pagination.setPage} onPageSizeChange={pagination.setPageSize} testId="text-staff-count" />
      </>}
    </section>
    {editing !== undefined && <StaffForm key={editing?.id || 'new'} record={editing} onSave={save} onClose={() => setEditing(undefined)} />}
    {accessFor && <StaffAccessDialog key={accessFor.id} record={accessFor} onClose={() => setAccessFor(null)} onSaved={(next) => { setAccessFor(null); setFeedback(`Access saved for ${next.name}: ${next.custom_role_id ? 'role assigned' : 'no role'}, workspace login ${next.workspace_login_enabled ? 'enabled' : 'disabled'}.`); setRecords((previous) => previous.map((item) => item.id === next.id ? next : item)); }} />}
    {credentials && <Credentials credentials={credentials} onClose={() => setCredentials(null)} />}
    {deleteFor && <Dialog title="Delete staff member?" eyebrow="Staff Management" description={`Delete ${deleteFor.name}? This removes them from the directory and immediately revokes workspace sessions. Status, encrypted records, relationships and history are retained. There is no restore action.`}
      onClose={() => { if (!mutationGate.current) setDeleteFor(null); }}
      footer={<><button type="button" className="admin-button admin-button--secondary" disabled={busy} onClick={() => setDeleteFor(null)}>Cancel</button><button type="button" className="admin-button" disabled={busy || deleteUncertain} onClick={confirmDelete} data-testid="button-confirm-delete-staff">{busy ? 'Deleting…' : 'Delete staff member'}</button></>}>
      {deleteError && <p role="alert">{deleteError}</p>}
      {deleteUncertain && <p role="status">Close this confirmation and refresh the directory to review the current outcome before taking another action.</p>}
    </Dialog>}
  </AdminLayout>;
}
