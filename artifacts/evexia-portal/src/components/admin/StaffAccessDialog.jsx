import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import Dialog from './Dialog.jsx';
import { listRoles, getRole } from '../../services/rolePermissions.js';
import { accessOf, getStaff, setStaffAccess, validateAccess } from '../../services/staff.js';
import { countLabel } from './ZonePermissionMatrix.jsx';

// Explicit access assignment. Independent of the staff metadata form: nothing
// is inferred from the Role label, and nothing is enabled automatically.
export default function StaffAccessDialog({ record, onClose, onSaved }) {
  const [base, setBase] = useState(record);
  const [values, setValues] = useState(() => accessOf(record));
  const [cursors, setCursors] = useState([null]);
  const [idx, setIdx] = useState(0);
  const [page, setPage] = useState({ items: [], has_more: false });
  const [rolesState, setRolesState] = useState('loading');
  const [rolesError, setRolesError] = useState('');
  const [assigned, setAssigned] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [current, setCurrent] = useState(null);
  const gate = useRef(false);
  const alive = useRef(true);
  const seq = useRef(0);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const load = useCallback(async (stack, at) => {
    const mine = ++seq.current;
    setRolesState('loading'); setRolesError('');
    try {
      const data = await listRoles(stack[at]);
      if (mine !== seq.current || !alive.current) return;
      setCursors(data.has_more ? [...stack.slice(0, at + 1), data.next_cursor] : stack.slice(0, at + 1));
      setIdx(at); setPage(data); setRolesState('ready');
    } catch (cause) {
      if (mine !== seq.current || !alive.current) return;
      setRolesState('error'); setRolesError(cause.message || 'Roles could not be loaded.');
    }
  }, []);
  useEffect(() => { void load([null], 0); }, [load]);

  const savedRoleId = base.custom_role_id ?? null;
  useEffect(() => {
    if (!savedRoleId) { setAssigned(null); return; }
    let live = true;
    getRole(savedRoleId).then((role) => { if (live) setAssigned({ role }); }, (cause) => { if (live) setAssigned({ missing: cause.code === 'role_deleted' || cause.status === 404 }); });
    return () => { live = false; };
  }, [savedRoleId]);

  const onPage = (id) => page.items.some((role) => role.id === id);
  const known = values.customRoleId && (page.items.find((role) => role.id === values.customRoleId) || (assigned?.role?.id === values.customRoleId ? assigned.role : null));
  const problem = validateAccess(values);
  const dirty = values.customRoleId !== (base.custom_role_id ?? null) || values.loginEnabled !== (base.workspace_login_enabled === true);
  const blocked = saving || rolesState === 'loading' || error?.ambiguous || error?.code === 'staff_stale';

  async function save(event) {
    event.preventDefault();
    if (gate.current || blocked || problem || !dirty) return;
    gate.current = true; setSaving(true); setError(null);
    try {
      const next = await setStaffAccess(base, values);
      if (alive.current) onSaved(next);
    } catch (cause) {
      if (alive.current) setError({ message: cause.message, code: cause.code, ambiguous: Boolean(cause.ambiguous) });
    } finally { gate.current = false; if (alive.current) setSaving(false); }
  }
  async function review() {
    try { setCurrent(await getStaff(record.id)); } catch (cause) { setError((e) => ({ ...e, message: cause.message })); }
  }
  const adopt = () => { setBase(current); setCurrent(null); setError(null); };
  const useCurrent = () => { setBase(current); setValues(accessOf(current)); setCurrent(null); setError(null); };
  const set = (patch) => setValues((v) => ({ ...v, ...patch }));

  return <Dialog title={`Access for ${record.name}`} eyebrow="Staff Management" onClose={() => { if (!gate.current) onClose(); }}
    description="Assign one role and decide whether this person may sign in to the restricted workspace. Business Role and Designation labels are not used. Passwords are never changed or shown here."
    footer={<><button type="button" className="admin-button admin-button--secondary" onClick={onClose} disabled={saving} data-testid="button-cancel-staff-access">Cancel</button>
      <button type="submit" form="staff-access-form" className="admin-button" disabled={blocked || Boolean(problem) || !dirty} data-testid="button-save-staff-access">{saving ? 'Saving...' : 'Save access'}</button></>}>
    <form id="staff-access-form" className="admin-staff-form" onSubmit={save} noValidate aria-busy={saving}>
      <div className="admin-staff-field admin-staff-form__wide" role="radiogroup" aria-label="Assigned role">
        <strong>Assigned role</strong>
        <label className="admin-staff-access__option"><input type="radio" name="staff-access-role" checked={values.customRoleId === null} disabled={saving} onChange={() => set({ customRoleId: null })} data-testid="radio-staff-access-none" /> No role (no Zone access)</label>
        {values.customRoleId && !onPage(values.customRoleId) && <label className="admin-staff-access__option"><input type="radio" name="staff-access-role" checked disabled={saving} readOnly data-testid="radio-staff-access-assigned" /> {known ? `${known.name} (${countLabel(known.permissions.length)})` : assigned?.missing ? 'Assigned role no longer exists' : 'Assigned role (loading name)'}</label>}
        {page.items.map((role) => <label key={role.id} className="admin-staff-access__option"><input type="radio" name="staff-access-role" checked={values.customRoleId === role.id} disabled={saving} onChange={() => set({ customRoleId: role.id })} data-testid={`radio-staff-access-${role.id}`} /> <span>{role.name} <small>{countLabel(role.permissions.length)}</small></span></label>)}
        {rolesState === 'loading' && <span className="admin-staff-field__hint" role="status">Loading roles...</span>}
        {rolesState === 'error' && <div className="admin-feedback admin-feedback--error" role="alert">{rolesError} <button type="button" className="admin-button admin-button--secondary" onClick={() => load(cursors, idx)} data-testid="button-retry-access-roles">Retry roles</button></div>}
        {rolesState === 'ready' && !page.items.length && <span className="admin-staff-field__hint">No roles exist yet. Create one in Roles &amp; Permissions.</span>}
        <div className="admin-staff-access__pager">
          <button type="button" className="admin-button admin-button--secondary" disabled={idx === 0 || rolesState === 'loading' || saving} onClick={() => load(cursors, idx - 1)} data-testid="button-previous-access-roles"><ChevronLeft size={14} aria-hidden="true" /> Previous</button>
          <span className="admin-staff-field__hint">Roles page {idx + 1}</span>
          <button type="button" className="admin-button admin-button--secondary" disabled={!page.has_more || rolesState !== 'ready' || saving} onClick={() => load(cursors, idx + 1)} data-testid="button-next-access-roles">Next <ChevronRight size={14} aria-hidden="true" /></button>
        </div>
      </div>
      <label className="admin-staff-field admin-staff-form__wide admin-staff-access__option">
        <input type="checkbox" checked={values.loginEnabled} disabled={saving} onChange={(e) => set({ loginEnabled: e.target.checked })} data-testid="checkbox-staff-workspace-login" />
        <span><strong>Enable workspace login</strong> <small>Uses the existing User ID and password. Inactive staff cannot sign in even when enabled. Without a role, staff can sign in but see a no-access screen.</small></span>
      </label>
      <div className="admin-staff-form__wide" aria-live="polite">
        {error && <div className="admin-feedback admin-feedback--error" role="alert" data-testid="status-staff-access-error">{error.message}
          {error.ambiguous && <p>Do not repeat this change. Close this form and refresh the directory to confirm the saved state.</p>}
          {error.code === 'staff_stale' && !current && <p><button type="button" className="admin-button admin-button--secondary" onClick={review} data-testid="button-review-staff-access">Review current access</button></p>}
        </div>}
        {current && <div data-testid="text-current-staff-access"><p>Current: {current.custom_role_id ? 'role assigned' : 'no role'}, login {current.workspace_login_enabled ? 'enabled' : 'disabled'}.</p>
          <button type="button" className="admin-button" onClick={adopt} data-testid="button-adopt-staff-access">Keep my choices on current version</button>{' '}
          <button type="button" className="admin-button admin-button--secondary" onClick={useCurrent} data-testid="button-use-current-staff-access">Discard choices, use current</button></div>}
      </div>
    </form>
  </Dialog>;
}
