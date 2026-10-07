import { useCallback, useEffect, useRef, useState } from 'react';
import { Pencil, Plus, RefreshCw, Trash2, ChevronLeft, ChevronRight } from 'lucide-react';
import AdminLayout from '../../components/admin/AdminLayout.jsx';
import Dialog from '../../components/admin/Dialog.jsx';
import { useAdminPreferences } from '../../components/admin/adminPreferences.js';
import { listRoles, getRole, createRole, updateRole, deleteRole, validateRoleName, validateRoleDescription, ROLE_NAME_LIMIT, ROLE_DESCRIPTION_LIMIT } from '../../services/rolePermissions.js';
import '../../roles-permissions.css';

const fmt = (value) => { const d = new Date(value); return Number.isNaN(d.getTime()) ? value : d.toLocaleString(); };
const errInfo = (e) => ({ code: e?.code || '', ambiguous: Boolean(e?.ambiguous), message: (e && e.message) || 'The role service could not complete this request.' });

function RoleForm({ form, setForm, busy, blocked, error, current, onSubmit, onClose, onReview, onAdopt, onUseCurrent, reviewing, onRefresh, refreshing }) {
  const edit = form.mode === 'edit';
  const deleted = error?.code === 'role_deleted';
  const stale = error?.code === 'role_stale';
  const fieldError = form.touched ? (validateRoleName(form.name) || validateRoleDescription(form.description)) : '';
  const dup = error?.code === 'role_duplicate';
  const set = (patch) => setForm((f) => ({ ...f, ...patch, touched: false }));
  const locked = busy || reviewing || blocked || deleted || stale || refreshing;
  return <Dialog title={edit ? 'Edit role' : 'Add role'} eyebrow="Roles & Permissions" onClose={onClose}
    description="Business role metadata only. It cannot affect login or staff rights, and no permissions are configured."
    footer={<><button type="button" className="admin-button admin-button--secondary" onClick={onClose} disabled={busy} data-testid="button-cancel-role">Cancel</button>
      <button type="submit" form="rp-role-form" className="admin-button" disabled={locked} data-testid={edit ? 'button-save-role' : 'button-create-role'}>{busy ? 'Saving...' : edit ? 'Save role' : 'Create role'}</button></>}>
    <form id="rp-role-form" className="rp-form" onSubmit={onSubmit} noValidate aria-busy={busy}>
      <label htmlFor="rp-role-name">Role name</label>
      <input id="rp-role-name" value={form.name} maxLength={ROLE_NAME_LIMIT * 2} readOnly={busy} onChange={(e) => set({ name: e.target.value })} aria-required="true" aria-invalid={Boolean(fieldError || dup)} aria-describedby="rp-role-error" autoComplete="off" data-testid="input-role-name" />
      <label htmlFor="rp-role-description">Description (optional)</label>
      <textarea id="rp-role-description" rows={3} value={form.description} maxLength={ROLE_DESCRIPTION_LIMIT * 2} readOnly={busy} onChange={(e) => set({ description: e.target.value })} data-testid="input-role-description" />
      <div id="rp-role-error" aria-live="polite">
        {fieldError && <span className="rp-form__error" role="alert" data-testid="text-role-error">{fieldError}</span>}
        {error && <div className="rp-alert" role="alert" data-testid="status-role-save-error">
          <strong>{deleted ? 'This role was deleted' : stale ? 'This role changed elsewhere' : dup ? 'Duplicate role name' : error.ambiguous ? 'Result unknown' : 'Not saved'}</strong>
          <p>{error.message}</p>
          {deleted && <p>It will not be recreated. Close this form and refresh roles. Your draft is shown above for reference only.</p>}
          {error.ambiguous && <p>Submitting is blocked until you refresh roles and check the current list. Your draft is kept.</p>}
          {error.ambiguous && <button type="button" className="admin-button admin-button--secondary" onClick={onRefresh} disabled={busy || refreshing} data-testid="button-refresh-draft-roles">{refreshing ? 'Refreshing...' : 'Refresh roles'}</button>}
          {!deleted && !error.ambiguous && !stale && <p>Your draft is kept. Fix the problem and try again.</p>}
          {stale && <div className="rp-alert__actions">
            <button type="button" className="admin-button admin-button--secondary" onClick={onReview} disabled={busy || reviewing} data-testid="button-review-current">{reviewing ? 'Loading...' : 'Review current details'}</button>
          </div>}
          {stale && current && <div className="rp-current" data-testid="text-current-role">
            <dl><dt>Current name</dt><dd>{current.name}</dd><dt>Current description</dt><dd>{current.description || 'None'}</dd><dt>Updated</dt><dd>{fmt(current.updated_at)} (version {current.version})</dd></dl>
            <div className="rp-alert__actions">
              <button type="button" className="admin-button" onClick={onAdopt} disabled={busy} data-testid="button-adopt-current">Keep my draft on current version</button>
              <button type="button" className="admin-button admin-button--secondary" onClick={onUseCurrent} disabled={busy} data-testid="button-use-current">Discard draft, use current</button>
            </div></div>}
        </div>}
      </div>
    </form>
  </Dialog>;
}

export default function RolesPermissions() {
  useAdminPreferences();
  const [cursors, setCursors] = useState([null]);
  const [idx, setIdx] = useState(0);
  const [page, setPage] = useState({ items: [], has_more: false, next_cursor: null });
  const [status, setStatus] = useState('loading');
  const [listError, setListError] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [pinned, setPinned] = useState(null);
  const [form, setForm] = useState(null);
  const [formError, setFormError] = useState(null);
  const [current, setCurrent] = useState(null);
  const [reviewing, setReviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [del, setDel] = useState(null);
  const [notice, setNotice] = useState('');
  const seq = useRef(0);
  const ctrl = useRef(null);
  const busyRef = useRef(false);
  const mounted = useRef(true);
  const state = useRef({}); state.current = { cursors, idx, pinned };

  const load = useCallback(async (stack, at, silent = false) => {
    const mine = ++seq.current;
    ctrl.current?.abort();
    const c = typeof AbortController === 'undefined' ? null : new AbortController();
    ctrl.current = c;
    if (!silent) { setStatus('loading'); setListError(''); }
    try {
      const data = await listRoles(stack[at], c ? { signal: c.signal } : undefined);
      if (mine !== seq.current || !mounted.current) return null;
      if (!data.items.length && at > 0) return load(stack.slice(0, at), at - 1, silent);
      const next = data.has_more ? [...stack.slice(0, at + 1), data.next_cursor] : stack.slice(0, at + 1);
      setCursors(next); setIdx(at); setPage(data); setStatus('ready'); setListError('');
      const p = state.current.pinned;
      if (p && !data.items.some((r) => r.id === p.id)) {
        try { const fresh = await getRole(p.id, c ? { signal: c.signal } : undefined); if (mine === seq.current && mounted.current) setPinned(fresh); }
        catch (e) { if (mine === seq.current && mounted.current && e?.code === 'role_deleted') setPinned(null); }
      } else if (p) setPinned(null);
      return data;
    } catch (e) {
      if (mine !== seq.current || !mounted.current || e?.name === 'AbortError') return null;
      setStatus('unavailable'); setListError(errInfo(e).message);
      return null;
    }
  }, []);

  useEffect(() => { mounted.current = true; load([null], 0); return () => { mounted.current = false; ctrl.current?.abort(); seq.current++; }; }, [load]);
  useEffect(() => {
    const refresh = () => { if (document.visibilityState !== 'hidden' && !busyRef.current) load(state.current.cursors, state.current.idx, true); };
    window.addEventListener('focus', refresh); document.addEventListener('visibilitychange', refresh);
    return () => { window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); };
  }, [load]);

  const role = page.items.find((r) => r.id === selectedId) || (pinned && pinned.id === selectedId ? pinned : null);
  useEffect(() => {
    if (status !== 'ready') return;
    if (!role) setSelectedId(page.items[0]?.id ?? null);
  }, [status, role, page.items]);

  const refreshAll = async () => {
    const data = await load(state.current.cursors, state.current.idx);
    if (data) setBlocked(false);
    return data;
  };
  const go = (to) => { if (to >= 0 && to < cursors.length) load(cursors, to); };
  const setBusyBoth = (v) => { busyRef.current = v; setBusy(v); };

  function openForm(mode, r) {
    setFormError(null); setCurrent(null);
    setForm(mode === 'edit' ? { mode, id: r.id, version: r.version, name: r.name, description: r.description } : { mode, name: '', description: '' });
  }
  const closeForm = () => { if (!busyRef.current && !reviewing) { setForm(null); setFormError(null); setCurrent(null); } };

  async function submit(event) {
    event.preventDefault();
    if (busyRef.current || blocked || reviewing || ['role_deleted', 'role_stale'].includes(formError?.code)) return;
    const problem = validateRoleName(form.name) || validateRoleDescription(form.description);
    if (problem) { setForm((f) => ({ ...f, touched: true })); return; }
    const fields = { name: form.name.trim(), description: form.description.trim() };
    setBusyBoth(true); setFormError(null);
    try {
      const saved = form.mode === 'edit' ? await updateRole(form.id, fields, form.version) : await createRole(fields);
      if (!mounted.current) return;
      setPinned(saved); setSelectedId(saved.id); setForm(null); setCurrent(null);
      setNotice(form.mode === 'edit' ? `Saved ${saved.name}.` : `Created ${saved.name}.`);
      setBusyBoth(false);
      await load(state.current.cursors, state.current.idx);
    } catch (e) {
      if (!mounted.current) return;
      const info = errInfo(e);
      setFormError(info); if (info.ambiguous) setBlocked(true);
      setBusyBoth(false);
    }
  }
  async function review() {
    setReviewing(true);
    try { const r = await getRole(form.id); if (mounted.current) setCurrent(r); }
    catch (e) { if (mounted.current) setFormError({ ...errInfo(e), code: e?.code === 'role_deleted' ? 'role_deleted' : 'role_stale' }); }
    finally { if (mounted.current) setReviewing(false); }
  }
  const adopt = () => { setForm((f) => ({ ...f, version: current.version })); setFormError(null); setCurrent(null); };
  const useCurrent = () => { setForm((f) => ({ ...f, version: current.version, name: current.name, description: current.description })); setFormError(null); setCurrent(null); };

  async function confirmDelete() {
    if (busyRef.current || blocked || !del) return;
    setBusyBoth(true); setFormError(null);
    try {
      await deleteRole(del.id, del.version);
      if (!mounted.current) return;
      const name = del.name;
      if (selectedId === del.id) setSelectedId(null);
      setPinned((p) => (p && p.id === del.id ? null : p));
      setDel(null); setNotice(`Deleted ${name}.`); setBusyBoth(false);
      await load(state.current.cursors, state.current.idx);
    } catch (e) {
      if (!mounted.current) return;
      const info = errInfo(e);
      setFormError(info); if (info.ambiguous) setBlocked(true);
      setBusyBoth(false);
    }
  }
  const closeDelete = () => { if (!busyRef.current) { setDel(null); setFormError(null); } };
  const delGone = formError?.code === 'role_deleted' || formError?.code === 'role_stale';

  const loading = status === 'loading';
  return <AdminLayout title="Roles & Permissions">
    <div className="admin-page-head"><div><p className="admin-page-head__eyebrow">People / Role metadata</p><h1>Roles & Permissions</h1><p className="admin-page-head__description">Manage business role names and descriptions. Permissions are not configured, and role metadata cannot affect login or staff rights. The server records an audit entry for every change.</p></div></div>
    {blocked && <div className="rp-alert rp-alert--page" role="alert" data-testid="status-roles-blocked">A previous change had an unknown result. Refresh roles to confirm the current state before submitting again.</div>}
    {notice && <div className="admin-feedback rp-feedback" role="status" data-testid="status-roles-notice">{notice}</div>}
    <div className="rp">
      <aside className="admin-panel rp-roles" aria-label="Roles" aria-busy={loading}>
        <h2 className="rp-roles__title">Roles <span data-testid="text-role-count">{page.items.length}</span></h2>
        <p className="rp-pageinfo">Page {idx + 1}{page.has_more ? '' : ' (last)'}</p>
        {loading && !page.items.length ? <div className="rp-skel" role="status" data-testid="status-roles-loading"><span className="sr-only">Loading roles</span><i /><i /><i /></div> :
          status === 'unavailable' ? <div className="rp-alert" role="alert" data-testid="status-roles-unavailable"><strong>Roles unavailable</strong><p>{listError}</p></div> :
          page.items.length === 0 ? <div className="admin-empty" role="status" data-testid="status-roles-empty"><strong>No roles yet</strong><p>Create the first business role.</p></div> :
          <ul className="rp-roles__list">{page.items.map((r) => <li key={r.id}><button type="button" className={`rp-role${role && r.id === role.id ? ' rp-role--active' : ''}`} aria-pressed={Boolean(role && r.id === role.id)} onClick={() => { setSelectedId(r.id); setNotice(''); }} data-testid={`button-role-${r.id}`}>
            <strong>{r.name}</strong><span className="rp-role__description">{r.description || 'No description'}</span><small>0 permissions</small></button></li>)}</ul>}
        <div className="rp-pager">
          <button type="button" className="admin-button admin-button--secondary" onClick={() => go(idx - 1)} disabled={idx === 0 || loading} data-testid="button-previous-roles"><ChevronLeft size={14} aria-hidden="true" /> Previous</button>
          <button type="button" className="admin-button admin-button--secondary" onClick={() => go(idx + 1)} disabled={!page.has_more || loading || status !== 'ready'} data-testid="button-next-roles">Next <ChevronRight size={14} aria-hidden="true" /></button>
        </div>
        <button type="button" className="admin-button admin-button--secondary" onClick={refreshAll} disabled={loading} data-testid="button-refresh-roles"><RefreshCw size={14} aria-hidden="true" /> Refresh roles</button>
        <button type="button" className="rp-add" disabled={loading || status !== 'ready'} onClick={() => { setNotice(''); openForm('add'); }} data-testid="button-add-role"><Plus size={15} aria-hidden="true" /> Add role</button>
      </aside>

      <section className="admin-panel rp-work" aria-label="Role details">
        {role ? <>
          <div className="rp-head">
            <div className="rp-head__main"><h2 data-testid="text-active-role">{role.name}</h2></div>
            <div className="rp-head__actions">
              <button type="button" className="admin-button admin-button--secondary" disabled={loading || status !== 'ready'} onClick={() => { setNotice(''); openForm('edit', role); }} data-testid="button-edit-role"><Pencil size={14} aria-hidden="true" /> Edit</button>
              <button type="button" className="admin-button admin-button--secondary" disabled={loading || status !== 'ready'} onClick={() => { setNotice(''); setFormError(null); setDel(role); }} data-testid="button-delete-role"><Trash2 size={14} aria-hidden="true" /> Delete</button>
            </div>
          </div>
          <dl className="rp-meta">
            <dt>Description</dt><dd>{role.description || 'No description'}</dd>
            <dt>Permissions</dt><dd><span data-testid="text-permission-count">0 permissions</span> - permissions not configured</dd>
            <dt>Created</dt><dd>{fmt(role.created_at)}</dd>
            <dt>Updated</dt><dd>{fmt(role.updated_at)} (version {role.version})</dd>
          </dl>
          <p className="rp-scope">This role is business metadata only. It cannot affect login or staff rights.</p>
        </> : <div className="admin-empty" role="status">
          <strong>{loading ? 'Loading roles' : status === 'unavailable' ? 'Roles could not be loaded' : 'No role selected'}</strong>
          <p>{status === 'unavailable' ? 'Use Refresh roles to try again.' : 'Permissions not configured. 0 permissions. Role metadata cannot affect login or staff rights.'}</p>
          <span className="sr-only" data-testid="text-permission-count">0 permissions</span>
        </div>}
      </section>
    </div>
    {form && <RoleForm form={form} setForm={setForm} busy={busy} blocked={blocked} error={formError} current={current} reviewing={reviewing} onSubmit={submit} onClose={closeForm} onReview={review} onAdopt={adopt} onUseCurrent={useCurrent} onRefresh={refreshAll} refreshing={loading} />}
    {del && <Dialog title="Delete role" eyebrow="Roles & Permissions" onClose={closeDelete} description={`Delete "${del.name}"? This removes the role record. It does not change login or staff rights.`}
      footer={<><button type="button" className="admin-button admin-button--secondary" onClick={closeDelete} disabled={busy} data-testid="button-cancel-role">Cancel</button>
        <button type="button" className="admin-button rp-danger" onClick={confirmDelete} disabled={busy || blocked || delGone} data-testid="button-confirm-delete-role">{busy ? 'Deleting...' : 'Delete role'}</button></>}>
      <div aria-live="polite">{formError && <div className="rp-alert" role="alert" data-testid="text-role-error">
        <strong>{formError.code === 'role_deleted' ? 'Already deleted' : formError.code === 'role_stale' ? 'Role changed elsewhere' : formError.ambiguous ? 'Result unknown' : 'Not deleted'}</strong>
        <p>{formError.message}</p>
        {formError.ambiguous && <p>Deleting is blocked until you refresh roles.</p>}
        {formError.ambiguous && <button type="button" className="admin-button admin-button--secondary" onClick={refreshAll} disabled={loading} data-testid="button-refresh-draft-roles">Refresh roles</button>}
        {delGone && <p>Close this dialog and refresh roles to see the current state.</p>}
      </div>}</div>
    </Dialog>}
  </AdminLayout>;
}
